export type Difficulty = "Easy" | "Medium" | "Hard"
export type Topic = "Arrays" | "Strings" | "Trees" | "Graphs" | "DP"
export type TeamKey = "A" | "B"

export interface PlayerState {
  id: string
  name: string
  team: TeamKey
  ready: boolean
  attempts: number
  errors: number
}

export interface RoomStatePayload {
  roomId: string
  difficulty: Difficulty
  topic: Topic
  players: PlayerState[]
  started: boolean
  winner?: TeamKey | null
}

export interface ProblemPayload {
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

export type ClientToServerMessage =
  | { type: "join_room"; roomId: string; name: string; difficulty?: Difficulty; topic?: Topic }
  | { type: "ready"; ready: boolean }
  | { type: "chat"; text: string }
  | { type: "code_update"; code: string }
  | { type: "cursor"; line: number; column: number }
  | { type: "submit_solution"; code: string }
  | { type: "rematch" }

export type ServerToClientMessage =
  | { type: "room_state"; state: RoomStatePayload; selfId?: string }
  | { type: "game_start"; problem: ProblemPayload; endAt: number; boilerplate?: string }
  | { type: "chat"; from: string; text: string; team?: TeamKey }
  | { type: "attempt_result"; ok: boolean; message?: string }
  | { type: "game_over"; winner: TeamKey | null; timeTaken?: number }
  | { type: "timer_sync"; endAt: number }
  | { type: "error"; message: string }
