// Test-only adapter around the AGPL reference engine `5d-chess-js` (devDependency).
// NEVER import this from non-test code.
import { createRequire } from 'node:module'
import { VARIANTS } from '../variants'

const require = createRequire(import.meta.url)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any
const Chess: Any = require('5d-chess-js')

// The original game always promotes to a queen. The reference engine derives the
// promotion pieces from the pieces present on the board and, inside its check
// detection, generates no promotion captures at all when no queen/rook/... exists
// (e.g. "Just Pawns"). Make it always use queens (test-only patch).
new Chess().raw.pieceFuncs.availablePromotionPieces = () => [10, 9]

export interface OraclePos {
  l: number
  t: number
  x: number
  y: number
}

const BUILTIN: Record<string, string> = {
  standard: 'standard',
  defended_pawn: 'defended_pawn',
  half_reflected: 'half_reflected',
  princess: 'princess',
  turn_zero: 'turn_zero',
  two_timelines: 'two_timelines',
  reversed_royalty: 'reversed_royalty',
}

export class Oracle {
  readonly c: Any
  readonly even: boolean
  readonly turnZero: boolean

  constructor(variantId: string) {
    const v = VARIANTS.find((x) => x.id === variantId)
    if (!v) throw new Error(variantId)
    if (BUILTIN[variantId]) {
      this.c = new Chess(undefined, BUILTIN[variantId])
    } else {
      this.c = new Chess()
      this.c.import(`[Board "custom"]\n[Size "${v.width}x${v.height}"]\n[Promotions "Q"]\n${v.fen.join('\n')}`)
    }
    // The original game only promotes to queens.
    this.c.rawPromotionPieces = [10, 9]
    this.c.skipDetection = true
    const bf = this.c.raw.boardFuncs
    this.even = bf.isEvenTimeline(this.c.rawBoard)
    this.turnZero = bf.isTurnZero(this.c.rawBoard)
  }

  /** Raw timeline index -> public l. */
  lOf(idx: number): number {
    if (this.even) return idx % 2 === 0 ? idx / 2 - 0.5 : -(idx + 1) / 2 + 0.5
    return idx % 2 === 0 ? idx / 2 : -(idx + 1) / 2
  }

  pos(raw: number[]): OraclePos {
    return { l: this.lOf(raw[0]), t: this.turnZero ? raw[1] : raw[1] + 2, x: raw[3], y: raw[2] }
  }

  /** Legal destinations per source square ("l,t,x,y" keys). */
  moves(): Map<string, Set<string>> {
    const raw: number[][][] = this.c.moves('raw', false, false)
    const res = new Map<string, Set<string>>()
    for (const m of raw) {
      const f = this.pos(m[0])
      const t = this.pos(m[1])
      const k = key(f)
      if (!res.has(k)) res.set(k, new Set())
      res.get(k)!.add(key(t))
    }
    return res
  }

  /** Raw castling moves, as "from->to" keys. */
  castlingMoves(): Set<string> {
    const raw: number[][][] = this.c.moves('raw', false, false)
    return new Set(raw.filter((m) => m.length === 4).map((m) => `${key(this.pos(m[0]))}->${key(this.pos(m[1]))}`))
  }

  /** l of the timelines that still must be moved on. */
  required(): number[] {
    return this.c.raw.boardFuncs.present(this.c.rawBoard, this.c.rawAction).map((i: number) => this.lOf(i)).sort((a: number, b: number) => a - b)
  }

  active(): number[] {
    return this.c.raw.boardFuncs.active(this.c.rawBoard).map((i: number) => this.lOf(i)).sort((a: number, b: number) => a - b)
  }

  get inCheck(): boolean {
    return this.c.inCheck
  }

  get submittable(): boolean {
    return this.c.submittable()
  }

  get player(): string {
    return this.c.player
  }

  move(notation: string): void {
    this.c.move(notation)
  }

  undo(): void {
    this.c.undo()
  }

  submit(): void {
    this.c.submit()
  }

  /** Reference checkmate detection on the current (start-of-action) position: [isMate, timedOut]. */
  checkmate(timeoutMs: number): [boolean, boolean] {
    const c = this.c
    const latest = c.rawBoardHistory[c.rawBoardHistory.length - 1]
    return c.raw.mateFuncs.checkmate(latest, c.rawAction, timeoutMs)
  }

  stalemate(timeoutMs: number): [boolean, boolean] {
    const c = this.c
    const latest = c.rawBoardHistory[c.rawBoardHistory.length - 1]
    return c.raw.mateFuncs.stalemate(latest, c.rawAction, timeoutMs)
  }
}

export const key = (p: OraclePos): string => `${p.l},${p.t},${p.x},${p.y}`
