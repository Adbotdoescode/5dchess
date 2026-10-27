# Development

## Setup
```sh
npm install
cp .env.example .env.local   # fill in your Supabase URL and publishable key (online play only)
npm run dev
```
Local Match works without Supabase. Online play needs a Supabase project with the migrations in `supabase/migrations/` applied and the `supabase/functions/game-action` function deployed.

## Commands
| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Type-check and production build |
| `npm run lint` | Lint (oxlint) |
| `npx vitest run` | Tests |
| `npm run build:edge` | Bundle the rules engine for the server function (run after any engine change) |

## How it's built
- `src/engine/`: the rules, in plain TypeScript. The server uses the same code, so online games are validated move by move.
- `src/render/`: the Three.js view of the multiverse, including History/Parallel View and the time-travel animation.
- `src/net/`: online games (join codes, live updates, clocks).
- `src/ui/`: the React app (menus, on-screen controls, settings).
- `supabase/`: database migrations and the server function that checks every online move.

## Contributing
- The goal is a faithful replica of the original game. Match its rules and its look and feel; don't invent features.
- Keep `docs/` and the in-game Guide up to date when behaviour changes.
- `main` deploys to production on every push, so make sure build, lint and tests pass first.
- MIT licensed. Don't copy code or art from other implementations of this game.
