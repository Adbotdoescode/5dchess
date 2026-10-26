// Core multiverse representation and move generation (clean-room implementation).
//
// Coordinates used internally:
//   li — integer timeline index. Adjacent timelines differ by 1. For odd-start
//        variants li === public l. For even-start variants (timelines "-0"/"+0")
//        the public l is li + 0.5, so li = -1 is "-0", li = 0 is "+0", li = 1 is "+1",
//        li = -2 is "-1", ...
//   t  — half-turn index (2*T + (black ? 1 : 0)), identical to the public `t`.
//   x, y — file and rank, 0-based.
//
// Boards are immutable once created: every move creates new boards.

import type { Board, Color } from './types'
import { colorAt } from './types'
import {
  BLACK, T_B, T_C, T_D, T_K, T_N, T_P, T_Q, T_R, T_S, T_U, T_W, T_Y, TYPE_MASK, UNMOVED,
  codeToPiece, isRoyalType,
} from './pieces'

/** Read-only view of a multiverse used by move generation. */
export interface Source {
  readonly width: number
  readonly height: number
  /** Cells of the board at (li, t), or undefined if no such board exists. */
  board(li: number, t: number): Uint8Array | undefined
  /** Half-turn of the last board of timeline li, or undefined if the timeline does not exist. */
  endT(li: number): number | undefined
}

export interface IBoard {
  readonly li: number
  readonly t: number
  readonly cells: Uint8Array
  /** Lazily created public view; cached so identity is stable across snapshots. */
  pub: Board | null
}

export interface ITimeline {
  li: number
  startT: number
  boards: IBoard[]
  branchedFrom: { li: number; t: number } | null
  createdBy: Color | null
}

/** Internal move. Coordinates use li (see header). */
export interface IMove {
  fl: number
  ft: number
  fx: number
  fy: number
  tl: number
  tt: number
  tx: number
  ty: number
  /** Promotion piece type (pieces.ts constant) or 0. */
  promo: number
  /** Castling: x of the rook before/after, or -1. */
  rookFrom: number
  rookTo: number
  ep: boolean
}

export const isSpatial = (m: IMove): boolean => m.fl === m.tl && m.ft === m.tt

export const bkey = (li: number, t: number): number => (li + 4096) * 8192 + t

// ---------------------------------------------------------------------------
// Multiverse

export class Multiverse implements Source {
  readonly width: number
  readonly height: number
  /** True for even-start variants (timelines "-0" and "+0"). */
  readonly even: boolean
  private tls: (ITimeline | undefined)[] = []
  private off = 0
  minLi = 0
  maxLi = -1

  constructor(width: number, height: number, even: boolean) {
    this.width = width
    this.height = height
    this.even = even
  }

  get size(): number {
    return this.maxLi - this.minLi + 1
  }

  timeline(li: number): ITimeline | undefined {
    return this.tls[li + this.off]
  }

  board(li: number, t: number): Uint8Array | undefined {
    const tl = this.tls[li + this.off]
    if (tl === undefined) return undefined
    const b = tl.boards[t - tl.startT]
    return b === undefined ? undefined : b.cells
  }

  boardObj(li: number, t: number): IBoard | undefined {
    const tl = this.tls[li + this.off]
    if (tl === undefined) return undefined
    return tl.boards[t - tl.startT]
  }

  endT(li: number): number | undefined {
    const tl = this.tls[li + this.off]
    if (tl === undefined) return undefined
    return tl.startT + tl.boards.length - 1
  }

  endBoard(li: number): IBoard | undefined {
    const tl = this.tls[li + this.off]
    if (tl === undefined) return undefined
    return tl.boards[tl.boards.length - 1]
  }

  /** All timelines sorted by li ascending. */
  timelines(): ITimeline[] {
    const res: ITimeline[] = []
    for (let li = this.minLi; li <= this.maxLi; li++) {
      const tl = this.timeline(li)
      if (tl) res.push(tl)
    }
    return res
  }

  addTimeline(tl: ITimeline): void {
    if (this.maxLi < this.minLi) {
      this.tls = [tl]
      this.off = -tl.li
      this.minLi = this.maxLi = tl.li
      return
    }
    if (this.timeline(tl.li)) throw new Error(`Timeline ${tl.li} already exists`)
    if (tl.li < this.minLi) {
      const grow = this.minLi - tl.li
      const pad: (ITimeline | undefined)[] = new Array(grow).fill(undefined)
      this.tls = pad.concat(this.tls)
      this.off += grow
      this.minLi = tl.li
    } else if (tl.li > this.maxLi) {
      this.maxLi = tl.li
    }
    this.tls[tl.li + this.off] = tl
  }

  /** Remove the outermost timeline li (used by undo). */
  removeTimeline(li: number): void {
    if (li !== this.minLi && li !== this.maxLi) throw new Error('Can only remove an outermost timeline')
    this.tls[li + this.off] = undefined
    if (this.minLi === this.maxLi) {
      this.tls = []
      this.off = 0
      this.minLi = 0
      this.maxLi = -1
      return
    }
    if (li === this.maxLi) {
      this.tls.length = li + this.off
      this.maxLi--
      while (this.maxLi > this.minLi && !this.timeline(this.maxLi)) this.maxLi--
    } else {
      this.minLi++
      while (this.minLi < this.maxLi && !this.timeline(this.minLi)) this.minLi++
    }
  }

  appendBoard(li: number, cells: Uint8Array): IBoard {
    const tl = this.timeline(li)
    if (!tl) throw new Error(`No timeline ${li}`)
    const b: IBoard = { li, t: tl.startT + tl.boards.length, cells, pub: null }
    tl.boards.push(b)
    return b
  }

  popBoard(li: number): void {
    const tl = this.timeline(li)
    if (!tl || tl.boards.length <= 1) throw new Error('Cannot pop board')
    tl.boards.pop()
  }

  /** Copy sharing the (immutable) boards. */
  clone(): Multiverse {
    const m = new Multiverse(this.width, this.height, this.even)
    m.tls = this.tls.map((tl) =>
      tl ? { li: tl.li, startT: tl.startT, boards: tl.boards.slice(), branchedFrom: tl.branchedFrom, createdBy: tl.createdBy } : undefined,
    )
    m.off = this.off
    m.minLi = this.minLi
    m.maxLi = this.maxLi
    return m
  }

  /** Public l coordinate of internal li. */
  lOf(li: number): number {
    return this.even ? li + 0.5 : li
  }

  /** Internal li of public l. */
  liOf(l: number): number {
    return this.even ? Math.round(l - 0.5) : l
  }
}

/** Public, cached Board view of an internal board. */
export function publicBoard(mv: Multiverse, b: IBoard): Board {
  if (b.pub) return b.pub
  const squares = new Array(b.cells.length)
  for (let i = 0; i < b.cells.length; i++) squares[i] = codeToPiece(b.cells[i])
  const pub: Board = Object.freeze({
    l: mv.lOf(b.li),
    t: b.t,
    width: mv.width,
    height: mv.height,
    squares: Object.freeze(squares) as (ReturnType<typeof codeToPiece>)[],
  }) as Board
  b.pub = pub
  return pub
}

// ---------------------------------------------------------------------------
// Timeline numbering, activity and the present

/** Timeline number n as shown in notation (|l| rounded towards 0). */
export function tlNumber(even: boolean, li: number): number {
  if (even) return li >= 0 ? li : -li - 1
  return Math.abs(li)
}

/** Which side's timeline this is (null for the central timeline(s) with number 0). */
export function tlSide(even: boolean, li: number): Color | null {
  if (tlNumber(even, li) === 0) return null
  return li > 0 ? 'white' : 'black'
}

export function tlLabel(even: boolean, li: number): string {
  if (even) return li >= 0 ? `+${li}` : `-${-li - 1}`
  if (li === 0) return '0'
  return li > 0 ? `+${li}` : `${li}`
}

/** Timeline coordinate as written in 5D PGN super-physical coordinates. */
export function tlNotation(even: boolean, li: number): string {
  if (even) {
    if (li === 0) return '+0'
    if (li === -1) return '-0'
    return li > 0 ? `${li}` : `${li + 1}`
  }
  return `${li}`
}

/** Parse a 5D PGN timeline coordinate ("0", "+1", "-2", "-0", "+0"). */
export function parseTlNotation(even: boolean, s: string): number {
  if (even) {
    if (s === '+0') return 0
    if (s === '-0') return -1
    const n = Number(s)
    if (!Number.isInteger(n)) throw new Error(`Bad timeline "${s}"`)
    if (n === 0) throw new Error('Timeline 0 does not exist in an even-timeline variant; use -0 or +0')
    return n > 0 ? n : n - 1
  }
  const n = Number(s)
  if (!Number.isInteger(n)) throw new Error(`Bad timeline "${s}"`)
  return n
}

export interface Extents {
  minLi: number
  maxLi: number
}

/** Number of the outermost timeline on each side (0 if none was created). */
export function sideCounts(even: boolean, ext: Extents): { white: number; black: number } {
  const white = ext.maxLi >= 0 && tlSide(even, ext.maxLi) === 'white' ? tlNumber(even, ext.maxLi) : 0
  const black = tlSide(even, ext.minLi) === 'black' ? tlNumber(even, ext.minLi) : 0
  return { white, black }
}

/**
 * A timeline is active unless it is one of the "extra" timelines of a side that
 * has created more than one timeline beyond the opponent's count.
 */
export function isActiveTl(even: boolean, li: number, counts: { white: number; black: number }): boolean {
  const n = tlNumber(even, li)
  if (n === 0) return true
  const side = li > 0 ? 'white' : 'black'
  return side === 'white' ? n <= counts.black + 1 : n <= counts.white + 1
}

/** li that the next timeline created by `color` gets. */
export function nextLi(ext: Extents, color: Color): number {
  return color === 'white' ? ext.maxLi + 1 : ext.minLi - 1
}

/** The present: earliest end-board half-turn over active timelines. */
export function computePresent(src: Source, even: boolean, ext: Extents): number {
  const counts = sideCounts(even, ext)
  let present = Infinity
  for (let li = ext.minLi; li <= ext.maxLi; li++) {
    const e = src.endT(li)
    if (e === undefined) continue
    if (!isActiveTl(even, li, counts)) continue
    if (e < present) present = e
  }
  return present
}

/** Timelines whose end board must be moved on by `player` before submitting. */
export function requiredTimelines(src: Source, even: boolean, ext: Extents, player: Color): number[] {
  const present = computePresent(src, even, ext)
  const res: number[] = []
  if (!Number.isFinite(present) || colorAt(present) !== player) return res
  const counts = sideCounts(even, ext)
  for (let li = ext.minLi; li <= ext.maxLi; li++) {
    if (src.endT(li) === present && isActiveTl(even, li, counts)) res.push(li)
  }
  return res
}

// ---------------------------------------------------------------------------
// Direction tables. A vector is [dl, dT, dy, dx]; dT counts full turns (2 half-turns).

type Vec = readonly [number, number, number, number]

const ALL_DIRS: Vec[] = []
for (let dl = -1; dl <= 1; dl++)
  for (let dT = -1; dT <= 1; dT++)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (dl === 0 && dT === 0 && dy === 0 && dx === 0) continue
        ALL_DIRS.push([dl, dT, dy, dx])
      }

const axisCount = (v: Vec): number => (v[0] !== 0 ? 1 : 0) + (v[1] !== 0 ? 1 : 0) + (v[2] !== 0 ? 1 : 0) + (v[3] !== 0 ? 1 : 0)

function dirsWhere(pred: (n: number) => boolean): Vec[] {
  // Spatial directions first (cheapest, most common).
  const d = ALL_DIRS.filter((v) => pred(axisCount(v)))
  return d.sort((a, b) => (a[0] !== 0 || a[1] !== 0 ? 1 : 0) - (b[0] !== 0 || b[1] !== 0 ? 1 : 0))
}

const KNIGHT_DIRS: Vec[] = []
for (let a = 0; a < 4; a++)
  for (let b = 0; b < 4; b++) {
    if (a === b) continue
    for (const sa of [-2, 2])
      for (const sb of [-1, 1]) {
        const v = [0, 0, 0, 0]
        v[a] = sa
        v[b] = sb
        KNIGHT_DIRS.push(v as unknown as Vec)
      }
  }
KNIGHT_DIRS.sort((a, b) => (a[0] !== 0 || a[1] !== 0 ? 1 : 0) - (b[0] !== 0 || b[1] !== 0 ? 1 : 0))

/** Rider direction sets indexed by piece type (null for non-riders). */
const RIDER_DIRS: (Vec[] | null)[] = []
RIDER_DIRS[T_R] = dirsWhere((n) => n === 1)
RIDER_DIRS[T_B] = dirsWhere((n) => n === 2)
RIDER_DIRS[T_U] = dirsWhere((n) => n === 3)
RIDER_DIRS[T_D] = dirsWhere((n) => n === 4)
RIDER_DIRS[T_Q] = dirsWhere(() => true)
RIDER_DIRS[T_Y] = RIDER_DIRS[T_Q]
RIDER_DIRS[T_S] = dirsWhere((n) => n <= 2)
const KING_DIRS = dirsWhere(() => true)

export const DIRECTION_COUNTS = {
  rook: RIDER_DIRS[T_R]!.length,
  bishop: RIDER_DIRS[T_B]!.length,
  unicorn: RIDER_DIRS[T_U]!.length,
  dragon: RIDER_DIRS[T_D]!.length,
  queen: RIDER_DIRS[T_Q]!.length,
  princess: RIDER_DIRS[T_S]!.length,
  king: KING_DIRS.length,
  knight: KNIGHT_DIRS.length,
}

// ---------------------------------------------------------------------------
// Move visiting

/** Flag passed to visitors for en passant captures. */
export const FLAG_EP = 1

/**
 * Called for each destination. (dl, dT, k) describe the path for riders: the
 * piece passes boards (li + j*dl, t + 2*j*dT) for j = 1..k (k = 1 for leapers/pawns,
 * whose dl/dT are the full offset). Return true to stop the enumeration.
 */
export type Visitor = (tl: number, tt: number, tx: number, ty: number, dl: number, dT: number, k: number, flags: number) => boolean

/**
 * Enumerate pseudo-legal destinations (without castling) of the piece standing
 * at (li, t, x, y). With `capturesOnly`, only moves that capture are visited.
 * Returns true if the visitor stopped the enumeration.
 */
export function visitMoves(src: Source, li: number, t: number, x: number, y: number, capturesOnly: boolean, visit: Visitor): boolean {
  const W = src.width
  const H = src.height
  const cells = src.board(li, t)
  if (!cells) return false
  const code = cells[y * W + x]
  if (code === 0) return false
  const type = code & TYPE_MASK
  const black = code & BLACK
  const unmoved = (code & UNMOVED) !== 0

  if (type === T_P || type === T_W) {
    const fy = black ? -1 : 1
    const fl = black ? 1 : -1
    const y1 = y + fy
    // Spatial push
    if (!capturesOnly && y1 >= 0 && y1 < H && cells[y1 * W + x] === 0) {
      if (visit(li, t, x, y1, 0, 0, 1, 0)) return true
      const y2 = y1 + fy
      if (unmoved && y2 >= 0 && y2 < H && cells[y2 * W + x] === 0) {
        if (visit(li, t, x, y2, 0, 0, 1, 0)) return true
      }
    }
    // Spatial diagonal captures and en passant
    if (y1 >= 0 && y1 < H) {
      for (let dx = -1; dx <= 1; dx += 2) {
        const x1 = x + dx
        if (x1 < 0 || x1 >= W) continue
        const c = cells[y1 * W + x1]
        if (c !== 0) {
          if ((c & BLACK) !== black && visit(li, t, x1, y1, 0, 0, 1, 0)) return true
          continue
        }
        // En passant: an enemy pawn/brawn beside us that just double-stepped.
        const adj = cells[y * W + x1]
        if (adj === 0 || (adj & BLACK) === black) continue
        const at = adj & TYPE_MASK
        if (at !== T_P && at !== T_W) continue
        const y2 = y1 + fy
        if (y2 < 0 || y2 >= H || cells[y2 * W + x1] !== 0) continue
        const prev = src.board(li, t - 2)
        if (!prev) continue
        if (prev[y * W + x1] !== 0) continue
        const was = prev[y2 * W + x1]
        const wasType = was & TYPE_MASK
        if ((wasType !== T_P && wasType !== T_W) || (was & UNMOVED) === 0 || (was & BLACK) !== (adj & BLACK)) continue
        if (visit(li, t, x1, y1, 0, 0, 1, FLAG_EP)) return true
      }
    }
    // Timeline push (forward = towards the opponent's timelines)
    if (!capturesOnly) {
      const b1 = src.board(li + fl, t)
      if (b1 && b1[y * W + x] === 0) {
        if (visit(li + fl, t, x, y, fl, 0, 1, 0)) return true
        if (unmoved) {
          const b2 = src.board(li + 2 * fl, t)
          if (b2 && b2[y * W + x] === 0 && visit(li + 2 * fl, t, x, y, 2 * fl, 0, 1, 0)) return true
        }
      }
    }
    // Timeline captures: one timeline forward and one turn forward/back.
    for (let dT = -1; dT <= 1; dT += 2) {
      const b = src.board(li + fl, t + 2 * dT)
      if (!b) continue
      const c = b[y * W + x]
      if (c !== 0 && (c & BLACK) !== black && visit(li + fl, t + 2 * dT, x, y, fl, dT, 1, 0)) return true
    }
    if (type === T_W) {
      // Brawn: additionally captures one forward on an axis plus one step on another.
      const b = src.board(li + fl, t)
      if (b) {
        for (let dx = -1; dx <= 1; dx += 2) {
          const x1 = x + dx
          if (x1 < 0 || x1 >= W) continue
          const c = b[y * W + x1]
          if (c !== 0 && (c & BLACK) !== black && visit(li + fl, t, x1, y, fl, 0, 1, 0)) return true
        }
        if (y1 >= 0 && y1 < H) {
          const c = b[y1 * W + x]
          if (c !== 0 && (c & BLACK) !== black && visit(li + fl, t, x, y1, fl, 0, 1, 0)) return true
        }
      }
      if (y1 >= 0 && y1 < H) {
        const bp = src.board(li, t - 2)
        if (bp) {
          const c = bp[y1 * W + x]
          if (c !== 0 && (c & BLACK) !== black && visit(li, t - 2, x, y1, 0, -1, 1, 0)) return true
        }
      }
    }
    return false
  }

  if (type === T_N) {
    for (const v of KNIGHT_DIRS) {
      const nx = x + v[3]
      const ny = y + v[2]
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue
      const nl = li + v[0]
      const nt = t + 2 * v[1]
      const b = v[0] === 0 && v[1] === 0 ? cells : src.board(nl, nt)
      if (!b) continue
      const c = b[ny * W + nx]
      if (c === 0) {
        if (!capturesOnly && visit(nl, nt, nx, ny, v[0], v[1], 1, 0)) return true
      } else if ((c & BLACK) !== black) {
        if (visit(nl, nt, nx, ny, v[0], v[1], 1, 0)) return true
      }
    }
    return false
  }

  const isKing = type === T_K || type === T_C
  const dirs = isKing ? KING_DIRS : RIDER_DIRS[type]
  if (!dirs) return false
  for (const v of dirs) {
    const [dl, dT, dy, dx] = v
    const spatial = dl === 0 && dT === 0
    let nx = x
    let ny = y
    let nl = li
    let nt = t
    for (let k = 1; ; k++) {
      nx += dx
      ny += dy
      if (nx < 0 || nx >= W || ny < 0 || ny >= H) break
      nl += dl
      nt += 2 * dT
      const b = spatial ? cells : src.board(nl, nt)
      if (!b) break
      const c = b[ny * W + nx]
      if (c === 0) {
        if (!capturesOnly && visit(nl, nt, nx, ny, dl, dT, k, 0)) return true
      } else {
        if ((c & BLACK) !== black && visit(nl, nt, nx, ny, dl, dT, k, 0)) return true
        break
      }
      if (isKing) break
    }
  }
  return false
}

/** Promotion rank check for a pawn/brawn of the given color bit. */
export const isLastRank = (H: number, black: number, y: number): boolean => (black ? y === 0 : y === H - 1)

/** Generate internal moves (no castling) for the piece at (li, t, x, y). */
export function genMoves(src: Source, li: number, t: number, x: number, y: number, promoType: number, out: IMove[]): void {
  const cells = src.board(li, t)
  if (!cells) return
  const code = cells[y * src.width + x]
  if (code === 0) return
  const type = code & TYPE_MASK
  const pawnLike = type === T_P || type === T_W
  const black = code & BLACK
  const H = src.height
  visitMoves(src, li, t, x, y, false, (tl, tt, tx, ty, _dl, _dT, _k, flags) => {
    out.push({
      fl: li, ft: t, fx: x, fy: y, tl, tt, tx, ty,
      promo: pawnLike && isLastRank(H, black, ty) ? promoType : 0,
      rookFrom: -1, rookTo: -1, ep: (flags & FLAG_EP) !== 0,
    })
    return false
  })
}

/**
 * Castling candidates for an unmoved king at (li, t, x, y): the king moves two
 * squares towards an unmoved rook of the same color with only empty squares in
 * between. `safe(x)` must say whether the king would be safe on file x of this
 * rank; all of the start, passed and destination squares must be safe.
 */
export function genCastling(src: Source, li: number, t: number, x: number, y: number, safe: (sx: number) => boolean, out: IMove[]): void {
  const W = src.width
  const cells = src.board(li, t)
  if (!cells) return
  const code = cells[y * W + x]
  if ((code & TYPE_MASK) !== T_K || (code & UNMOVED) === 0) return
  const black = code & BLACK
  let startSafe: boolean | undefined
  for (let dir = 1; dir >= -1; dir -= 2) {
    const x1 = x + dir
    const x2 = x + 2 * dir
    if (x2 < 0 || x2 >= W) continue
    if (cells[y * W + x1] !== 0 || cells[y * W + x2] !== 0) continue
    let rx = x2 + dir
    while (rx >= 0 && rx < W && cells[y * W + rx] === 0) rx += dir
    if (rx < 0 || rx >= W) continue
    const rc = cells[y * W + rx]
    if (rc !== (T_R | UNMOVED | black)) continue
    if (startSafe === undefined) startSafe = safe(x)
    if (!startSafe || !safe(x1) || !safe(x2)) continue
    out.push({ fl: li, ft: t, fx: x, fy: y, tl: li, tt: t, tx: x2, ty: y, promo: 0, rookFrom: rx, rookTo: x1, ep: false })
  }
}

// ---------------------------------------------------------------------------
// Applying moves to cells

/** Code of a piece after it moved (and possibly promoted). */
export function movedCode(code: number, promo: number): number {
  const c = code & ~UNMOVED
  return promo ? (c & ~TYPE_MASK) | promo : c
}

/** Board resulting from a spatial move on `cells`. */
export function applySpatial(cells: Uint8Array, W: number, m: IMove): Uint8Array {
  const out = cells.slice()
  const code = out[m.fy * W + m.fx]
  out[m.fy * W + m.fx] = 0
  out[m.ty * W + m.tx] = movedCode(code, m.promo)
  if (m.ep) out[m.fy * W + m.tx] = 0
  if (m.rookFrom >= 0) {
    const rc = out[m.fy * W + m.rookFrom]
    out[m.fy * W + m.rookFrom] = 0
    out[m.fy * W + m.rookTo] = movedCode(rc, 0)
  }
  return out
}

/** Source board after a piece leaves it. */
export function applyDepart(cells: Uint8Array, W: number, m: IMove): Uint8Array {
  const out = cells.slice()
  out[m.fy * W + m.fx] = 0
  return out
}

/** Destination board after the piece `code` arrives. */
export function applyArrive(cells: Uint8Array, W: number, m: IMove, code: number): Uint8Array {
  const out = cells.slice()
  out[m.ty * W + m.tx] = movedCode(code, m.promo)
  return out
}

/** A copy of the cells used for "passing" (null move) on a board. */
export const copyCells = (cells: Uint8Array): Uint8Array => cells.slice()

// ---------------------------------------------------------------------------
// Overlay: a base multiverse plus extra boards (used for hypothetical positions).

export class Overlay implements Source {
  readonly width: number
  readonly height: number
  readonly base: Source
  readonly extra = new Map<number, Uint8Array>()
  readonly ends = new Map<number, number>()

  constructor(base: Source) {
    this.base = base
    this.width = base.width
    this.height = base.height
  }

  board(li: number, t: number): Uint8Array | undefined {
    if (this.extra.size !== 0) {
      const e = this.extra.get(bkey(li, t))
      if (e !== undefined) return e
    }
    return this.base.board(li, t)
  }

  endT(li: number): number | undefined {
    if (this.ends.size !== 0) {
      const e = this.ends.get(li)
      if (e !== undefined) return e
    }
    return this.base.endT(li)
  }

  /** Add a board as the new end of timeline li. */
  put(li: number, t: number, cells: Uint8Array): void {
    this.extra.set(bkey(li, t), cells)
    this.ends.set(li, t)
  }

  delete(li: number, t: number, prevEnd: number | undefined): void {
    this.extra.delete(bkey(li, t))
    if (prevEnd === undefined) this.ends.delete(li)
    else this.ends.set(li, prevEnd)
  }
}

// ---------------------------------------------------------------------------
// Checks

/** Royal-capture callback: attacker at (fl, ft, fx, fy), royal at (tl, tt, tx, ty). Return true to stop. */
export type CheckVisitor = (fl: number, ft: number, fx: number, fy: number, tl: number, tt: number, tx: number, ty: number, dl: number, dT: number, k: number) => boolean

/**
 * Find captures of `defender`'s royal pieces by `attacker` pieces standing on
 * the given boards (which should be the attacker's playable end boards).
 * Returns true if the visitor stopped the search.
 */
export function scanChecks(src: Source, attackerBoards: readonly (readonly [number, number])[], attacker: Color, visit: CheckVisitor): boolean {
  const W = src.width
  const n = W * src.height
  const abit = attacker === 'black' ? BLACK : 0
  for (const [li, t] of attackerBoards) {
    const cells = src.board(li, t)
    if (!cells) continue
    for (let i = 0; i < n; i++) {
      const code = cells[i]
      if (code === 0 || (code & BLACK) !== abit) continue
      const x = i % W
      const y = (i - x) / W
      const stop = visitMoves(src, li, t, x, y, true, (tl, tt, tx, ty, dl, dT, k) => {
        const tb = tl === li && tt === t ? cells : src.board(tl, tt)
        const target = tb ? tb[ty * W + tx] : 0
        if (!isRoyalType(target & TYPE_MASK)) return false
        return visit(li, t, x, y, tl, tt, tx, ty, dl, dT, k)
      })
      if (stop) return true
    }
  }
  return false
}

/** End boards of all timelines where `color` is to move. */
export function playableEnds(src: Source, ext: Extents, color: Color): [number, number][] {
  const res: [number, number][] = []
  for (let li = ext.minLi; li <= ext.maxLi; li++) {
    const e = src.endT(li)
    if (e !== undefined && colorAt(e) === color) res.push([li, e])
  }
  return res
}

/** True if `attacker` could capture a royal piece of the other side from one of its playable boards. */
export function hasCheck(src: Source, ext: Extents, attacker: Color): boolean {
  return scanChecks(src, playableEnds(src, ext, attacker), attacker, () => true)
}
