import express from "express"
import { WebSocketServer, WebSocket } from "ws"
import http from "http"
import crypto from "crypto"
import vm from "vm"

type Difficulty = "Easy" | "Medium" | "Hard"
type Topic = "Arrays" | "Strings" | "Trees" | "Graphs" | "DP"
type TeamKey = "A" | "B"

type ClientToServerMessage =
  | { type: "join_room"; roomId: string; name: string; difficulty?: Difficulty; topic?: Topic }
  | { type: "ready"; ready: boolean }
  | { type: "chat"; text: string }
  | { type: "code_update"; code: string }
  | { type: "cursor"; line: number; column: number }
  | { type: "submit_solution"; code: string }
  | { type: "rematch" }

type ServerToClientMessage =
  | { type: "room_state"; state: RoomStatePayload; selfId?: string }
  | { type: "game_start"; problem: Problem; endAt: number; boilerplate?: string }
  | { type: "chat"; from: string; text: string; team?: TeamKey }
  | { type: "attempt_result"; ok: boolean; message?: string }
  | { type: "game_over"; winner: TeamKey | null; timeTaken?: number }
  | { type: "timer_sync"; endAt: number }
  | { type: "error"; message: string }

interface Player {
  id: string
  name: string
  team: TeamKey
  ready: boolean
  attempts: number
  errors: number
  ws: WebSocket
}

interface RoomStatePayload {
  roomId: string
  difficulty: Difficulty
  topic: Topic
  players: { id: string; name: string; team: TeamKey; ready: boolean; attempts: number; errors: number }[]
  started: boolean
  winner?: TeamKey | null
}

interface Problem {
  id: string
  title: string
  description: string
  signature: string
  examples: string
  boilerplate: string
  difficulty: Difficulty
  topic: Topic
  functionName: string
  tests: { args: any[]; expected: any }[]
}

const app = express()
const server = http.createServer(app)
const wss = new WebSocketServer({ server })

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 4000
const GAME_SECONDS = 20 * 60

// Repository layer (in-memory fallback, optional Prisma)
class Repo {
  private problems: Problem[] = []

  constructor() {
    // seed some problems
    this.problems = seedProblems()
  }

  async getRandomProblem(difficulty: Difficulty, topic: Topic): Promise<Problem> {
    const pool = this.problems.filter((p) => p.difficulty === difficulty && p.topic === topic)
    if (!pool.length) throw new Error("No problems in this category.")
    return pool[Math.floor(Math.random() * pool.length)]
  }
}

const repo = new Repo()

class Room {
  id: string
  difficulty: Difficulty
  topic: Topic
  players: Map<string, Player> = new Map()
  started = false
  winner: TeamKey | null = null
  problem: Problem | null = null
  endAt: number | null = null
  timer?: NodeJS.Timeout

  constructor(id: string, difficulty: Difficulty, topic: Topic) {
    this.id = id
    this.difficulty = difficulty
    this.topic = topic
  }

  addPlayer(p: Player) {
    if (this.players.size >= 4) throw new Error("Room full")
    // team assignment: A then B alternating to keep balance (2 vs 2)
    const countA = Array.from(this.players.values()).filter((x) => x.team === "A").length
    const countB = Array.from(this.players.values()).filter((x) => x.team === "B").length
    const team: TeamKey = countA <= countB ? "A" : "B"
    p.team = team
    this.players.set(p.id, p)
    this.broadcastState(p.id)
  }

  removePlayer(id: string) {
    this.players.delete(id)
    if (this.players.size === 0) {
      // cleanup handled by RoomsMap
    } else {
      this.broadcastState()
    }
  }

  setReady(id: string, ready: boolean) {
    const p = this.players.get(id)
    if (p) {
      p.ready = ready
      this.broadcastState()
      this.tryStart()
    }
  }

  broadcastState(selfId?: string) {
    const state: RoomStatePayload = {
      roomId: this.id,
      difficulty: this.difficulty,
      topic: this.topic,
      players: Array.from(this.players.values()).map((p) => ({
        id: p.id,
        name: p.name,
        team: p.team,
        ready: p.ready,
        attempts: p.attempts,
        errors: p.errors,
      })),
      started: this.started,
      winner: this.winner,
    }
    this.broadcast({ type: "room_state", state, selfId })
  }

  broadcast(msg: ServerToClientMessage) {
    const payload = JSON.stringify(msg)
    for (const p of this.players.values()) {
      safeSend(p.ws, payload)
    }
  }

  private tryStart() {
    if (this.started) return
    if (this.players.size !== 4) return
    const allReady = Array.from(this.players.values()).every((p) => p.ready)
    if (!allReady) return
    this.start()
  }

  private async start() {
    this.started = true
    this.winner = null
    this.problem = await repo.getRandomProblem(this.difficulty, this.topic)
    const now = Date.now()
    this.endAt = now + GAME_SECONDS * 1000
    this.broadcast({
      type: "game_start",
      problem: this.problem,
      endAt: this.endAt,
      boilerplate: this.problem.boilerplate,
    })
    this.broadcastState()
    this.startTimer()
  }

  private startTimer() {
    if (!this.endAt) return
    this.stopTimer()
    this.timer = setInterval(() => {
      if (!this.endAt) return
      if (Date.now() >= this.endAt) {
        this.stopTimer()
        this.finish(null)
      } else {
        this.broadcast({ type: "timer_sync", endAt: this.endAt })
      }
    }, 1000)
  }

  private stopTimer() {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  handleChat(fromId: string, text: string) {
    const p = this.players.get(fromId)
    if (!p) return
    this.broadcast({ type: "chat", from: p.name, text, team: p.team })
  }

  async handleSubmit(fromId: string, code: string) {
    const p = this.players.get(fromId)
    if (!p || !this.problem || !this.started) return
    p.attempts += 1
    try {
      const ok = await evaluateSolution(code, this.problem)
      if (ok) {
        this.broadcast({ type: "attempt_result", ok: true })
        this.finish(p.team)
        return
      } else {
        p.errors += 1
        safeSend(p.ws, JSON.stringify({ type: "attempt_result", ok: false, message: "Wrong answer" }))
        this.broadcastState()
      }
    } catch (err: any) {
      p.errors += 1
      safeSend(p.ws, JSON.stringify({ type: "attempt_result", ok: false, message: err?.message || "Runtime error" }))
      this.broadcastState()
    }
  }

  private finish(winner: TeamKey | null) {
    if (!this.started) return
    this.started = false
    this.winner = winner
    this.stopTimer()
    const timeTaken = this.endAt ? Math.max(0, this.endAt - Date.now()) : 0
    this.broadcast({ type: "game_over", winner, timeTaken })
    this.broadcastState()
  }

  rematch() {
    // Reset ready states, attempts/errors; wait for ready from all 4
    for (const p of this.players.values()) {
      p.ready = false
      p.attempts = 0
      p.errors = 0
    }
    this.started = false
    this.winner = null
    this.problem = null
    this.endAt = null
    this.stopTimer()
    this.broadcastState()
  }
}

class RoomsMap {
  private rooms: Map<string, Room> = new Map()

  getOrCreate(id: string, difficulty: Difficulty, topic: Topic) {
    const exist = this.rooms.get(id)
    if (exist) return exist
    const room = new Room(id, difficulty, topic)
    this.rooms.set(id, room)
    return room
  }

  get(id: string) {
    return this.rooms.get(id)
  }

  removeIfEmpty(id: string) {
    const r = this.rooms.get(id)
    if (r && r.players.size === 0) {
      this.rooms.delete(id)
    }
  }
}

const rooms = new RoomsMap()

wss.on("connection", (socket) => {
  let currentRoom: Room | null = null
  let selfId: string | null = null

  socket.on("message", async (data) => {
    let msg: ClientToServerMessage
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return safeSend(socket, JSON.stringify({ type: "error", message: "Invalid message" }))
    }

    switch (msg.type) {
      case "join_room": {
        if (currentRoom) break
        const rid = msg.roomId.toUpperCase()
        const difficulty = (msg.difficulty || "Easy") as Difficulty
        const topic = (msg.topic || "Arrays") as Topic
        const room = rooms.getOrCreate(rid, difficulty, topic)
        const pid = crypto.randomUUID()
        selfId = pid
        try {
          room.addPlayer({
            id: pid,
            name: sanitizeName(msg.name),
            team: "A",
            ready: false,
            attempts: 0,
            errors: 0,
            ws: socket,
          })
          currentRoom = room
          safeSend(socket, JSON.stringify({ type: "room_state", state: serializeRoom(room), selfId: pid }))
        } catch (e: any) {
          safeSend(socket, JSON.stringify({ type: "error", message: e?.message || "Join failed" }))
        }
        break
      }
      case "ready": {
        if (!currentRoom || !selfId) break
        currentRoom.setReady(selfId, msg.ready)
        break
      }
      case "chat": {
        if (!currentRoom || !selfId) break
        currentRoom.handleChat(selfId, msg.text.slice(0, 400))
        break
      }
      case "code_update": {
        // For future collab mode: broadcast to teammates
        break
      }
      case "cursor": {
        // For future collab cursors
        break
      }
      case "submit_solution": {
        if (!currentRoom || !selfId) break
        await currentRoom.handleSubmit(selfId, msg.code)
        break
      }
      case "rematch": {
        if (!currentRoom) break
        currentRoom.rematch()
        break
      }
    }
  })

  socket.on("close", () => {
    if (currentRoom && selfId) {
      currentRoom.removePlayer(selfId)
      rooms.removeIfEmpty(currentRoom.id)
    }
  })
})

app.get("/", (_req, res) => {
  res.json({ ok: true, service: "algo-battle-arena", ws: true })
})

server.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})

// Helpers

function safeSend(ws: WebSocket, payload: string) {
  if (ws.readyState === ws.OPEN) {
    ws.send(payload)
  }
}

function serializeRoom(room: Room): RoomStatePayload {
  return {
    roomId: room.id,
    difficulty: room.difficulty,
    topic: room.topic,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      ready: p.ready,
      attempts: p.attempts,
      errors: p.errors,
    })),
    started: room.started,
    winner: room.winner,
  }
}

function sanitizeName(name: string) {
  const n = (name || "Player").slice(0, 24)
  return n.replace(/[^\w\- ]/g, "")
}

async function evaluateSolution(code: string, problem: Problem): Promise<boolean> {
  // Extremely limited evaluation: run in vm with no require, no process
  const context: any = {
    console: { log: (..._args: any[]) => {} },
    Math,
    JSON,
    Number,
    String,
    Array,
    Object,
    parseInt,
    parseFloat,
    BigInt,
    Infinity,
  }
  vm.createContext(context)

  const wrapped = `
"use strict";
${code}
// Export target function by name for the harness:
(typeof ${problem.functionName} === "function") ? ${problem.functionName} : null;
  `
  let fn: any
  try {
    fn = vm.runInContext(wrapped, context, { timeout: 1000 })
  } catch (e: any) {
    throw new Error(`Compile error: ${e?.message || e}`)
  }
  if (typeof fn !== "function") throw new Error(`Function ${problem.functionName} not found`)

  for (const t of problem.tests) {
    let out
    try {
      out = vm.runInContext(`(${problem.functionName})(...${JSON.stringify(t.args)})`, context, { timeout: 1000 })
    } catch (e: any) {
      throw new Error(`Runtime error on test: ${e?.message || e}`)
    }
    if (!deepEqual(out, t.expected)) {
      return false
    }
  }
  return true
}

function deepEqual(a: any, b: any): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function seedProblems(): Problem[] {
  const problems: Problem[] = []

  // Arrays - Easy
  problems.push({
    id: "two-sum-easy",
    title: "Two Sum",
    description:
      "Given an array of integers nums and an integer target, return indices of the two numbers such that they add up to target.\nAssume exactly one solution, and you may not use the same element twice. Return the indices in any order.",
    signature: "function twoSum(nums: number[], target: number): number[]",
    examples: `Input: nums = [2,7,11,15], target = 9 => Output: [0,1]
Input: nums = [3,2,4], target = 6 => Output: [1,2]`,
    boilerplate: `function twoSum(nums, target) {
  const map = new Map();
  for (let i = 0; i < nums.length; i++) {
    const need = target - nums[i];
    if (map.has(need)) return [map.get(need), i];
    map.set(nums[i], i);
  }
  return [];
}
`,
    difficulty: "Easy",
    topic: "Arrays",
    functionName: "twoSum",
    tests: [
      { args: [[2, 7, 11, 15], 9], expected: [0, 1] },
      { args: [[3, 2, 4], 6], expected: [1, 2] },
      { args: [[3, 3], 6], expected: [0, 1] },
    ],
  })

  // Strings - Easy
  problems.push({
    id: "valid-anagram",
    title: "Valid Anagram",
    description:
      "Given two strings s and t, return true if t is an anagram of s, and false otherwise.",
    signature: "function isAnagram(s: string, t: string): boolean",
    examples: `Input: s = "anagram", t = "nagaram" => true
Input: s = "rat", t = "car" => false`,
    boilerplate: `function isAnagram(s, t) {
  if (s.length !== t.length) return false;
  const cnt = new Array(26).fill(0);
  for (let i = 0; i < s.length; i++) {
    cnt[s.charCodeAt(i) - 97]++;
    cnt[t.charCodeAt(i) - 97]--;
  }
  return cnt.every(x => x === 0);
}
`,
    difficulty: "Easy",
    topic: "Strings",
    functionName: "isAnagram",
    tests: [
      { args: ["anagram", "nagaram"], expected: true },
      { args: ["rat", "car"], expected: false },
    ],
  })

  // Trees - Medium
  problems.push({
    id: "max-depth-tree",
    title: "Maximum Depth of Binary Tree",
    description:
      "Given the root of a binary tree, return its maximum depth. A binary tree node is represented as { val, left, right }.",
    signature: "function maxDepth(root: TreeNode | null): number",
    examples: `Input: root = {val:3,left:{val:9,left:null,right:null},right:{val:20,left:{val:15},right:{val:7}}}
Output: 3`,
    boilerplate: `function maxDepth(root) {
  if (!root) return 0;
  return 1 + Math.max(maxDepth(root.left), maxDepth(root.right));
}
`,
    difficulty: "Medium",
    topic: "Trees",
    functionName: "maxDepth",
    tests: [
      {
        args: [
          { val: 3, left: { val: 9, left: null, right: null }, right: { val: 20, left: { val: 15 }, right: { val: 7 } } },
        ],
        expected: 3,
      },
      { args: [null], expected: 0 },
    ],
  })

  // Graphs - Medium
  problems.push({
    id: "num-islands",
    title: "Number of Islands",
    description:
      "Given a 2D grid of '1's (land) and '0's (water), return the number of islands. An island is surrounded by water and is formed by connecting adjacent lands horizontally or vertically.",
    signature: "function numIslands(grid: string[][]): number",
    examples: `Input: grid = [["1","1","0"],["0","1","0"],["1","0","1"]] => Output: 3`,
    boilerplate: `function numIslands(grid) {
  const m = grid.length, n = grid[0].length;
  let count = 0;
  const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
  function dfs(r,c){
    if (r<0||c<0||r>=m||c>=n||grid[r][c]!=="1") return;
    grid[r][c]="0";
    for (const [dr,dc] of dirs) dfs(r+dr,c+dc);
  }
  for (let i=0;i<m;i++){
    for (let j=0;j<n;j++){
      if (grid[i][j]==="1"){ count++; dfs(i,j); }
    }
  }
  return count;
}
`,
    difficulty: "Medium",
    topic: "Graphs",
    functionName: "numIslands",
    tests: [
      { args: [[["1","1","0"],["0","1","0"],["1","0","1"]]], expected: 3 },
      { args: [[["0","0"],["0","0"]]], expected: 0 },
    ],
  })

  // DP - Hard
  problems.push({
    id: "edit-distance",
    title: "Edit Distance",
    description:
      "Given two strings word1 and word2, return the minimum number of operations required to convert word1 to word2. You have the following operations permitted on a word: insert a character, delete a character, replace a character.",
    signature: "function minDistance(word1: string, word2: string): number",
    examples: `Input: "horse", "ros" => 3`,
    boilerplate: `function minDistance(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) dp[i][j] = dp[i - 1][j - 1];
      else dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}
`,
    difficulty: "Hard",
    topic: "DP",
    functionName: "minDistance",
    tests: [
      { args: ["horse", "ros"], expected: 3 },
      { args: ["intention", "execution"], expected: 5 },
    ],
  })

  // Graphs - Hard
  problems.push({
    id: "course-schedule",
    title: "Course Schedule (Detect Cycle)",
    description:
      "Given the total number of courses and prerequisites as pairs, determine if you can finish all courses (i.e., graph has no cycle).",
    signature: "function canFinish(n: number, prereqs: number[][]): boolean",
    examples: `Input: n=2, [[1,0]] => true; n=2, [[1,0],[0,1]] => false`,
    boilerplate: `function canFinish(n, prereqs) {
  const g = Array.from({length:n}, () => []);
  const indeg = new Array(n).fill(0);
  for (const [a,b] of prereqs) { g[b].push(a); indeg[a]++; }
  const q = [];
  for (let i=0;i<n;i++) if (indeg[i]===0) q.push(i);
  let seen = 0;
  while (q.length) {
    const u = q.shift();
    seen++;
    for (const v of g[u]) {
      if (--indeg[v] === 0) q.push(v);
    }
  }
  return seen === n;
}
`,
    difficulty: "Hard",
    topic: "Graphs",
    functionName: "canFinish",
    tests: [
      { args: [2, [[1,0]]], expected: true },
      { args: [2, [[1,0], [0,1]]], expected: false },
    ],
  })

  return problems
}
