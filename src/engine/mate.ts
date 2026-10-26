// Exact search for a legal action (used for checkmate / stalemate detection).
//
// Clean-room design in the spirit of the community's "hypercuboid" algorithm.
//
// Search space. Our own moves only ever create boards of the opponent's colour, so
// the candidate moves from each of our playable boards are fixed for the whole
// action. A candidate action is a point in a product space with two kinds of axes:
//
//   Board axes — one per playable board of the player, options:
//     PASS      leave the board alone (only legal if it is not required),
//     SPATIAL m a move within the board,
//     DJ m      a piece departs with a non-branching jump onto another playable
//               board (whose axis must pick ARR m),
//     ARR m     the board receives such a jump,
//     DB m      a piece departs with a branching move.
//   Rank axes — one per board that has branching moves: if that board's option
//     is a branch, its rank (0, 1, ...) is the order in which the branch is made
//     among the action's branches. Ranks fix the numbering (position) of the new
//     timelines; for boards that do not branch the rank is irrelevant.
//
// Evaluation. A point is checked for consistency (jumps meet their arrivals, the
// ranks of the branching boards are exactly 0..k-1, a branch onto a playable board
// comes after that board was consumed), then for the present rule (all required boards moved) and
// finally for checks. If it is not a legal action, the evaluation returns a
// product set of points that are all illegal for the same reason (e.g. a check
// whose attacker, path and target boards are fixed by a few coordinates). That set
// is removed from the current search box by splitting it into disjoint boxes. The
// search ends when a legal point is found or nothing is left.
//
// Key facts used for strong exclusions:
// * New timelines are created beyond all existing ones, so they never block a
//   path between existing boards: adding branches never removes a check. A check
//   found without the new timelines' boards therefore holds whatever the other
//   boards branch to (it only depends on the board axes involved).
// * A required board that is passed stays required unless an *active* new timeline
//   starts earlier, or our new timelines reactivate an earlier opponent timeline.
//
// The search is exact; it only gives up when the time budget runs out ("timeout").

import type { Color } from './types'
import {
  Overlay, applyArrive, applyDepart, applySpatial, bkey, isSpatial, playableEnds, requiredTimelines, scanChecks, sideCounts,
  tlNumber, tlSide,
} from './core'
import type { IMove, Multiverse } from './core'
import { TYPE_MASK, isRoyalType, otherColor } from './pieces'

const K_PASS = 0
const K_SPATIAL = 1
const K_DJ = 2
const K_DB = 3
const K_ARR = 4

interface Opt {
  kind: number
  m: IMove | null
  /** DJ/ARR: partner axis. DB: axis of the playable board it lands on (or -1). */
  other: number
  /** DJ/ARR: option index of the partner option on the partner axis. */
  partner: number
  partnerOpt: Opt | null
  /** DB: global index of the branching move (slot option = g + 1). */
  g: number
  /** Cached resulting board for this axis' timeline. */
  cells: Uint8Array | null
}

interface Axis {
  li: number
  t: number
  cells: Uint8Array
  opts: Opt[]
}

interface BranchMove {
  axis: number
  optIdx: number
  m: IMove
  /** Axis of the playable board it lands on, or -1 for a past board. */
  dest: number
  tlCells: Uint8Array | null
}

export interface SearchOptions {
  /** Time budget in ms (default 2000). */
  timeBudgetMs?: number
  /** Allow passing on required boards (reference-engine semantics, used for cross-checks). */
  relaxed?: boolean
  /** Optional counters of exclusion reasons (diagnostics). */
  stats?: Record<string, number>
}

export interface SearchResult {
  status: 'found' | 'none' | 'timeout'
  /** A legal action (in a valid execution order) when found. */
  moves?: IMove[]
  evaluations: number
}

type Mask = Uint8Array | null
type Box = number[][]

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Search for a legal action for `player` from the current position of `mv`.
 * `genMoves(li, t)` must return all pseudo-legal moves (including castling) from
 * the playable board at (li, t).
 */
export function searchLegalAction(
  mv: Multiverse,
  player: Color,
  genMoves: (li: number, t: number) => IMove[],
  options: SearchOptions = {},
): SearchResult {
  const deadline = now() + (options.timeBudgetMs ?? 2000)
  const relaxed = options.relaxed === true
  const opponent = otherColor(player)
  const W = mv.width
  const ext0 = { minLi: mv.minLi, maxLi: mv.maxLi }

  // A check that no move of ours can affect: no legal action at all.
  if (scanChecks(mv, playableEnds(mv, ext0, opponent), opponent, () => true)) return { status: 'none', evaluations: 0 }

  // --- Board axes -----------------------------------------------------------
  const ends = playableEnds(mv, ext0, player)
  const required = new Set(requiredTimelines(mv, mv.even, ext0, player))
  const axes: Axis[] = ends.map(([li, t]) => ({ li, t, cells: mv.board(li, t)!, opts: [] }))
  const axisOfLi = new Map<number, number>()
  axes.forEach((a, i) => axisOfLi.set(a.li, i))
  const mk = (kind: number, m: IMove | null, other: number): Opt => ({ kind, m, other, partner: -1, partnerOpt: null, g: -1, cells: null })

  const branches: BranchMove[] = []
  const lists = axes.map(() => ({ spatial: [] as Opt[], db: [] as Opt[], dj: [] as Opt[], arr: [] as Opt[] }))
  for (let a = 0; a < axes.length; a++) {
    const ax = axes[a]
    const moves = genMoves(ax.li, ax.t)
    const royalFirst = (m: IMove): number => (isRoyalType(ax.cells[m.fy * W + m.fx] & TYPE_MASK) ? 0 : 1)
    moves.sort((p, q) => royalFirst(p) - royalFirst(q))
    for (const m of moves) {
      if (isSpatial(m)) {
        lists[a].spatial.push(mk(K_SPATIAL, m, -1))
        continue
      }
      const d = axisOfLi.get(m.tl)
      const ontoPlayable = d !== undefined && axes[d].t === m.tt
      if (ontoPlayable) {
        const o1 = mk(K_DJ, m, d)
        const o2 = mk(K_ARR, m, a)
        o1.partnerOpt = o2
        o2.partnerOpt = o1
        lists[a].dj.push(o1)
        lists[d].arr.push(o2)
      }
      lists[a].db.push(mk(K_DB, m, ontoPlayable ? d : -1))
    }
  }
  for (let a = 0; a < axes.length; a++) {
    const pass = mk(K_PASS, null, -1)
    const l = lists[a]
    const body = [...l.spatial, ...l.db, ...l.dj, ...l.arr]
    axes[a].opts = required.has(axes[a].li) ? [...body, pass] : [pass, ...body]
  }
  for (let a = 0; a < axes.length; a++) {
    axes[a].opts.forEach((o, i) => {
      if (o.partnerOpt) o.partner = axes[o.other].opts.indexOf(o.partnerOpt)
      if (o.kind === K_DB) {
        o.g = branches.length
        branches.push({ axis: a, optIdx: i, m: o.m!, dest: o.other, tlCells: null })
      }
    })
  }

  const n = axes.length
  // --- Rank axes ------------------------------------------------------------
  const rankAxisOf = new Array<number>(n).fill(-1)
  let K = 0
  for (let a = 0; a < n; a++) if (axes[a].opts.some((o) => o.kind === K_DB)) rankAxisOf[a] = n + K++
  const N = n + K
  const axisLen = (a: number): number => (a < n ? axes[a].opts.length : K)
  const newLi = (j: number): number => (player === 'white' ? mv.maxLi + 1 + j : mv.minLi - 1 - j)

  // Timeline counts: how many of our new timelines can be active, and when the
  // opponent's inactive timelines would be reactivated by our branches.
  const counts0 = sideCounts(mv.even, ext0)
  const ourN = player === 'white' ? counts0.white : counts0.black
  const activeSlots = Math.max(0, counts0[opponent] + 1 - ourN)
  const reactivationNeeded = (tA: number): number => {
    let best = Infinity
    for (let li = ext0.minLi; li <= ext0.maxLi; li++) {
      if (tlSide(mv.even, li) !== opponent) continue
      const nn = tlNumber(mv.even, li)
      if (nn <= ourN + 1) continue
      const e = mv.endT(li)
      if (e !== undefined && e < tA) best = Math.min(best, nn - ourN - 1)
    }
    return best
  }

  // A required board can only be left alone if a branch could pull the present
  // back before it (an early, active new timeline, or reactivating an earlier
  // opponent timeline). Otherwise passing on it is never legal.
  if (!relaxed) {
    const dbAxes = rankAxisOf.filter((r) => r >= 0).length
    for (let a = 0; a < n; a++) {
      if (!required.has(axes[a].li)) continue
      const tA = axes[a].t
      const earlyExists = activeSlots > 0 && branches.some((b) => b.axis !== a && b.m.tt + 1 < tA)
      const k0 = reactivationNeeded(tA)
      const othersCanBranch = dbAxes - (rankAxisOf[a] >= 0 ? 1 : 0)
      if (!earlyExists && k0 > othersCanBranch) {
        const pi = axes[a].opts.findIndex((o) => o.kind === K_PASS)
        axes[a].opts.splice(pi, 1)
        for (const b of branches) if (b.axis === a && b.optIdx > pi) b.optIdx--
      }
    }
    // Option indices may have shifted: recompute partner indices.
    for (const ax of axes) for (const o of ax.opts) if (o.partnerOpt) o.partner = axes[o.other].opts.indexOf(o.partnerOpt)
  }
  const passIdx = axes.map((ax) => ax.opts.findIndex((o) => o.kind === K_PASS))
  const nonBranch = axes.map((ax) => Uint8Array.from(ax.opts, (o) => (o.kind === K_DB ? 0 : 1)))
  const branchOnly = axes.map((ax) => Uint8Array.from(ax.opts, (o) => (o.kind === K_DB ? 1 : 0)))
  const exact = (a: number, o: number): Uint8Array => {
    const m = new Uint8Array(axisLen(a))
    m[o] = 1
    return m
  }
  const allExcept = (a: number, o: number): Uint8Array => {
    const m = new Uint8Array(axisLen(a)).fill(1)
    m[o] = 0
    return m
  }
  const intersect = (x: Mask, y: Mask): Mask => {
    if (x === null) return y
    if (y === null) return x
    const r = new Uint8Array(x.length)
    for (let i = 0; i < x.length; i++) r[i] = x[i] & y[i]
    return r
  }
  const notEarlyCache = new Map<number, Uint8Array>()
  /** Options of board axis b except branches whose new board is earlier than tA. */
  const notEarly = (b: number, tA: number): Uint8Array => {
    const key = b * 65536 + tA
    let m = notEarlyCache.get(key)
    if (!m) {
      m = Uint8Array.from(axes[b].opts, (o) => (o.kind === K_DB && o.m!.tt + 1 < tA ? 0 : 1))
      notEarlyCache.set(key, m)
    }
    return m
  }


  const pieceAt = (m: IMove): number => mv.board(m.fl, m.ft)![m.fy * W + m.fx]
  const axisCells = (a: number, o: Opt): Uint8Array => {
    if (o.cells) return o.cells
    const ax = axes[a]
    const m = o.m!
    if (o.kind === K_SPATIAL) o.cells = applySpatial(ax.cells, W, m)
    else if (o.kind === K_ARR) o.cells = applyArrive(ax.cells, W, m, pieceAt(m))
    else o.cells = applyDepart(ax.cells, W, m)
    return o.cells
  }
  const tlCells = (b: BranchMove): Uint8Array => {
    if (!b.tlCells) b.tlCells = applyArrive(mv.board(b.m.tl, b.m.tt)!, W, b.m, pieceAt(b.m))
    return b.tlCells
  }

  let evaluations = 0
  const stats = options.stats
  const bump = (k: string): void => {
    if (stats) stats[k] = (stats[k] ?? 0) + 1
  }
  const state: { found: IMove[] | null } = { found: null }

  // Evaluate a point. Returns null when legal (sets state.found), else an exclusion product set.
  const evaluate = (p: number[]): Mask[] | null => {
    evaluations++
    const opt = (a: number): Opt => axes[a].opts[p[a]]
    const ex = (): Mask[] => new Array<Mask>(N).fill(null)
    const fix = (e: Mask[], a: number): void => {
      e[a] = exact(a, p[a])
    }

    // 1. Jumps must be matched by an arrival on the destination board.
    for (let a = 0; a < n; a++) {
      const o = opt(a)
      if ((o.kind === K_DJ || o.kind === K_ARR) && p[o.other] !== o.partner) {
        const e = ex()
        fix(e, a)
        e[o.other] = allExcept(o.other, o.partner)
        bump('jump')
        return e
      }
    }
    // 2. Order of the branches: by rank, ties broken by board index.
    const branching: number[] = []
    for (let a = 0; a < n; a++) if (opt(a).kind === K_DB) branching.push(a)
    const k = branching.length
    const rankOf = (a: number): number => p[rankAxisOf[a]]
    const before = (b: number, a: number): boolean => rankOf(b) < rankOf(a) || (rankOf(b) === rankOf(a) && b < a)
    branching.sort((x, y) => (before(x, y) ? -1 : 1))
    const byRank = branching
    /** Ranks r for axis b such that b sorts before (or after) axis a with rank ra. */
    const rankSide = (b: number, a: number, ra: number, isBefore: boolean): Uint8Array => {
      const m = new Uint8Array(K)
      for (let r = 0; r < K; r++) m[r] = (isBefore ? r < ra || (r === ra && b < a) : r > ra || (r === ra && b > a)) ? 1 : 0
      return m
    }
    // 3. A branch onto a playable board needs that board consumed before it.
    for (const a of branching) {
      const o = opt(a)
      if (o.other < 0) continue
      const d = o.other
      const od = opt(d)
      if (od.kind === K_PASS) {
        const e = ex()
        fix(e, a)
        fix(e, d)
        bump('branchOntoPass')
        return e
      }
      if (od.kind === K_DB && before(a, d)) {
        const e = ex()
        fix(e, a)
        fix(e, d)
        fix(e, rankAxisOf[a])
        e[rankAxisOf[d]] = rankSide(d, a, rankOf(a), false)
        bump('branchOrder')
        return e
      }
    }

    // 4. The resulting position.
    const ov = new Overlay(mv)
    const axisOfBoard = new Map<number, number>()
    for (let a = 0; a < n; a++) {
      const o = opt(a)
      if (o.kind === K_PASS) continue
      const ax = axes[a]
      ov.put(ax.li, ax.t + 1, axisCells(a, o))
      axisOfBoard.set(bkey(ax.li, ax.t + 1), a)
    }
    const ext = {
      minLi: player === 'black' ? mv.minLi - k : mv.minLi,
      maxLi: player === 'white' ? mv.maxLi + k : mv.maxLi,
    }
    const newBoards: [number, number, Uint8Array, number][] = []
    for (let j = 0; j < k; j++) {
      const a = byRank[j]
      const b = branches[opt(a).g]
      newBoards.push([newLi(j), b.m.tt + 1, tlCells(b), a])
    }
    const newBoardAxis = new Map<number, number>()
    const addNew = (): void => {
      for (const [li, t, cells, a] of newBoards) {
        ov.put(li, t, cells)
        newBoardAxis.set(bkey(li, t), a)
      }
    }
    const removeNew = (): void => {
      for (const [li, t] of newBoards) {
        ov.extra.delete(bkey(li, t))
        ov.ends.delete(li)
      }
      newBoardAxis.clear()
    }
    // 5. Present rule (or, in relaxed mode, pass the required boards).
    addNew()
    const req = requiredTimelines(ov, mv.even, ext, player)
    const blankAxis = new Map<number, number>()
    /**
     * Restrict `e` to points where board axis `a` stays passed and required:
     * no early branch in an active position, and not enough branches to
     * reactivate an earlier opponent timeline.
     */
    const keepRequired = (e: Mask[], a: number): void => {
      const tA = axes[a].t
      e[a] = intersect(e[a], exact(a, passIdx[a]))
      const isEarly = (b: number): boolean => opt(b).kind === K_DB && opt(b).m!.tt + 1 < tA
      const early = branching.filter(isEarly)
      if (activeSlots > 0) {
        if (early.length === 0) {
          for (let b = 0; b < n; b++) if (b !== a) e[b] = intersect(e[b], notEarly(b, tA))
        } else {
          // The early branches are pushed out of the active positions by the first
          // `activeSlots` branches (none early); keep it that way.
          const first = byRank.slice(0, activeSlots)
          for (const x of early) fix(e, rankAxisOf[x])
          for (let b = 0; b < n; b++) {
            if (b === a || early.includes(b)) continue
            if (first.includes(b)) {
              e[b] = intersect(e[b], intersect(branchOnly[b], notEarly(b, tA)))
              let m: Mask = null
              for (const x of early) m = intersect(m, rankSide(b, x, rankOf(x), true))
              e[rankAxisOf[b]] = intersect(e[rankAxisOf[b]], m)
            } else {
              e[b] = intersect(e[b], notEarly(b, tA))
            }
          }
        }
      }
      if (reactivationNeeded(tA) <= K) {
        for (let b = 0; b < n; b++) if (b !== a && opt(b).kind !== K_DB) e[b] = intersect(e[b], nonBranch[b])
      }
    }
    if (!relaxed && req.length > 0) {
      const e = ex()
      keepRequired(e, axisOfLi.get(req[0])!)
      bump('present')
      return e
    }
    if (relaxed) {
      for (const li of req) {
        const a = axisOfLi.get(li)!
        ov.put(li, axes[a].t + 1, axes[a].cells)
        blankAxis.set(bkey(li, axes[a].t + 1), a)
      }
    }

    // 6. Checks. First without the new timelines: such a check holds whatever is branched.
    const scan = (): Mask[] | null => {
      const res: { e: Mask[] | null } = { e: null }
      scanChecks(ov, playableEnds(ov, ext, opponent), opponent, (fl, ft, _fx, _fy, tl, tt, _tx, _ty, dl, dT, kk) => {
        const e = ex()
        const boards: number[] = [bkey(fl, ft), bkey(tl, tt)]
        for (let j = 1; j < kk; j++) boards.push(bkey(fl + j * dl, ft + 2 * j * dT))
        let usesBlank = false
        const involvedNew: number[] = []
        for (const b of boards) {
          const a1 = axisOfBoard.get(b)
          if (a1 !== undefined) fix(e, a1)
          const a2 = newBoardAxis.get(b)
          if (a2 !== undefined && !involvedNew.includes(a2)) involvedNew.push(a2)
          if (blankAxis.has(b)) usesBlank = true
        }
        if (involvedNew.length === 1 && dl === 0 && dT === 0 && boards[0] === boards[1]) {
          // A check inside one new board does not depend on where that timeline is.
          fix(e, involvedNew[0])
        } else if (involvedNew.length > 0) {
          // New boards keep their positions iff every other board keeps its side of them.
          for (const a of involvedNew) {
            fix(e, a)
            fix(e, rankAxisOf[a])
          }
          for (let b = 0; b < n; b++) {
            if (involvedNew.includes(b) || rankAxisOf[b] < 0) continue
            if (opt(b).kind !== K_DB) {
              // Not branching: it must not start branching in front of an involved board.
              let m: Mask = null
              for (const a of involvedNew) m = intersect(m, rankSide(b, a, rankOf(a), false))
              if (m![rankOf(b)] === 1) e[rankAxisOf[b]] = m
              else e[b] = intersect(e[b], nonBranch[b])
              continue
            }
            let m: Mask = null
            let isBefore = false
            for (const a of involvedNew) {
              const bb = before(b, a)
              if (bb) isBefore = true
              m = intersect(m, rankSide(b, a, rankOf(a), bb))
            }
            e[rankAxisOf[b]] = m
            if (isBefore) e[b] = intersect(e[b], branchOnly[b])
          }
        }
        // Relaxed mode: the passed boards stay passed and required.
        if (usesBlank) for (const b of boards) {
          const a3 = blankAxis.get(b)
          if (a3 !== undefined) keepRequired(e, a3)
        }
        res.e = e
        return true
      })
      return res.e
    }
    if (k > 0) {
      removeNew()
      const r0 = scan()
      if (r0) bump('checkOld')
      if (r0) return r0
      addNew()
    }
    const r = scan()
    if (r) bump('checkNew')
    if (r) return r

    // Legal: non-branching moves first, then the branches by rank.
    const moves: IMove[] = []
    for (let a = 0; a < n; a++) {
      const o = opt(a)
      if (o.kind === K_SPATIAL || o.kind === K_DJ) moves.push(o.m!)
    }
    for (let j = 0; j < k; j++) moves.push(opt(byRank[j]).m!)
    state.found = moves
    return null
  }

  // --- Box search -----------------------------------------------------------
  const pick = (box: Box): number[] => {
    const p = box.map((s) => s[0])
    // Repairs that make the first point of a box more likely to be consistent.
    for (let a = 0; a < n; a++) {
      const o = axes[a].opts[p[a]]
      if ((o.kind === K_DJ || o.kind === K_ARR) && p[o.other] !== o.partner && box[o.other].includes(o.partner)) {
        const cur = axes[o.other].opts[p[o.other]]
        if (cur.kind !== K_DJ && cur.kind !== K_ARR && cur.kind !== K_DB) p[o.other] = o.partner
      }
    }
    return p
  }

  const full: Box = []
  for (let a = 0; a < N; a++) full.push(Array.from({ length: axisLen(a) }, (_, i) => i))
  const stack: Box[] = [full]
  while (stack.length > 0) {
    if ((evaluations & 15) === 0 && now() > deadline) return { status: 'timeout', evaluations }
    const box = stack.pop()!
    if (box.some((x) => x.length === 0)) continue
    const p = pick(box)
    const e = evaluate(p)
    if (e === null) return { status: 'found', moves: state.found ?? [], evaluations }
    // Split box \ E into disjoint boxes.
    const prefix = box.slice()
    for (let a = 0; a < N; a++) {
      const m = e[a]
      if (m === null) continue
      const outside = box[a].filter((o) => m[o] === 0)
      if (outside.length > 0) {
        const child = prefix.slice()
        child[a] = outside
        stack.push(child)
      }
      prefix[a] = box[a].filter((o) => m[o] === 1)
    }
  }
  return { status: 'none', evaluations }
}
