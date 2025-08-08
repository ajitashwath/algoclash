-- PostgreSQL schema for Prisma (manual SQL if you’re not using Prisma Migrate yet)
CREATE TABLE IF NOT EXISTS problems (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  signature TEXT NOT NULL,
  examples TEXT NOT NULL,
  boilerplate TEXT NOT NULL,
  difficulty TEXT NOT NULL,
  topic TEXT NOT NULL,
  function_name TEXT NOT NULL,
  tests JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  difficulty TEXT NOT NULL,
  topic TEXT NOT NULL,
  started BOOLEAN NOT NULL DEFAULT false,
  winner TEXT
);

CREATE TABLE IF NOT EXISTS room_users (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  team TEXT NOT NULL,
  ready BOOLEAN NOT NULL DEFAULT false,
  attempts INT NOT NULL DEFAULT 0,
  errors INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES room_users(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  ok BOOLEAN NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);
