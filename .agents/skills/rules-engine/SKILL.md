---
name: rules-engine
description: Use when changing or debugging game rules or anything in src/engine/ (move generation, timelines, the Present, check/mate, variants, 5D PGN/FEN). Covers coordinate conventions, deliberate rule decisions, the differential test oracle, and the mandatory server redeploy after engine changes.
---

# Rules engine (`src/engine/`)

Pure TypeScript, no DOM/React; it also runs on the server (Supabase Edge Function). `src/engine/types.ts` is the public contract: extend it backwards-compatibly; don't rename or remove anything.

## Conventions
- Time is in half-turns: `t = 2*T + (black ? 1 : 0)`. A board at `t` is the position where `colorAt(t)` is to move. Turn-zero variants start at `t = 0`.
- Timeline `l`: main line 0, created by white `> 0`, by black `< 0` (5D PGN). Even-timeline variants (e.g. Two Timelines, "-0"/"+0") use half-integers ±0.5, ±1.5, …; `Timeline.label` holds the notation name. Adjacent timelines differ by exactly 1.
- Squares: `x` = file (0 = a), `y` = rank (0 = rank 1).
- Notation: community 5D PGN, e.g. `(0T1)Nb1c3`, `(0T7)Qd1>>(0T5)d3`. A branch that creates an active timeline ends in `~`.
- `snapshot()` returns fresh top-level objects but **reuses frozen `Board` instances** for unchanged boards; the renderer caches textures by identity. Never mutate an exposed Board.

## Deliberate rule decisions (the original game wins over the oracle)
- **Castling through check** counts attacks from every board (`castlingRule: 'multiverse'`, the default). The oracle checks only the castling board (`'board'`). This rule is unconfirmed against the original.
- **Promotion** is queen-only, including the Princess variant.
- **Mate search** (`mate.ts`) is exact (hypercuboid-style). It has a time budget (`mateTimeBudgetMs`, default 2000). On timeout the game stays ongoing and `mateSearchInconclusive` is set.
- **Moves that leave your king in check** are allowed tentatively; only submit is blocked. Checks include attacks on royal pieces on **past** boards.
- **Pawn timeline captures:** one timeline forward + one turn back or forward, on the same square. The brawn also gets the extra combinations.

## Testing
- `npx vitest run src/engine`: unit tests plus a differential fuzz against the AGPL `5d-chess-js` (a devDependency, used **only** inside tests; never import it from app code). Bigger runs: `FUZZ_GAMES=500 FUZZ_SEED=… FUZZ_ACTIONS=…`.
- Every mismatch with the oracle is either our bug or a documented whitelist entry, with a comment saying why the original differs.
- Variants live in `variants.ts` (45 entries; ids are stored in online games, so never rename one).

## After ANY engine change: redeploy the server
The online server replays games with a bundled copy of the engine, so a stale bundle rejects legal moves or accepts illegal ones.
1. `npm run build:edge` (writes `supabase/functions/_shared/engine.js`).
2. Redeploy the `game-action` Edge Function.
3. Run `NET_LIVE=1 npx vitest run src/net/live.test.ts`.
