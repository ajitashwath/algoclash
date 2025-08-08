"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const topics = ["Arrays", "Strings", "Trees", "Graphs", "DP"] as const
const difficulties = ["Easy", "Medium", "Hard"] as const

export default function HomePage() {
  const router = useRouter()
  const [name, setName] = useState("")
  const [roomId, setRoomId] = useState("")
  const [difficulty, setDifficulty] = useState<(typeof difficulties)[number]>("Easy")
  const [topic, setTopic] = useState<(typeof topics)[number]>("Arrays")

  useEffect(() => {
    const stored = localStorage.getItem("player_name")
    if (stored) setName(stored)
  }, [])

  useEffect(() => {
    if (name) localStorage.setItem("player_name", name)
  }, [name])

  const canProceed = name.trim().length >= 2

  const genRoomId = () =>
    Math.random().toString(36).slice(2, 8).toUpperCase()

  const handleCreate = () => {
    if (!canProceed) return
    const id = genRoomId()
    router.push(`/room/${id}?d=${difficulty}&t=${topic}`)
  }

  const handleJoin = () => {
    if (!canProceed || roomId.trim().length < 4) return
    // Difficulty/topic optional for joining existing room; useful if room not yet created
    const params = new URLSearchParams()
    if (difficulty) params.set("d", difficulty)
    if (topic) params.set("t", topic)
    router.push(`/room/${roomId.trim().toUpperCase()}?${params.toString()}`)
  }

  return (
    <main className="min-h-dvh bg-white text-black flex items-center justify-center p-4">
      <Card className="w-full max-w-3xl border-black">
        <CardHeader>
          <CardTitle className="font-mono tracking-tight text-2xl">Algo Battle Arena</CardTitle>
          <p className="text-sm text-muted-foreground">{'Minimalist 2 vs 2 coding duels. No fluff—just code, a timer, and the win.'}</p>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="font-mono">Display name</Label>
              <Input
                placeholder="e.g., dev_ace"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="border-black focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label className="font-mono">Difficulty</Label>
                <Select value={difficulty} onValueChange={(v) => setDifficulty(v as any)}>
                  <SelectTrigger className="border-black">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {difficulties.map((d) => (
                      <SelectItem key={d} value={d}>{d}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label className="font-mono">Topic</Label>
                <Select value={topic} onValueChange={(v) => setTopic(v as any)}>
                  <SelectTrigger className="border-black">
                    <SelectValue placeholder="Select" />
                  </SelectTrigger>
                  <SelectContent>
                    {topics.map((t) => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Button
                variant="default"
                className={cn("bg-black text-white hover:bg-black/90 rounded-none")}
                disabled={!canProceed}
                onClick={handleCreate}
              >
                Create room
              </Button>
              <div className="flex-1" />
            </div>
          </div>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="font-mono">Join existing room</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="ROOMID"
                  value={roomId}
                  onChange={(e) => setRoomId(e.target.value.toUpperCase())}
                  className="border-black focus-visible:ring-0 focus-visible:ring-offset-0 uppercase"
                />
                <Button
                  onClick={handleJoin}
                  disabled={!canProceed || roomId.trim().length < 4}
                  className="bg-white text-black border border-black hover:bg-black hover:text-white rounded-none"
                >
                  Join
                </Button>
              </div>
            </div>
            <div className="text-xs text-muted-foreground">
              {'Tip: By default, the app connects to ws://localhost:4000. Set NEXT_PUBLIC_WS_URL to point at your server when deploying.'}
            </div>
          </div>
        </CardContent>
      </Card>
    </main>
  )
}
