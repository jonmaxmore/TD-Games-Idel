# ADR 0003: Node.js + PostgreSQL backend (supersedes ADR 0002)

- Status: superseded by [ADR 0006](0006-csharp-everywhere.md) (C# everywhere) on 2026-10-23; the data, money-safety and auth parts carry over
- Date: 2026-10-22
- Supersedes: [ADR 0002](0002-platform-architecture.md) (Cloudflare Workers / Durable Objects / D1)
- Details: [docs/design/architecture.md](../design/architecture.md)

## Context
The product owner asked for a mid-level, conventional backend: no SQLite (which rules out D1), and a choice between Node.js and Go. The server must run the same deterministic rules as the client to verify replays and to referee ranked PvP; those rules already exist in TypeScript (`packages/sim`).

## Decision
- **Language:** Node.js 22 + TypeScript for every backend service, so `packages/sim` runs unchanged on the server.
- **Services:** `api` (Fastify REST, stateless), `game` (WebSocket rooms, lockstep, matchmaking), `worker` (BullMQ jobs: replay verification, mail/push, analytics, season rollover).
- **Data:** PostgreSQL 16 as the system of record (Drizzle ORM + migrations); Redis 7 for cache, rate limits, matchmaking queues, room registry, leaderboards, job queues and pub/sub; S3-compatible object storage for replays and assets.
- **Money safety:** wallet changes only in PostgreSQL transactions with row locks, an append-only `wallet_ledger`, and idempotency keys; IAP granted once per transaction id.
- **Auth:** unchanged in spirit from ADR 0002: guest-first, Apple/Google/email linking, short-lived ES256 JWTs, rotating hashed refresh tokens, single-use WebSocket tickets.
- **Runtime:** Docker images for all services; local via Docker Compose; production in a Singapore region on a managed container platform with managed PostgreSQL/Redis (provider chosen before M1 staging).

## Why not Go
Go is excellent for concurrent network servers, but the authoritative rules are TypeScript. Go would mean either a second implementation of the rules that must match tick-for-tick (high desync risk and double maintenance) or embedding a JS engine (slower, more complex). If the relay ever becomes the bottleneck, only the message relay can move to Go while verification stays in Node.

## Consequences
- One language across client, server and tools; shared types via `packages/protocol`.
- More operational work than the edge/serverless design: containers, database, Redis, backups and scaling are ours to run (mitigated by managed services).
- WebSocket game servers need sticky routing by room id and a Redis room registry.
- Server CPU for replay verification remains the main cost driver; measure in M1.
