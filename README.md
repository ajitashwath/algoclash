# Algo Battle Arena (2v2 Realtime Coding Duels)

Stack:
- Frontend: Next.js (App Router), TypeScript, Tailwind + shadcn/ui, Monaco Editor
- Realtime Backend: Node.js, TypeScript, Express, WebSocket (ws)
- Database: PostgreSQL + Prisma (optional; in-memory fallback for quick start)

Quick start (dev):
1) Run the realtime server:
   - Node 18+
   - From repo root:
     - node scripts/server.ts
     - Server boots on http://localhost:4000 and opens a WebSocket endpoint.
2) Start the Next app (in your environment):
   - The preview provided here renders the frontend, but to test realtime, open your local Next dev server pointing NEXT_PUBLIC_WS_URL to the Node server:
     - export NEXT_PUBLIC_WS_URL=ws://localhost:4000
     - npm run dev
3) Open two browser windows and join the same room ID. Create or join with (Easy/Medium/Hard + topic). When all 4 players ready, game starts.

Production:
- Provide a DATABASE_URL (PostgreSQL).
- Generate Prisma client and run migrations:
  - npx prisma generate
  - npx prisma migrate deploy
- Start the ws server with the same DATABASE_URL env var. The server will attempt to use Prisma when available, otherwise fall back to in-memory.

Notes:
- Code evaluation uses Node vm with a restricted context. Only pure function problems are supported. Do not rely on this for untrusted internet traffic without sandbox hardening.
- Cursor and collaborative editing events are stubbed and ready to be extended.
- UI is intentionally monochrome, minimal, responsive.

Env:
- NEXT_PUBLIC_WS_URL: ws endpoint, default ws://localhost:4000
- PORT: ws server port (default 4000)
- DATABASE_URL: Postgres connection string for Prisma (optional)
