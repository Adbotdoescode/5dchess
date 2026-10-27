---
name: online-play
description: Use when touching online multiplayer — src/net/, supabase/ (migrations, RPCs, the game-action Edge Function), clocks, join codes, draws/rematches — or when deploying the server or cleaning up test games in the database.
---

# Online play (Supabase, server-authoritative)

Supabase project `5dchess` (ref `xniodzbzxmcxnbrwhrph`), reachable via the Supabase MCP (`.mcp.json`). Client contract: `src/net/types.ts` (the UI depends on its method names; only add).

## Design
- **The table:** `public.games` has RLS on and **no policies**; clients never read it directly. A seat belongs to whoever holds its random token; the DB stores only the hash, and the client keeps the token in localStorage.
- **Edge Function `game-action`** (`supabase/functions/game-action/`, `verify_jwt=false`) is the only way to create games, submit actions and claim results. It authenticates the token and replays the stored actions with the bundled engine, then:
  - rejects illegal actions (HTTP 422)
  - stores the engine's normalized action
  - computes `nextActiveTimelines` itself
  - detects mate/stalemate in the background (about 1.6 s CPU budget; inconclusive means the game continues)
- **Service-role-only RPCs:** `create_game`, `submit_action`, `set_result`.
- **Public, token-checked RPCs:** `join_game`, `get_game`, `offer_draw`, `answer_draw`, `cancel_game`, `offer_rematch`. Advisors warn about these SECURITY DEFINER functions. That warning is expected; anything else needs fixing.
- **Draws and rematches:** a draw needs a stored offer from the OTHER seat. Draw offers, rematch offers and codes are persisted so they survive reloads. A rematch copies both seat hashes with colours swapped.
- **Realtime:** broadcast channel `game:<CODE>` with presence. Broadcasts only trigger a DB re-read, so never trust their payload.
- **Clocks:** the original's main time plus a delay of N seconds × active timelines at the start of each turn (presets 10+3/L, 20+5/L, 40+8/L). The same formula lives in `src/net/clock.ts` (`computeClocks`) and SQL `_clock_remaining_ms`; change both together.

## Changing the backend
- **Migrations:** apply with MCP `apply_migration`, then save the same SQL as `supabase/migrations/<version>_<name>.sql`. The version must match the remote history (check with `list_migrations`). Keep `set search_path = ''`, validate inputs, and add no table policies.
- **Function:** edit `supabase/functions/game-action/`. If the engine changed, run `npm run build:edge` first. Deploy with MCP `deploy_edge_function`, which takes the file contents inline (index.ts, logic.ts, `_shared/engine.js`).
- **Deploy order matters.** When a change revokes or renames something the deployed client calls, ship the client first or keep both working, otherwise production online play breaks. This has happened once.
- Run `get_advisors` (security) after DDL.

## Testing and cleanup
- `npx vitest run src/net` runs unit tests with a fake backend.
- `NET_LIVE=1 npx vitest run src/net/live.test.ts` is the live end-to-end test against production. It deletes its own rows.
- `cd supabase/functions && deno test game-action/` runs the function's tests (Deno is installed).
- **Test games:** browser tests against the live backend create real rows. Note every code you create and delete them afterwards (`delete from public.games where code in (…)`). Never bulk-delete rows you can't attribute to a test; they may be real players' games.
