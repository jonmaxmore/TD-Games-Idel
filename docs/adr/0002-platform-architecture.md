# ADR 0002: Platform architecture

- Status: **superseded by [ADR 0003](0003-node-postgres-backend.md)** (Node.js + PostgreSQL)
- Date: 2026-10-22
- Details: [docs/design/architecture.md](../design/architecture.md)

## Context
The game needs offline story play, async raids, real-time lockstep PvP/co-op, server-trusted economy and IAP, guest accounts, and low latency in Thailand/SEA, built by a small team with low starting cost. The deterministic `packages/sim` already exists and runs in browsers.

## Decision
1. **Cloudflare edge stack:** Workers (API, Hono router) + Durable Objects (`PlayerState`, `Matchmaker`, `MatchRoom`, `GuildRoom`, WebSocket Hibernation) + D1 (relational) + KV (remote config) + R2 (replays/assets) + Queues (verification, analytics, mail).
2. **One rules engine:** `packages/sim` is shared by client and server; the server verifies by re-running replays (seed + commands). Clients never submit outcomes.
3. **Server-authoritative value:** currency, items, pity, MMR and purchases change only inside `PlayerState` / server code; IAP verified server-side and idempotent by transaction id.
4. **Own minimal auth:** guest accounts first; link Apple/Google/email; short-lived JWT access tokens + rotating hashed refresh tokens in D1; short-lived tickets for WebSockets; admin behind Cloudflare Access.
5. **Monorepo packages:** `sim`, `client`, `protocol` (shared types + zod schemas), `server`, `admin`.

## Alternatives considered
- **Dedicated game servers (Colyseus/Nakama on VMs):** more control and proven game features, but ops burden and fixed cost; latency in SEA depends on region choice.
- **Firebase / Supabase backend:** fast auth/DB, but real-time lockstep and per-match state fit Durable Objects better, and running the TypeScript sim server-side is natural on Workers.
- **Third-party auth (Firebase Auth, Clerk):** less code, but guest-first flow and token checks inside DOs add coupling/latency; kept isolated under `/auth` so it can be swapped later.

## Consequences
- Sim CPU cost on the server is the main cost driver; measure in M1 and fall back to sampled verification if needed.
- D1 size limits require splitting databases by domain as the game grows; hot per-player data lives in `PlayerState` DOs.
- Client and server must run the same `sim` version for PvP; enforce with a version gate.
