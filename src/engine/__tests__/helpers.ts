// Shared test helpers.
import { Game } from '../game'
import type { Move, Pos } from '../types'

/** All legal moves of the current player, with their notation. */
export function allMoves(g: Game): { move: Move; notation: string }[] {
  const res: { move: Move; notation: string }[] = []
  for (const p of g.movablePieces()) for (const m of g.movesFrom(p)) res.push({ move: m, notation: g.moveToNotation(m) })
  return res
}

/** Notations of all legal moves, without the present-moving marker '~'. */
export const notations = (g: Game): string[] => allMoves(g).map((m) => m.notation.replace(/~$/, ''))

/** An empty `w`x`h` board string with optional pieces: { 'b2': 'B' } */
export function rows(w: number, h: number, pieces: Record<string, string> = {}): string {
  const out: string[] = []
  for (let y = h - 1; y >= 0; y--) {
    let s = ''
    let empty = 0
    for (let x = 0; x < w; x++) {
      const p = pieces[String.fromCharCode(97 + x) + (y + 1)]
      if (!p) {
        empty++
        continue
      }
      if (empty) s += empty
      empty = 0
      s += p
    }
    if (empty) s += empty
    out.push(s)
  }
  return out.join('/')
}

/** Game from 5DFEN board strings. */
export function fenGame(boards: string[], w: number, h: number): Game {
  return Game.fromFen(boards, w, h, undefined, { skipMateDetection: true })
}

export const pos = (l: number, t: number, sq: string): Pos => ({ l, t, x: sq.charCodeAt(0) - 97, y: Number(sq.slice(1)) - 1 })

/** Half-turn of "T<turn> white/black". */
export const T = (turn: number, color: 'w' | 'b' = 'w'): number => 2 * turn + (color === 'b' ? 1 : 0)
