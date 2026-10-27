// Server-authoritative game logic for the `game-action` Edge Function.
// Pure: all I/O goes through `Deps`, so it is unit-testable with Deno
// (logic_test.ts) and the engine bundle (../_shared/engine.js, built from
// src/engine by `npm run build:edge`).
//
// Ops (POST JSON):
//   {op:'create', variantId, color, token, clock}           -> game JSON
//   {op:'submit', code, token, index, action}               -> game JSON
//   {op:'result', code, token, result}                      -> game JSON
// Draw offers, cancel and rematch are plain token-checked RPCs (no engine needed).

import { Game, findVariant } from '../_shared/engine.js'
import type { Action, Color, GameResult, Move, PieceType, Pos } from '../_shared/engine.js'

// ---------------------------------------------------------------- deps

export class DbError extends Error {}

export interface Deps {
  /** Call a Postgres RPC with the service role. Throws DbError(message) on a database error. */
  rpc(fn: string, args: Record<string, unknown>): Promise<unknown>
  /** Monotonic ms clock. */
  now(): number
  /** Keep the worker alive for background work (EdgeRuntime.waitUntil). */
  background(p: Promise<unknown>): void
  /** Send a Realtime broadcast hint on `game:<code>` (best effort). */
  broadcast(code: string, payload: unknown): Promise<void>
  log(msg: string, data?: Record<string, unknown>): void
}

/** Request error with an HTTP status and a stable machine-readable code. */
export class HttpError extends Error {
  status: number
  code: string
  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

/**
 * Total CPU budget we allow ourselves per request. Supabase Edge Functions are
 * killed after ~2 s of CPU time, so replay + mate search must stay below it.
 */
export const CPU_BUDGET_MS = 1600
/** Minimum time given to a checkmate/stalemate search. */
const MIN_SEARCH_MS = 150

export interface Timing {
  [phase: string]: number
}

export interface Outcome {
  body: unknown
  timing: Timing
}

// ---------------------------------------------------------------- stored game JSON

interface GameJson {
  code: string
  variantId: string
  myColor: Color | 'spectator'
  actions: Record<string, unknown>[]
  result: GameResult
  opponentJoined: boolean
  cancelled?: boolean
  [k: string]: unknown
}

function asGame(data: unknown): GameJson {
  const g = data as GameJson
  if (!g || typeof g !== 'object' || typeof g.code !== 'string' || !Array.isArray(g.actions)) {
    throw new HttpError(500, 'bad_db_response', 'unexpected database response')
  }
  return g
}

/** Stored actions minus the server stamps. */
function storedActions(g: GameJson): Action[] {
  return g.actions.map((raw) => {
    const { at: _at, nextActiveTimelines: _n, ...rest } = raw
    return rest as unknown as Action
  })
}

const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white')

function activeTimelines(g: Game): number {
  return g.snapshot().timelines.filter((t) => t.active).length
}

// ---------------------------------------------------------------- input validation

const PIECES = new Set<PieceType>(['P', 'N', 'B', 'R', 'Q', 'K', 'U', 'D', 'S', 'W', 'C', 'Y'])
const MAX_MOVES = 500

function str(v: unknown, field: string, max = 128): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > max) throw new HttpError(400, 'bad_request', `invalid ${field}`)
  return v
}

function pos(v: unknown): Pos {
  const p = v as Record<string, unknown>
  if (!p || typeof p !== 'object') throw new HttpError(422, 'illegal', 'malformed move')
  const num = (k: string, int: boolean) => {
    const n = p[k]
    if (typeof n !== 'number' || !Number.isFinite(n) || Math.abs(n) > 10000 || (int && !Number.isInteger(n))) {
      throw new HttpError(422, 'illegal', 'malformed move')
    }
    return n
  }
  // l may be a half-integer in even-timeline variants
  const l = num('l', false)
  if (!Number.isInteger(l * 2)) throw new HttpError(422, 'illegal', 'malformed move')
  return { l, t: num('t', true), x: num('x', true), y: num('y', true) }
}

/** Reduce a client action to the fields the engine reads (from/to/promotion). */
function sanitizeAction(v: unknown, seat: Color): Action {
  const a = v as Record<string, unknown>
  if (!a || typeof a !== 'object' || !Array.isArray(a.moves)) throw new HttpError(422, 'illegal', 'malformed action')
  if (a.player !== seat) throw new HttpError(403, 'wrong_seat', 'action player does not match your seat')
  if (a.moves.length === 0 || a.moves.length > MAX_MOVES) throw new HttpError(422, 'illegal', 'malformed action')
  const moves: Move[] = a.moves.map((raw: unknown) => {
    const m = raw as Record<string, unknown>
    if (!m || typeof m !== 'object') throw new HttpError(422, 'illegal', 'malformed move')
    const move: Move = { from: pos(m.from), to: pos(m.to) }
    if (m.promotion !== undefined && m.promotion !== null) {
      if (typeof m.promotion !== 'string' || !PIECES.has(m.promotion as PieceType)) {
        throw new HttpError(422, 'illegal', 'malformed move')
      }
      move.promotion = m.promotion as PieceType
    }
    return move
  })
  return { player: seat, moves }
}

function illegalReason(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/must-move-present/.test(msg)) return 'you must move on every board in the present before submitting'
  if (/in-check/.test(msg)) return 'that action leaves your king in check'
  if (/not playable/.test(msg)) return 'a move starts on a board that is not playable'
  if (/no piece of the current player/.test(msg)) return 'a move starts on a square without one of your pieces'
  if (/Promotion/.test(msg)) return msg
  if (/^Illegal move/.test(msg)) return 'a move is not legal in this position'
  return msg
}

// ---------------------------------------------------------------- core

function replay(g: GameJson): Game {
  try {
    return Game.fromActions(g.variantId, storedActions(g), { skipMateDetection: true })
  } catch (e) {
    throw new HttpError(409, 'corrupt_history', `stored game history is invalid (${e instanceof Error ? e.message : e})`)
  }
}

type EndVerdict = { kind: 'over'; result: GameResult } | { kind: 'continues' } | { kind: 'inconclusive' }

/** Checkmate/stalemate for the player to move, as the engine defines it. */
export function judgeEnd(game: Game, budgetMs: number): EndVerdict {
  const has = game.hasLegalAction(Math.max(budgetMs, MIN_SEARCH_MS))
  if (has === null) return { kind: 'inconclusive' }
  if (has) return { kind: 'continues' }
  return {
    kind: 'over',
    result: game.isInCheck() ? { kind: 'checkmate', winner: opposite(game.player) } : { kind: 'stalemate' },
  }
}

async function load(deps: Deps, code: string, token: string): Promise<GameJson> {
  return asGame(await deps.rpc('get_game', { p_code: code, p_token: token }))
}

function requireSeat(g: GameJson): Color {
  if (g.myColor !== 'white' && g.myColor !== 'black') throw new HttpError(403, 'not_player', 'not a player in this game')
  return g.myColor
}

/** Record a server-determined end and tell the clients. */
async function recordEnd(deps: Deps, code: string, token: string, expectedLen: number, result: GameResult): Promise<unknown> {
  const stored = await deps.rpc('set_result', {
    p_code: code,
    p_token: token,
    p_result: result,
    p_expected_len: expectedLen,
  })
  await deps.broadcast(code, { t: 'result' })
  return stored
}

async function opCreate(deps: Deps, req: Record<string, unknown>, timing: Timing): Promise<unknown> {
  const variantId = str(req.variantId, 'variant', 64)
  const token = str(req.token, 'token')
  const v = findVariant(variantId)
  if (!v) throw new HttpError(400, 'unknown_variant', `unknown variant "${variantId}"`)
  const t0 = deps.now()
  const g = Game.create(v.id, { skipMateDetection: true })
  const firstPlayer = g.player
  const firstActive = activeTimelines(g)
  timing.engine = deps.now() - t0
  return deps.rpc('create_game', {
    p_variant: v.id,
    p_color: req.color,
    p_token: token,
    p_clock: req.clock ?? null,
    p_first: firstPlayer,
    p_first_active_timelines: firstActive,
  })
}

async function opSubmit(deps: Deps, req: Record<string, unknown>, timing: Timing): Promise<unknown> {
  const start = deps.now()
  const code = str(req.code, 'code', 16).toUpperCase()
  const token = str(req.token, 'token')
  const index = req.index
  if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) throw new HttpError(400, 'bad_request', 'invalid index')

  let t = deps.now()
  const g = await load(deps, code, token)
  timing.load = deps.now() - t
  const seat = requireSeat(g)
  if (g.cancelled) throw new HttpError(409, 'cancelled', 'game was cancelled')
  if (g.result.kind !== 'ongoing') throw new HttpError(409, 'game_over', 'game is over')
  if (!g.opponentJoined) throw new HttpError(409, 'waiting', 'waiting for opponent')
  if (index !== g.actions.length) throw new HttpError(409, 'out_of_sync', `out of sync: expected index ${g.actions.length}`)
  const action = sanitizeAction(req.action, seat)

  t = deps.now()
  const game = replay(g)
  timing.replay = deps.now() - t
  if (game.player !== seat) throw new HttpError(409, 'not_your_turn', 'not your turn')

  t = deps.now()
  try {
    game.applyAction(action)
  } catch (e) {
    throw new HttpError(422, 'illegal', `illegal action: ${illegalReason(e)}`)
  }
  const canonical = game.history[game.history.length - 1]
  const next = activeTimelines(game)
  timing.validate = deps.now() - t
  if (typeof req.nextActiveTimelines === 'number' && req.nextActiveTimelines !== next) {
    deps.log('client active-timeline count differs (server value used)', { code, index, client: req.nextActiveTimelines, server: next })
  }

  t = deps.now()
  const stored = asGame(
    await deps.rpc('submit_action', {
      p_code: code,
      p_token: token,
      p_index: index,
      p_action: canonical,
      p_next_active_timelines: next,
    }),
  )
  timing.store = deps.now() - t

  if (stored.actions.length > index && stored.result.kind === 'ongoing') {
    // Checkmate / stalemate detection for the opponent, after responding.
    const budget = CPU_BUDGET_MS - (deps.now() - start)
    deps.background(
      (async () => {
        const s = deps.now()
        const verdict = judgeEnd(game, budget)
        deps.log('end check', { code, index, verdict: verdict.kind, ms: Math.round(deps.now() - s) })
        if (verdict.kind === 'over') await recordEnd(deps, code, token, index + 1, verdict.result)
      })().catch((e) => deps.log('end check failed', { code, error: String(e) })),
    )
  }
  return stored
}

async function opResult(deps: Deps, req: Record<string, unknown>, timing: Timing): Promise<unknown> {
  const start = deps.now()
  const code = str(req.code, 'code', 16).toUpperCase()
  const token = str(req.token, 'token')
  const result = req.result as Record<string, unknown>
  if (!result || typeof result !== 'object' || typeof result.kind !== 'string') {
    throw new HttpError(400, 'bad_request', 'invalid result')
  }
  switch (result.kind) {
    case 'resignation':
    case 'timeout':
    case 'draw-agreed':
    case 'ongoing':
      // The database checks these: resign only for yourself, timeouts against
      // the server clock, a draw only against the opponent's stored offer.
      return deps.rpc('set_result', { p_code: code, p_token: token, p_result: result })
    case 'checkmate':
    case 'stalemate': {
      // A claim only asks the server to look: the verdict is the engine's.
      let t = deps.now()
      const g = await load(deps, code, token)
      timing.load = deps.now() - t
      requireSeat(g)
      if (g.result.kind !== 'ongoing') return g
      if (g.cancelled) throw new HttpError(409, 'cancelled', 'game was cancelled')
      if (!g.opponentJoined) throw new HttpError(409, 'waiting', 'waiting for opponent')
      t = deps.now()
      const game = replay(g)
      timing.replay = deps.now() - t
      t = deps.now()
      const verdict = judgeEnd(game, CPU_BUDGET_MS - (deps.now() - start))
      timing.search = deps.now() - t
      if (verdict.kind === 'continues') {
        throw new HttpError(409, 'not_over', `no checkmate or stalemate: ${game.player} still has a legal action`)
      }
      if (verdict.kind === 'inconclusive') {
        throw new HttpError(409, 'inconclusive', 'the server could not confirm the end of the game in time; play continues')
      }
      return recordEnd(deps, code, token, g.actions.length, verdict.result)
    }
    default:
      throw new HttpError(400, 'bad_request', 'invalid result')
  }
}

/** Handle one request body. Throws HttpError (or DbError, mapped by the caller). */
export async function handle(req: unknown, deps: Deps): Promise<Outcome> {
  if (!req || typeof req !== 'object') throw new HttpError(400, 'bad_request', 'expected a JSON object')
  const r = req as Record<string, unknown>
  const timing: Timing = {}
  const t0 = deps.now()
  let body: unknown
  switch (r.op) {
    case 'create':
      body = await opCreate(deps, r, timing)
      break
    case 'submit':
      body = await opSubmit(deps, r, timing)
      break
    case 'result':
      body = await opResult(deps, r, timing)
      break
    default:
      throw new HttpError(400, 'bad_request', 'unknown op')
  }
  timing.total = deps.now() - t0
  return { body, timing }
}

/** HTTP status for a database error message raised by the RPCs. */
export function dbErrorStatus(message: string): { status: number; code: string } {
  if (/game not found/.test(message)) return { status: 404, code: 'not_found' }
  if (/not a player/.test(message)) return { status: 403, code: 'not_player' }
  if (/only resign for yourself/.test(message)) return { status: 403, code: 'forbidden' }
  if (/does not match your seat/.test(message)) return { status: 403, code: 'wrong_seat' }
  if (/out of sync/.test(message)) return { status: 409, code: 'out_of_sync' }
  if (/not your turn/.test(message)) return { status: 409, code: 'not_your_turn' }
  if (/game is over/.test(message)) return { status: 409, code: 'game_over' }
  if (/waiting for opponent/.test(message)) return { status: 409, code: 'waiting' }
  if (/cancelled/.test(message)) return { status: 409, code: 'cancelled' }
  if (/clock not expired/.test(message)) return { status: 409, code: 'clock_not_expired' }
  if (/no draw offer/.test(message)) return { status: 409, code: 'no_draw_offer' }
  return { status: 400, code: 'rejected' }
}
