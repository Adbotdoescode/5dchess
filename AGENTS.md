# 5D Chess: guide for agents

## Keep this file current

Keep this file current. Fix anything here that is outdated, wrong or missing as part of your change; letting it go stale is leaving the work unfinished. The same applies to every skill (`.agents/skills/`, linked as `.claude/skills/`): any skill you notice has gone out of date must be updated too. Keep this file at or under 150 lines.

Maintenance here is **zero-sum**. The line budget is the point, not an accident: a file nobody finishes reading guides nothing. So the test for whether something belongs here is not "is this true and useful" (almost everything is) but:

**Is this worth removing something else to make room for?**

If no, it doesn't go here. If yes, name what you are cutting and cut it in the same change. Only when there is genuinely spare room may you add without removing. Three questions settle most cases:

1. **Does it have a detectable trigger?** ("when changing the rules engine", "when touching the online backend", "when verifying in a browser") Then it belongs in a skill, which loads exactly when needed and costs nothing otherwise. This is the default answer; prefer it.
2. **Is it broad and unconditional,** something every change in this repository must respect regardless of what it touches? Then it belongs here.
3. **Otherwise** it is bloat. Delete it, or leave it as a comment beside the code it describes, which is where a narrow fact stays honest longest.

## What this is

A faithful 1:1 web replica of the game **"5D Chess With Multiverse Time Travel"** (Thunkspace, 2020), in TypeScript. Open source (MIT), public at `github.com/Adbotdoescode/5dchess`, live at https://5dimensionalchess.vercel.app. Priorities, in order:

1. **Exact rules** of the original: time travel, branching timelines, active/inactive timelines, the Present, checks across the multiverse (including against kings on past boards), checkmate/stalemate, and all of the original's variants.
2. **The original's look and feel**, down to the pixel: layout, colours, typography, animations, camera behaviour, sounds.
3. **Two play modes only:** online (the primary mode; no accounts, join by a 6-character code or `/?join=CODE` link) and local (one person plays both sides in one browser).

## Scope (owner decisions; don't override them)

- **The menu is exactly:** Online (create / join / rejoin), Local Match, Guide, Settings.
- **The Guide** (`src/ui/components/Guide.tsx`) is a plain-text rules page: headings and paragraphs only.
- **Never add:** a computer opponent/AI, puzzles, an interactive tutorial or mock gameplay, a credits screen, public matchmaking, or accounts.

## Rules every change must respect

- **The original game is the only authority** on rules and behaviour. Not other implementations, not fan guides, not the test oracle. When they disagree, follow the original and leave a comment explaining the difference.
- **No external links or source citations** in code, comments, docs or skills (no footage, posts, guides or other implementations). The repository is contributor-facing and must stand on its own. Record measured facts as plain facts.
- **Licensing:**
  - The project is MIT (`LICENSE`).
  - Other implementations of this game exist under the AGPL. Never copy their code or assets.
  - The AGPL npm package `5d-chess-js` is a devDependency used **only inside tests** as an oracle. Never import it from app or server code.
  - Piece art is the cburnett set under its BSD option. Its notice lives in the header of `src/render/pieces/cburnett.ts` and must stay there. Don't add attribution to README files; the owner places the visible credit.
- **Module boundaries:**
  - `src/engine` imports nothing from other modules.
  - `src/render` and `src/net` import only engine **types**.
  - `src/ui` wires everything together.
  - The `types.ts` in engine, render and net are the contracts. Extend them backwards-compatibly; never reach into another module's internals.
- **Pushing to `main` deploys to production immediately** (there is no staging). Before pushing, `npm run build`, `npm run lint` and `npx vitest run` must pass, unless the owner explicitly says to skip them.
- **Commit only source.** Scripts, screenshots, footage and test output from your own verification stay outside the repo.
- **Keep the human docs in sync.** When rules, controls or modes change, update the in-game Guide and `docs/` in the same change. `docs/` is written for humans: short, plain and minimal.
- **Writing style:** match the surrounding code's naming, idioms and comment density. Don't add emojis.

## Stack and commands

- **Build:** Vite + React 19 + TypeScript (strict, `erasableSyntaxOnly`, `verbatimModuleSyntax`: no enums or parameter properties; use `import type`).
- **Rendering:** Three.js, with one orthographic camera that tilts between the flat view and History/Parallel View.
- **Hosting:** a static SPA on Vercel. Online play runs on Supabase (Postgres + Realtime + one Edge Function), project `5dchess`; the Supabase MCP server is configured in `.mcp.json`.
- **Env:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` live in `.env.local` (gitignored; see `.env.example`) and in Vercel.
- **Commands:**
  - `npm run dev` · `npm run build` (type-checks) · `npm run lint` (oxlint) · `npx vitest run`
  - `npm run build:edge` bundles the engine for the server.

## Layout

```
src/engine/      Rules engine: pure TypeScript, no DOM; also runs on the server.
src/render/      Three.js multiverse renderer (a dumb view: RenderModel in, square clicks out).
  cinematic/     The original's full-screen time-travel cinematic (self-contained overlay).
src/net/         Online sessions: Supabase client, join codes, realtime sync, clocks.
src/ui/          React app: menus, HUD, game controller wiring engine + renderer + net, sounds.
supabase/        SQL migrations and the `game-action` Edge Function (server-authoritative play).
scripts/         build-edge.mjs (engine bundle for the Edge Function).
docs/            Human documentation (rules, playing, development).
.agents/skills/  Task-specific agent knowledge (loaded on demand).
render-demo.html, cinematic-demo.html   Dev-only harness pages.
```
