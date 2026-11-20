# AGENTS.md — instructions for AI coding assistants

Read this before changing anything. Humans: see `README.md` (what/why) and `CONTRIBUTING.md` (setup/workflow).

## What this is
NoteBattle: upload notes/PDF → an LLM writes multiple-choice questions → players join from phones with a 6-letter room code → live quiz battle (timer, streaks, scoreboard) → per-topic "what to revise" report. Every question carries an `evidence` quote from the notes that is verified in code.

Live: web https://notebattle.vercel.app · server https://notebattle-server.onrender.com. **Every push to `main` deploys to production automatically** (Vercel + Render), so `main` must always pass `pnpm check`.

## Layout (pnpm workspaces + Turborepo, TypeScript strict)
| Path | Role | Rules |
|---|---|---|
| `packages/protocol` | Wire contract: Zod schemas + typed Socket.IO event maps (`ClientToServer`, `ServerToClient`), `RoomView`, `GenerationEvent` | Change this FIRST when the contract changes; let `tsc` show every call site |
| `packages/engine` | Pure game state machine: `reduce(state, command, now)` + view projections (`hostView`, `playerView`) | No I/O, no `Date.now()`, no randomness except the seeded RNG. All game rules live here |
| `packages/quizgen` | `extract.ts` (PDF/text, chunking) → `generate.ts` (LLM) → `quality.ts` (evidence + checks) → `verify.ts` (re-solve) ; `offline.ts` (no-LLM generator) ; `llm.ts` (OpenAI-compatible fetch client) | Deterministic checks first, LLM calls last |
| `apps/server` | Fastify 5 + Socket.IO 4. `rooms.ts` (RoomManager: timers, sessions, persistence), `socket.ts` (validated, rate-limited handlers), `app.ts` (HTTP routes), `db/` (Drizzle schema, repo, migrations) | Thin shell around the engine; validate every payload with protocol schemas |
| `apps/web` | Next.js 16 App Router, React 19, Tailwind v4, Motion. Pages: `/`, `/create`, `/host/[code]`, `/play/[code]`, `/results/[id]` | UI only; never compute scores or correctness client-side |
| `e2e/` | Playwright: host + 3 phones play a full game | Keep green; it also regenerates `docs/screens/*.png` |

## Commands
- `pnpm install` · `pnpm demo` (server :4000 offline/in-memory + web :3000)
- `pnpm check` — typecheck + all unit/integration tests. **Run before every push.**
- `pnpm e2e` — full browser battle (first time: `pnpm exec playwright install chromium`)
- `pnpm --filter @notebattle/<pkg> test` for one package
- DB (optional): `pnpm db:up` (Docker Postgres on :5434), `pnpm db:migrate`; schema change → edit `apps/server/src/db/schema.ts`, then `pnpm --filter @notebattle/server db:generate --name <change>` and commit the new file in `apps/server/drizzle/`

## Invariants (never break these)
1. **Anti-cheat:** while `phase === "question"`, no view may reveal the answer, explanation, evidence, or anything derived from correctness (score/streak/rank deltas). Property tests in `packages/engine/test` and the websocket test in `apps/server/test` enforce this; extend them if you add view fields.
2. **Server authority:** scoring, deadlines, one answer per player, host actions — decided only by the engine/server.
3. **Grounding:** a generated question without an evidence quote found in its source chunk is rejected. Don't weaken `evidenceSupported` or skip `checkQuestion`.
4. **No vendor lock-in:** LLM access only through `quizgen/src/llm.ts` (OpenAI-compatible, env `NOTEBATTLE_LLM_BASE_URL/MODEL/API_KEY`). Don't add provider SDKs. The offline mode must keep working with no key (tests/CI run offline).
5. **Secrets:** never commit `.env*` files (only `.env.example`), never print keys or DB URLs, never put secrets in client code (`NEXT_PUBLIC_*` is public).
6. **Tests with behaviour:** every behaviour change comes with a test. Tests must never touch real credentials (`NOTEBATTLE_SKIP_DOTENV=1`).

## Conventions
- Imports inside packages use `.js` extensions (ESM). Workspace packages export TS source (no build step) — the server bundles them with tsup.
- `"use client"` modules can't export plain functions to server components (put shared helpers in non-client files, e.g. `apps/web/components/styles.ts`).
- Don't wrap groups of buttons in `<label>` (breaks accessible names and the e2e selectors).
- User-facing error messages are short and friendly; internal errors are logged, not sent to clients.
- Commit messages: imperative, describe the why. **Do not add AI co-author / "generated with" trailers.**
- Small focused commits; pull with `git pull --rebase` before pushing.

## Gotchas
- pnpm 12 blocks dependency install scripts: new native deps need an `allowBuilds` entry in `pnpm-workspace.yaml` or CI install fails.
- Turbo filters env vars: new env vars used in tasks must be listed in `turbo.json` (`globalPassThroughEnv` or task `env`).
- Render free tier sleeps after 15 min idle (~1 min wake); the web `ServerStatus` component pings `/healthz` to hide it.
- Migrations run on server boot (`apps/server/src/db/migrations.ts`); they must stay backward-compatible with the running version.

## Good first tasks
- "Play again" on the final screen: new room with the same deck (protocol event + RoomManager + host UI + test).
- OCR for scanned PDFs (fall back when `extractPages` finds < 200 chars).
- Dockerfile for the server; accounts + per-user topic history.
