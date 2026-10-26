// Differential fuzz test against the reference engine (5d-chess-js, AGPL, test-only oracle).
//
// Random games (biased toward time travel) are played in both engines in lockstep
// via 5D PGN notation. After every move we compare: legal destinations of every
// movable piece, the boards that must still be moved on (present), active
// timelines, whether the action can be submitted and the check status.
//
// Default run is small enough for CI; set FUZZ_GAMES=500 (and optionally FUZZ_SEED,
// FUZZ_ACTIONS) for a larger run.
import { describe, expect, it } from 'vitest'
import { Game, createGame } from '../game'
import { scanChecks } from '../core'
import { pieceToCode } from '../pieces'
import type { Move } from '../types'
import { Oracle, key } from './oracle'

export const timing: Record<string, number> = {}
function timed<T>(name: string, f: () => T): T {
  const t0 = performance.now()
  try {
    return f()
  } finally {
    timing[name] = (timing[name] ?? 0) + performance.now() - t0
  }
}

const GAMES = Number(process.env.FUZZ_GAMES ?? 60)
const SEED = Number(process.env.FUZZ_SEED ?? 12345)
const MAX_ACTIONS = Number(process.env.FUZZ_ACTIONS ?? 24)
const SEARCH_MS = Number(process.env.FUZZ_SEARCH_MS ?? 2000)

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const FUZZ_VARIANTS = [
  'standard', 'standard', 'standard', 'turn_zero', 'two_timelines', 'princess', 'reversed_royalty', 'defended_pawn', 'half_reflected',
  'very_small', 'very_small_open', 'small', 'small_open', 'small_centered', 'small_flipped', 'simple_no_queens', 'simple_knights_vs_bishops',
  'focused_just_brawns', 'focused_just_pawns', 'focused_just_kings', 'focused_just_unicorns', 'focused_just_dragons', 'focused_just_knights',
  'focused_just_rooks', 'misc_timeline_invasion', 'misc_timeline_tactician', 'misc_timeline_fragments', 'misc_timeline_marauders',
  'misc_timeline_battleground', 'misc_king_of_kings', 'misc_royal_queen_showdown', 'misc_excessive', 'checkmate_practice_pawns',
]

interface Stats {
  games: number
  actions: number
  moves: number
  comparisons: number
  castlingWhitelisted: number
  mates: number
  stalemates: number
  mateChecks: number
  oracleMissedEscapes: number
  searchTimeouts: number
}

function ourMoves(g: Game): Map<string, Move[]> {
  const res = new Map<string, Move[]>()
  for (const p of g.movablePieces()) res.set(key(p), g.movesFrom(p))
  return res
}

/**
 * Castling the reference engine allows but we reject: legitimate only if no
 * square the king starts on, passes or lands on is attacked from its own board
 * (the reference's rule) — i.e. the attack comes from another board (our rule:
 * "check" includes attacks from other boards).
 */
function isCrossBoardCastle(g: Game, oracleCastles: Set<string>, from: string, to: string): boolean {
  if (!oracleCastles.has(`${from}->${to}`)) return false
  const [l, t, fx, y] = from.split(',').map(Number)
  const tx = Number(to.split(',')[2])
  const board = g.board(l, t)!
  const W = board.width
  for (let sx = Math.min(fx, tx); sx <= Math.max(fx, tx); sx++) {
    const cells = Uint8Array.from(board.squares, (p) => (p ? pieceToCode(p) : 0))
    const king = cells[y * W + fx]
    cells[y * W + fx] = 0
    cells[y * W + sx] = king
    const src = { width: W, height: board.height, board: (li: number, tt: number) => (li === 0 && tt === t ? cells : undefined), endT: () => t }
    let attacked = false
    scanChecks(src, [[0, t]], g.player === 'white' ? 'black' : 'white', (_a, _b, _c, _d, _tl, _tt, x2, y2) => {
      if (x2 === sx && y2 === y) attacked = true
      return attacked
    })
    if (attacked) return false
  }
  return true
}

function compare(g: Game, o: Oracle, stats: Stats, ctx: string): void {
  stats.comparisons++
  expect(o.player, ctx).toBe(g.player)
  const ours = timed('ourMoves', () => ourMoves(g))
  const theirs = timed('oracleMoves', () => o.moves())
  const castles = o.castlingMoves()
  const ourKeys = [...ours.keys()].sort()
  const theirKeys = [...theirs.keys()].filter((k) => {
    // A king whose only oracle moves are castling moves we reject.
    if (ours.has(k)) return true
    const dests = [...theirs.get(k)!]
    if (dests.every((d) => isCrossBoardCastle(g, castles, k, d))) {
      stats.castlingWhitelisted++
      return false
    }
    return true
  }).sort()
  expect(ourKeys, `${ctx}: movable pieces`).toEqual(theirKeys)
  for (const k of ourKeys) {
    const a = new Set(ours.get(k)!.map((m) => key(m.to)))
    const b = new Set([...theirs.get(k)!].filter((d) => {
      if (a.has(d)) return true
      if (isCrossBoardCastle(g, castles, k, d)) {
        stats.castlingWhitelisted++
        return false
      }
      return true
    }))
    expect([...a].sort(), `${ctx}: moves of ${k}`).toEqual([...b].sort())
  }
  expect(g.requiredBoards().map((b) => b.l).sort((x, y) => x - y), `${ctx}: required boards`).toEqual(o.required())
  const active = g.snapshot().timelines.filter((t) => t.active).map((t) => t.l).sort((x, y) => x - y)
  expect(active, `${ctx}: active timelines`).toEqual(o.active())
  const ic = timed('ourCheck', () => g.isInCheck())
  expect(ic, `${ctx}: in check`).toBe(timed('oracleCheck', () => o.inCheck))
  const cs = timed('ourSubmit', () => g.canSubmit())
  expect(cs, `${ctx}: can submit`).toBe(timed('oracleSubmit', () => o.submittable))
}

function playGame(gameIndex: number, rand: () => number, stats: Stats): void {
  const variant = FUZZ_VARIANTS[Math.floor(rand() * FUZZ_VARIANTS.length)]
  const g = createGame(variant, { skipMateDetection: true })
  const o = new Oracle(variant)
  const log: string[] = []
  const ctx = (): string => `game ${gameIndex} (${variant}) after: ${log.join(' ') || '(start)'}`
  stats.games++
  for (let action = 0; action < MAX_ACTIONS; action++) {
    compare(g, o, stats, ctx())
    let submitted = false
    for (let attempt = 0; attempt < 6 && !submitted; attempt++) {
      let made = 0
      const travelBias = rand() < 0.7
      while (!g.canSubmit() && made < 12) {
        const all = [...ourMoves(g).values()].flat()
        if (all.length === 0) break
        const travel = all.filter((m) => g.moveKind(m) !== 'spatial')
        const pool = travelBias && travel.length > 0 && rand() < 0.6 ? travel : all
        const m = pool[Math.floor(rand() * pool.length)]
        const n = g.moveToNotation(m)
        g.makeMove(m)
        try {
          o.move(n)
        } catch (e) {
          throw new Error(`${ctx()}: oracle rejected ${n}: ${(e as Error).message}`)
        }
        log.push(n)
        made++
        stats.moves++
        compare(g, o, stats, ctx())
        // Sometimes stop early on a submittable state, sometimes continue with optional boards.
        if (g.canSubmit() && rand() < 0.8) break
      }
      if (g.canSubmit()) {
        g.submit()
        o.submit()
        log.push('/')
        submitted = true
        stats.actions++
        break
      }
      for (let i = 0; i < made; i++) {
        g.undoMove()
        o.undo()
        log.pop()
      }
    }
    if (submitted) continue
    // Random play failed: ask our exact search for a legal action.
    const tS = performance.now()
    const has = timed('ourSearch', () => g.hasLegalAction(SEARCH_MS))
    if (performance.now() - tS > 1000) console.log('SLOW search', (performance.now() - tS).toFixed(0), has, JSON.stringify(g.toPgn()))
    if (has === null) {
      stats.searchTimeouts++
      return
    }
    const legal = has ? g.findLegalAction(SEARCH_MS) : null
    if (has && legal === null) throw new Error(`${ctx()}: search found an action but could not return it`)
    if (legal === null) {
      // No legal action: checkmate or stalemate. Cross-check with the reference.
      stats.mateChecks++
      const inCheck = g.isInCheck()
      expect(inCheck, `${ctx()}: check status at game end`).toBe(o.inCheck)
      const relaxed = timed('ourRelaxed', () => g.relaxedEscape(SEARCH_MS))
      if (inCheck) {
        stats.mates++
        const [mate, timedOut] = timed('oracleMate', () => o.checkmate(3000))
        // The reference allows "passing" on required boards when looking for escapes;
        // our relaxed search uses the same semantics. When we find such an escape but
        // the reference claims mate, its (heuristic) search missed it: verify the
        // escape in the reference engine itself.
        if (relaxed === null) {
          if (!timedOut) expect(mate, `${ctx()}: reference must agree on checkmate`).toBe(true)
        } else if (relaxed !== 'timeout' && mate && !timedOut) {
          stats.oracleMissedEscapes++
          const notations: string[] = []
          for (const m of relaxed) {
            const n = g.moveToNotation(m)
            g.makeMove(m)
            o.move(n)
            notations.push(n)
          }
          expect(o.inCheck, `${ctx()}: escape ${notations.join(' ')} verified in reference`).toBe(false)
          expect(g.isInCheck()).toBe(false)
          for (let i = 0; i < relaxed.length; i++) {
            g.undoMove()
            o.undo()
          }
        }
      } else {
        stats.stalemates++
      }
      return
    }
    for (const m of legal) {
      const n = g.moveToNotation(m)
      g.makeMove(m)
      o.move(n)
      log.push(n)
      compare(g, o, stats, ctx())
    }
    expect(g.canSubmit(), `${ctx()}: found action submittable`).toBe(true)
    g.submit()
    o.submit()
    log.push('/')
    stats.actions++
  }
}

describe('differential fuzz vs 5d-chess-js', () => {
  it(`plays ${GAMES} random games in lockstep`, () => {
    const rand = rng(SEED)
    const stats: Stats = { games: 0, actions: 0, moves: 0, comparisons: 0, castlingWhitelisted: 0, mates: 0, stalemates: 0, mateChecks: 0, oracleMissedEscapes: 0, searchTimeouts: 0 }
    for (let i = 0; i < GAMES; i++) playGame(i, rand, stats)
    console.log('fuzz stats', JSON.stringify(stats), JSON.stringify(timing))
    expect(stats.games).toBe(GAMES)
  }, 600_000)
})
