# Contributing

## One-time setup

1. Install **Node 22+** (https://nodejs.org), **pnpm** (`npm install -g pnpm`) and **Git**.
2. Clone and install:
   ```bash
   git clone https://github.com/eRac3R/notebattle.git
   cd notebattle
   pnpm install
   ```
3. Run it: `pnpm demo`, then open http://localhost:3000 and use "Try sample OS notes".
   No keys or database are needed: it runs in offline mode with an in-memory store.

Optional:
- **Real AI questions:** get your own free key at https://console.groq.com, copy `apps/server/.env.example` to `apps/server/.env.local` and fill in the `NOTEBATTLE_LLM_*` lines. Never commit `.env.local` or paste keys in chat (it is git-ignored).
- **Postgres:** install Docker, run `pnpm db:up`, set `DATABASE_URL` as shown in `.env.example`, then run `pnpm db:migrate`.
- **End-to-end test:** run `pnpm exec playwright install chromium` once, then `pnpm e2e`.

## Workflow

Never push straight to `main`. Use a branch and a pull request:

```bash
git switch main && git pull               # start from the latest main
git switch -c feat/short-description      # one branch per change
# ...edit...
pnpm check                                # typecheck + tests must pass
git add -A && git commit -m "Add X"
git push -u origin feat/short-description
```

Then open a pull request on GitHub. CI runs automatically. The other person reviews and merges it.

Rules of thumb:
- Keep PRs small, with one feature or fix each.
- Add or adjust tests with every behaviour change.
- Using an AI assistant? It should read `AGENTS.md` (Claude Code, Cursor, Codex and Copilot pick it up automatically).
- Game rules belong in `packages/engine` (pure and tested), not in the server or UI.
- If you change the wire contract, change `packages/protocol` first; TypeScript will then show every place that needs updating.
