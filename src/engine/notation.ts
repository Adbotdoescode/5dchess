// 5D PGN notation (Shad's "5dpgn", as used by the community and 5d-chess-js):
// move export/parse and whole-game PGN parsing. Clean-room implementation.

import type { Color } from './types'
import { isSpatial, parseTlNotation, tlNotation } from './core'
import type { IMove, Multiverse } from './core'
import { BLACK, TYPE_LETTERS, TYPE_MASK, T_P, typeFromLetter } from './pieces'

/** What the notation code needs from a game. */
export interface NotationContext {
  readonly mv: Multiverse
  readonly playerColor: Color
  /** All moves (including castling) of the piece at (li, t, x, y) in the current position. */
  movesAt(li: number, t: number, x: number, y: number): IMove[]
  /** Whether a branch to (li, t) right now would create an active timeline. */
  branchWouldBeActive(): boolean
  /** Default promotion piece type. */
  readonly promoType: number
}

export const squareName = (x: number, y: number): string => String.fromCharCode(97 + x) + (y + 1)

export function superPhysical(mv: Multiverse, li: number, t: number): string {
  return `(${tlNotation(mv.even, li)}T${Math.floor(t / 2)})`
}

/** Notation of an internal move in the current position (before it is made). */
export function moveNotation(ctx: NotationContext, m: IMove): string {
  const mv = ctx.mv
  const W = mv.width
  const src = mv.board(m.fl, m.ft)!
  const code = src[m.fy * W + m.fx]
  const type = code & TYPE_MASK
  const letter = TYPE_LETTERS[type]
  const dst = mv.board(m.tl, m.tt)!
  const capture = dst[m.ty * W + m.tx] !== 0 || m.ep
  const promo = m.promo ? `=${TYPE_LETTERS[m.promo]}` : ''
  if (isSpatial(m)) {
    let s = superPhysical(mv, m.fl, m.ft)
    if (m.rookFrom >= 0 && W === 8 && m.fx === 4 && (m.tx === 6 || m.tx === 2)) {
      return s + (m.tx === 6 ? 'O-O' : 'O-O-O')
    }
    if (type !== T_P) s += letter
    // Disambiguation among same-type pieces on this board that can reach the square.
    const H = mv.height
    let sameFile = false
    let sameRank = false
    let conflict = false
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        if (x === m.fx && y === m.fy) continue
        const c = src[y * W + x]
        if (c === 0 || (c & TYPE_MASK) !== type || (c & BLACK) !== (code & BLACK)) continue
        const reaches = ctx.movesAt(m.fl, m.ft, x, y).some((o) => isSpatial(o) && o.tx === m.tx && o.ty === m.ty)
        if (!reaches) continue
        conflict = true
        if (x === m.fx) sameFile = true
        if (y === m.fy) sameRank = true
      }
    if (type === T_P && capture) s += String.fromCharCode(97 + m.fx)
    else if (conflict) {
      if (!sameFile) s += String.fromCharCode(97 + m.fx)
      else if (!sameRank) s += String(m.fy + 1)
      else s += squareName(m.fx, m.fy)
    }
    if (type === T_P && capture && conflict && sameFile) s += String(m.fy + 1)
    if (capture) s += 'x'
    return s + squareName(m.tx, m.ty) + promo
  }
  const branching = mv.endT(m.tl) !== m.tt
  let s = superPhysical(mv, m.fl, m.ft) + letter + squareName(m.fx, m.fy)
  s += branching ? '>>' : '>'
  if (capture) s += 'x'
  s += superPhysical(mv, m.tl, m.tt) + squareName(m.tx, m.ty) + promo
  if (branching && ctx.branchWouldBeActive()) s += '~'
  return s
}

const SP = String.raw`\(L?\s*([+-]?\d+)\s*T\s*(\d+)\)`
const JUMP_RE = new RegExp(`^${SP}([A-Z]{0,2})([a-z])(\\d+)(>>?)x?${SP}([a-z])(\\d+)(?:=([A-Z]{1,2}))?$`)
const PHYS_RE = new RegExp(`^(?:${SP})?(?:(O-O-O|O-O|0-0-0|0-0)|([A-Z]{0,2})([a-wyz]?)(\\d*)(x?)([a-z])(\\d+)(?:=([A-Z]{1,2}))?)$`)

/** Strip annotation suffixes and informational tokens from a move token. */
export function cleanMoveToken(tok: string): string {
  return tok
    .replace(/\(~T-?\d*\)|\(>L[+-]?\d*\)/g, '')
    .replace(/(e\.p\.)/g, '')
    .replace(/[+#*~!?]+$/g, '')
    .trim()
}

/** Parse one move token in the current position. Throws if it does not denote exactly one legal move. */
export function parseMove(ctx: NotationContext, token: string): IMove {
  const c = parseMoveCandidates(ctx, token)
  if (c.length === 0) throw new Error(`Illegal move: ${token}`)
  if (c.length > 1) throw new Error(`Ambiguous move: ${token}`)
  return c[0]
}

/**
 * All legal moves a token may denote (more than one only for under-specified SAN,
 * e.g. "Rd7" when two rooks can reach d7). Throws if the token cannot be parsed.
 */
export function parseMoveCandidates(ctx: NotationContext, token: string): IMove[] {
  const mv = ctx.mv
  const s = cleanMoveToken(token)
  const parity = ctx.playerColor === 'black' ? 1 : 0
  const tOf = (T: string): number => 2 * Number(T) + parity
  const fileOf = (c: string): number => c.charCodeAt(0) - 97
  const promoOf = (p: string | undefined): number => (p ? typeFromLetter(p) : 0)

  const j = JUMP_RE.exec(s)
  if (j) {
    const fl = parseTlNotation(mv.even, j[1])
    const ft = tOf(j[2])
    const fx = fileOf(j[4])
    const fy = Number(j[5]) - 1
    const tl = parseTlNotation(mv.even, j[7])
    const tt = tOf(j[8])
    const tx = fileOf(j[9])
    const ty = Number(j[10]) - 1
    const promo = promoOf(j[11])
    const cands = ctx.movesAt(fl, ft, fx, fy).filter((m) => m.tl === tl && m.tt === tt && m.tx === tx && m.ty === ty)
    const pick = cands[0]
    if (!pick) return []
    return [promo && pick.promo && pick.promo !== promo ? { ...pick, promo } : pick]
  }
  const p = PHYS_RE.exec(s)
  if (!p) throw new Error(`Cannot parse move: ${token}`)
  let li: number
  let t: number
  if (p[1] !== undefined) {
    li = parseTlNotation(mv.even, p[1])
    t = tOf(p[2])
  } else {
    // Without coordinates: the only board the player can move on.
    const boards: [number, number][] = []
    for (let l = mv.minLi; l <= mv.maxLi; l++) {
      const e = mv.endT(l)
      if (e !== undefined && (e & 1) === parity) boards.push([l, e])
    }
    if (boards.length !== 1) throw new Error(`Move needs super-physical coordinates: ${token}`)
    ;[li, t] = boards[0]
  }
  const cells = mv.board(li, t)
  if (!cells) throw new Error(`No board for move: ${token}`)
  const W = mv.width
  const H = mv.height
  const colorBit = parity ? BLACK : 0
  const all: IMove[] = []
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const c = cells[y * W + x]
      if (c === 0 || (c & BLACK) !== colorBit) continue
      for (const m of ctx.movesAt(li, t, x, y)) if (isSpatial(m)) all.push(m)
    }
  if (p[3] !== undefined) {
    const kingside = p[3] === 'O-O' || p[3] === '0-0'
    return all.filter((m) => m.rookFrom >= 0 && (kingside ? m.tx > m.fx : m.tx < m.fx))
  }
  const type = p[4] ? typeFromLetter(p[4]) : T_P
  const ff = p[5] ? fileOf(p[5]) : -1
  const fr = p[6] ? Number(p[6]) - 1 : -1
  const tx = fileOf(p[8])
  const ty = Number(p[9]) - 1
  const promo = promoOf(p[10])
  const cands = all.filter((m) => {
    if (m.tx !== tx || m.ty !== ty) return false
    if ((cells[m.fy * W + m.fx] & TYPE_MASK) !== type) return false
    if (ff >= 0 && m.fx !== ff) return false
    if (fr >= 0 && m.fy !== fr) return false
    return true
  })
  return cands.map((m) => (promo && m.promo && m.promo !== promo ? { ...m, promo } : m))
}

// ---------------------------------------------------------------------------
// Whole-game PGN

export interface ParsedPgn {
  headers: Record<string, string>
  /** 5DFEN board strings found in the header section. */
  fen: string[]
  /** Actions in order; `color` is set when the turn marker says whose action it is. */
  actions: { color: Color | null; moves: string[] }[]
  /** Result token, if any ("1-0", "0-1", "1/2-1/2", "*"). */
  result: string | null
}

export function parsePgn(text: string): ParsedPgn {
  const headers: Record<string, string> = {}
  const fen: string[] = []
  let s = text.replace(/\r\n?/g, '\n')
  s = s.replace(/\{[^}]*\}/g, ' ')
  s = s.replace(/\[([A-Za-z0-9_.-]+)\s+"([^"]*)"\]/g, (_m, k: string, v: string) => {
    headers[k] = v
    return ' '
  })
  s = s.replace(/\[[^\s\]]*:[^\s\]]*\]/g, (m) => {
    fen.push(m)
    return ' '
  })
  s = s.replace(/;[^\n]*/g, ' ')
  s = s.replace(/\(~T-?\d*\)|\(>L[+-]?\d*\)/g, ' ')
  // Normalise super-physical coordinates written with spaces: "(L1 T2)" -> "(1T2)".
  s = s.replace(/\(\s*L?\s*([+-]?\d+)\s*T\s*(\d+)\s*\)/g, '($1T$2)')
  let result: string | null = null
  s = s.replace(/(^|\s)(1-0|0-1|1\/2-1\/2|½-½|\*)(?=\s|$)/g, (_m, pre: string, r: string) => {
    result = r
    return pre + ' '
  })
  s = s.replace(/\//g, ' / ')
  const tokens = s.split(/\s+/).filter((x) => x.length > 0)
  const actions: ParsedPgn['actions'] = []
  const startAction = (color: Color | null): void => {
    const last = actions[actions.length - 1]
    if (last && last.moves.length === 0) {
      last.color = color ?? last.color
      return
    }
    actions.push({ color, moves: [] })
  }
  for (const tok0 of tokens) {
    let tok = tok0
    const marker = /^(\d+)([wbWB]?)\.+(.*)$/.exec(tok)
    if (marker) {
      startAction(marker[2].toLowerCase() === 'b' ? 'black' : 'white')
      tok = marker[3]
      if (!tok) continue
    }
    if (tok === '/') {
      startAction('black')
      continue
    }
    if (actions.length === 0) startAction(null)
    actions[actions.length - 1].moves.push(tok)
  }
  return { headers, fen, actions: actions.filter((a) => a.moves.length > 0), result }
}
