// Compact piece encoding used internally by the engine.
//
// A square holds a small integer: 0 = empty, otherwise
//   bits 0-3: piece type (1..12, see the constants below)
//   bit 4   : black (16)
//   bit 5   : unmoved (32) — relevant for pawn/brawn double steps and castling
//
// Clean-room implementation; see AGENTS.md for licensing rules.

import type { Color, Piece, PieceType } from './types'

export const EMPTY = 0
export const T_P = 1
export const T_N = 2
export const T_B = 3
export const T_R = 4
export const T_Q = 5
export const T_K = 6
export const T_U = 7
export const T_D = 8
export const T_S = 9
export const T_W = 10
export const T_C = 11
export const T_Y = 12

export const TYPE_MASK = 15
export const BLACK = 16
export const UNMOVED = 32

export const TYPE_LETTERS: readonly PieceType[] = ['P', 'P', 'N', 'B', 'R', 'Q', 'K', 'U', 'D', 'S', 'W', 'C', 'Y']

const LETTER_TO_TYPE: Record<string, number> = {
  P: T_P, N: T_N, B: T_B, R: T_R, Q: T_Q, K: T_K, U: T_U, D: T_D, S: T_S, W: T_W, C: T_C, Y: T_Y,
}

/** Multi-letter aliases accepted by 5D PGN parsers. */
const ALIASES: Record<string, number> = { BR: T_W, CK: T_C, RQ: T_Y, PR: T_S }

export function typeFromLetter(letter: string): number {
  const t = LETTER_TO_TYPE[letter] ?? ALIASES[letter]
  if (t === undefined) throw new Error(`Unknown piece letter "${letter}"`)
  return t
}

export const pieceType = (code: number): number => code & TYPE_MASK
export const isBlack = (code: number): boolean => (code & BLACK) !== 0
export const colorOfCode = (code: number): Color => ((code & BLACK) !== 0 ? 'black' : 'white')
export const colorBit = (c: Color): number => (c === 'black' ? BLACK : 0)
export const isRoyalType = (type: number): boolean => type === T_K || type === T_Y
export const isPawnType = (type: number): boolean => type === T_P || type === T_W

export function makeCode(type: number, color: Color, unmoved: boolean): number {
  return type | colorBit(color) | (unmoved ? UNMOVED : 0)
}

// Shared, frozen public Piece objects (immutable, so they can be reused across boards).
const PIECE_TABLE: (Piece | null)[] = []
for (let code = 0; code < 64; code++) {
  const type = code & TYPE_MASK
  if (type === 0 || type > 12) {
    PIECE_TABLE.push(null)
    continue
  }
  PIECE_TABLE.push(
    Object.freeze({
      type: TYPE_LETTERS[type],
      color: (code & BLACK) !== 0 ? 'black' : 'white',
      moved: (code & UNMOVED) === 0,
    }) as Piece,
  )
}

export function codeToPiece(code: number): Piece | null {
  return PIECE_TABLE[code] ?? null
}

export function pieceToCode(p: Piece): number {
  return makeCode(LETTER_TO_TYPE[p.type], p.color, !p.moved)
}

export const otherColor = (c: Color): Color => (c === 'white' ? 'black' : 'white')
