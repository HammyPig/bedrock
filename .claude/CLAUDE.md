# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Bedrock is invoicing software designed specifically for small businesses. Keep that audience in mind when designing features.

Stack: T3 (Next.js 15 App Router, React 19, tRPC v11, Drizzle ORM + Postgres, NextAuth v5 beta with Google OAuth, Tailwind v4, shadcn/ui). Path alias `~/*` → `src/*`.

## Commands

Bun is the package manager.

```bash
bun dev                  # dev server
bun run check            # next lint && tsc --noEmit — use this to verify changes
bun run format:write     # oxfmt (also sorts Tailwind classes)
./start-database.sh      # local Postgres container (reads DATABASE_URL from .env)
bun run db:push          # push schema changes (dev workflow; also db:generate / db:migrate / db:studio)
```

There is no test framework.

## Gotchas & conventions

- Env vars: `src/env.js` is the source of truth — a new var goes in its schema **and** its `runtimeEnv` block, plus `.env.example`.
- DB tables must be created via `createTable` in `src/server/db/schema.ts` (prefixes names with `bedrock_`); drizzle-kit filters on `bedrock_*`, so tables defined any other way are silently ignored.
- A dev-only tRPC middleware adds 100–500ms artificial latency to every procedure — don't mistake it for a real perf problem.
- Money is integer cents everywhere; format only at render (`src/app/invoices/new/_lib/money.ts`).
