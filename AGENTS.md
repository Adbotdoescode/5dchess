# 5D Chess — project guide for agents

## What this is

A faithful, 1:1 web replica of **"5D Chess With Multiverse Time Travel"** (Thunkspace, 2020), written in TypeScript. Goals, in priority order:

1. **Exact rules** of the original game: time travel, branching timelines, active/inactive timelines, the Present, multi-board checks, checkmate/stalemate across the multiverse, and all of the original's variants.
2. **The original's look and feel**: flat 2D top-down multiverse on a large grey checkerboard background, small boards with cream/tan squares, purple timeline arrows with dark drop shadows, the vertical "The Present" bar, EB Garamond serif typography, pill buttons at the top ("Undo Move", "Submit Moves", "Deselect"), right-side vertical tabs ("History View", "Parallel View", "Flip Persp."), status text bottom-left ("Your turn - White pieces"). Reference screenshots: Steam guide https://steamcommunity.com/sharedfiles/filedetails/?id=2176513845
3. **Two play modes only**:
   - **Online multiplayer (primary)**, no accounts: one player creates a game and shares a 6-character code (or `/?join=CODE` link), the other joins with it. Built on Supabase (RPC functions + Realtime broadcast).
   - **Local**: one person plays both sides in the same browser.

   The app is **only for playing the game**: menu = Online (create/join/rejoin), Local Match, Guide, Settings. The Guide is a plain-text rules page only (no interactive tutorial, mock gameplay or diagrams). The project owner explicitly does NOT want a computer opponent/AI, puzzles, an interactive tutorial or a credits screen, so don't add them. Piece-art attribution lives as one line in Settings.

## Stack and commands

- Vite + React + TypeScript single-page app, deployed to Vercel as static files (project `adbotdoescodes-projects/5dchess`, production: https://5dchess-three.vercel.app). Pushing to `main` on GitHub (`Adbotdoescode/5dchess`) auto-deploys.
- Three.js for the multiverse view (orthographic top-down by default; optional tilted 3D camera).
- Supabase project `5dchess` (ref `xniodzbzxmcxnbrwhrph`). Env: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (in `.env.local` locally and in Vercel). The Supabase MCP server is configured in `.mcp.json`.
- `npm run dev` · `npm run build` (type-checks) · `npx vitest run` (tests) · `npm run lint`.

## Architecture

```
src/engine/   Pure TypeScript rules engine. No DOM, no React. types.ts is the public contract.
src/render/   Three.js multiverse renderer. Dumb view: takes a RenderModel, emits square clicks. types.ts is the contract.
src/net/      Supabase client, online sessions (join codes, realtime sync). types.ts is the contract.
src/ui/       React app shell: menus, HUD, game controller wiring engine + renderer + net, sounds.
supabase/     SQL migrations for the `games` table and RPCs.
docs/         Rules/UI research notes (ui-spec.md = the original's UI; parts about puzzles/guide/CPU are out of scope).
```

Rules for module boundaries:
- `engine` imports nothing from other modules. `render` imports only engine **types**. `net` imports only engine types. `ui` wires everything.
- The three `types.ts` files are the contracts between modules. Extend them rather than reaching into another module's internals; keep changes backwards-compatible.

## Rules engine conventions (see src/engine/types.ts)

- Time is in half-turns: `t = 2*T + (black ? 1 : 0)`. A board at `t` is the position where `colorAt(t)` is to move.
- Timeline `l`: main line 0; timelines created by white are positive, black negative (5D PGN). Even-timeline variants use half-integers (±0.5, ±1.5, ...). `Timeline.label` holds the notation name.
- Squares: `x` file (0 = a), `y` rank (0 = rank 1).
- Notation: 5D PGN as used by the open-source community (e.g. `(0T1)Nb1c3`, `(0T7)Qd1>>(0T5)d3`).
- Tests are differential-checked against the AGPL `5d-chess-js` package (devDependency only; never imported from `src/` app code).

## Online play (Supabase)

- Table `public.games` has RLS enabled and **no policies**; clients never touch it directly. All access goes through security-definer RPCs: `create_game`, `join_game`, `get_game`, `submit_action`, `set_result`. A seat is owned by whoever holds its random token (stored hashed; the client keeps it in localStorage).
- Live updates go over a Realtime broadcast channel `game:<CODE>` (with presence). The database is the source of truth; broadcasts are hints that the client reconciles with `get_game`.
- Both clients run the same engine and validate every action they receive.

## Licensing — important

The reference implementations (chess-in-5d, 5d-chess-js, 5d-chess-renderer: https://github.com/NKID00/chess-in-5d-stripped, https://github.com/NKID00/5d-chess-js, https://gitlab.com/5d-chess/5d-chess-renderer) are **AGPL-3.0**. Use them only to understand the rules and as a test oracle. **Do not copy their code or assets into `src/`.** Standard piece art comes from the cburnett set (Colin M.L. Burnett, multi-licensed on Wikimedia Commons), used under its BSD license option, with credits in `src/render/pieces/README.md`.

## Original-game reference notes

Owner-supplied rules background (movement in 4D, board layout, move order, checks against past kings): `docs/reference-blog.md`. It is a helpful fan guide, NOT a source of truth: verify its claims against the original game, which always wins.

- Pieces: P N B R Q K plus U (unicorn: any distance along a triagonal, i.e. 3 axes), D (dragon: 4 axes), S (princess: rook + bishop), W (brawn: pawn variant), C (common king: non-royal king), Y (royal queen: royal piece moving as a queen). Movement axes are x, y, l (timeline) and T (full turns; moving "1 step in time" means 2 half-turns, landing on a board of the same color).
- Moving to a past board (or any non-end board) creates a new timeline. Moving to another timeline's playable end board does not.
- A player may create at most one more *active* timeline than the opponent; extra ones are inactive (drawn with a white/black arrow instead of purple) until the opponent catches up.
- The Present is the earliest end-board time over active timelines; you must move on every active timeline whose end board is at the Present before you can submit.
- You may make moves that leave your king in check; you just can't submit while in check (red arrows show the threats).
