"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import dynamic from "next/dynamic"
import { cn } from "@/lib/utils"
import {
  type ClientToServerMessage,
  type ProblemPayload,
  type RoomStatePayload,
  type ServerToClientMessage,
  type TeamKey,
} from "@/lib/types"

const MonacoEditor = dynamic(() => import("@/components/monaco-editor"), { ssr: false })

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:4000"

export default function RoomPage() {
  const params = useParams<{ id: string }>()
  const search = useSearchParams()
  const roomId = (params?.id || "").toUpperCase()

  const [name, setName] = useState("")
  const [connected, setConnected] = useState(false)
  const [ws, setWs] = useState<WebSocket | null>(null)

  // Room/game state
  const [room, setRoom] = useState<RoomStatePayload | null>(null)
  const [problem, setProblem] = useState<ProblemPayload | null>(null)
  const [code, setCode] = useState<string>("")
  const [ready, setReady] = useState(false)
  const [chatInput, setChatInput] = useState("")
  const [messages, setMessages] = useState<{ id: string; name: string; text: string; team?: TeamKey }[]>([])
  const [attemptFeedback, setAttemptFeedback] = useState<string | null>(null)
  const [collab, setCollab] = useState(true)
  const [endAt, setEndAt] = useState<number | null>(null)
  const [now, setNow] = useState<number>(Date.now())

  const myIdRef = useRef<string>("")

  useEffect(() => {
    const n = localStorage.getItem("player_name") || ""
    setName(n)
  }, [])

  useEffect(() => {
    if (!name) return
    const ws = new WebSocket(WS_URL)
    setWs(ws)

    ws.onopen = () => {
      setConnected(true)
      const msg: ClientToServerMessage = {
        type: "join_room",
        roomId,
        name,
        difficulty: (search.get("d") as any) || undefined,
        topic: (search.get("t") as any) || undefined,
      }
      ws.send(JSON.stringify(msg))
    }

    ws.onclose = () => setConnected(false)

    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerToClientMessage
      switch (msg.type) {
        case "room_state":
          setRoom(msg.state)
          if (!myIdRef.current && msg.selfId) myIdRef.current = msg.selfId
          break
        case "game_start":
          setProblem(msg.problem)
          setEndAt(msg.endAt)
          setAttemptFeedback(null)
          setMessages((prev) => prev.concat({ id: crypto.randomUUID(), name: "System", text: "Game started." }))
          setCode(msg.boilerplate || msg.problem?.boilerplate || "")
          break
        case "chat":
          setMessages((prev) => prev.concat({ id: crypto.randomUUID(), name: msg.from, team: msg.team, text: msg.text }))
          break
        case "attempt_result":
          setAttemptFeedback(msg.ok ? "✅ Correct! Waiting for result..." : `❌ ${msg.message || "Incorrect."}`)
          break
        case "game_over":
          setMessages((prev) =>
            prev.concat({ id: crypto.randomUUID(), name: "System", text: `Game over. Winner: ${msg.winner ?? "None"}` })
          )
          break
        case "timer_sync":
          setEndAt(msg.endAt)
          break
        case "error":
          setMessages((prev) => prev.concat({ id: crypto.randomUUID(), name: "System", text: `Error: ${msg.message}` }))
          break
      }
    }

    return () => {
      ws.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, roomId])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const secondsLeft = useMemo(() => {
    if (!endAt) return null
    return Math.max(0, Math.ceil((endAt - now) / 1000))
  }, [endAt, now])

  const me = useMemo(() => {
    return room?.players.find((p) => p.id === myIdRef.current)
  }, [room])

  const myTeam = me?.team

  const send = (msg: ClientToServerMessage) => {
    if (ws?.readyState === ws?.OPEN) ws.send(JSON.stringify(msg))
  }

  const toggleReady = () => {
    setReady((r) => !r)
    send({ type: "ready", ready: !ready })
  }

  const handleSubmit = () => {
    if (!code.trim()) return
    send({ type: "submit_solution", code })
  }

  const handleRematch = () => {
    setAttemptFeedback(null)
    send({ type: "rematch" })
  }

  const sendChat = () => {
    if (!chatInput.trim()) return
    send({ type: "chat", text: chatInput })
    setChatInput("")
  }

  return (
    <main className="min-h-dvh bg-white text-black p-3 md:p-6">
      <div className="flex items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="rounded-none border-black font-mono">{`ROOM ${roomId}`}</Badge>
          <Badge variant="outline" className="rounded-none border-black font-mono">
            {room?.difficulty || search.get("d") || "Easy"} · {room?.topic || search.get("t") || "Arrays"}
          </Badge>
          <Badge variant="outline" className="rounded-none border-black font-mono">
            {connected ? "Connected" : "Disconnected"}
          </Badge>
        </div>
        <div className="font-mono text-lg">
          {secondsLeft !== null ? `⏱ ${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")}` : "⏱ --:--"}
        </div>
      </div>

      <div className="grid grid-rows-[auto_1fr] gap-3">
        <Card className="border-black">
          <CardContent className="p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm">Players:</span>
              {room?.players.map((p) => (
                <Badge
                  key={p.id}
                  variant="outline"
                  className={cn(
                    "rounded-none border-black font-mono",
                    p.team === "A" ? "bg-black text-white" : "bg-white text-black"
                  )}
                >
                  {p.name}
                  <span className="ml-2 text-[10px] opacity-70">{p.ready ? "(ready)" : ""}</span>
                </Badge>
              ))}
              <div className="flex-1" />
              <Button onClick={toggleReady} className="rounded-none bg-black text-white hover:bg-black/90">
                {ready ? "Unready" : "Ready"}
              </Button>
              <div className="flex items-center gap-2">
                <Label htmlFor="collab" className="font-mono text-xs">Team collab</Label>
                <input
                  id="collab"
                  type="checkbox"
                  checked={collab}
                  onChange={(e) => setCollab(e.target.checked)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid lg:grid-cols-2 gap-3 min-h-[70dvh]">
          <Card className="border-black">
            <CardHeader className="p-3">
              <CardTitle className="font-mono text-base">Problem</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              {problem ? (
                <div className="space-y-3">
                  <div className="font-semibold">{problem.title}</div>
                  <div className="whitespace-pre-wrap font-mono text-sm">{problem.description}</div>
                  <div className="font-mono text-xs">
                    {"Signature: "}
                    <code>{problem.signature}</code>
                  </div>
                  <div className="font-mono text-xs">
                    {"Examples:"}
                    <pre className="mt-1 p-2 border border-black">{problem.examples}</pre>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-muted-foreground font-mono">
                  {'Waiting for game to start. All 4 players must be ready.'}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-black flex flex-col">
            <CardHeader className="p-3">
              <CardTitle className="font-mono text-base">Editor</CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 min-h-[300px]">
              <MonacoEditor value={code} onChange={setCode} language="javascript" />
            </CardContent>
            <div className="p-3 border-t border-black flex items-center gap-3">
              <Button onClick={handleSubmit} className="rounded-none bg-white border border-black text-black hover:bg-black hover:text-white">
                Submit
              </Button>
              <div className="font-mono text-xs text-muted-foreground">{attemptFeedback || ""}</div>
              <div className="flex-1" />
              <Button onClick={handleRematch} variant="ghost" className="rounded-none border border-transparent hover:border-black">
                Rematch
              </Button>
            </div>
          </Card>

          <Card className="border-black lg:col-span-2">
            <CardHeader className="p-3">
              <CardTitle className="font-mono text-base">Team Chat</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <div className="h-48 overflow-y-auto border border-black p-2 bg-white">
                {messages.map((m) => (
                  <div key={m.id} className="font-mono text-sm">
                    <span className="opacity-60">{m.team ? `[${m.team}] ` : ""}</span>
                    <strong>{m.name}:</strong> {m.text}
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-2">
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendChat()}
                  placeholder="Type your message"
                  className="border-black"
                />
                <Button onClick={sendChat} className="rounded-none bg-black text-white hover:bg-black/90">Send</Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
