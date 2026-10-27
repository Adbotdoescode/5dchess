// Types for the generated engine bundle (engine.js, built from src/engine by
// `npm run build:edge`). Only the subset used by the edge function is declared;
// it mirrors src/engine/types.ts and src/engine/game.ts — keep in sync.

export type Color = 'white' | 'black'
export type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'U' | 'D' | 'S' | 'W' | 'C' | 'Y'

export interface Pos {
  l: number
  t: number
  x: number
  y: number
}

export interface Move {
  from: Pos
  to: Pos
  promotion?: PieceType
  castle?: { rookFrom: Pos; rookTo: Pos }
  enPassant?: boolean
}

export interface Action {
  player: Color
  moves: Move[]
}

export type GameResult =
  | { kind: 'ongoing' }
  | { kind: 'checkmate'; winner: Color }
  | { kind: 'stalemate' }
  | { kind: 'resignation'; winner: Color }
  | { kind: 'timeout'; winner: Color }
  | { kind: 'draw-agreed' }

export interface VariantInfo {
  id: string
  name: string
  category: string
  description?: string
}

export interface TimelineInfo {
  l: number
  active: boolean
}

export interface MultiverseSnapshot {
  timelines: TimelineInfo[]
  present: number
  player: Color
}

export interface GameOptions {
  mateTimeBudgetMs?: number
  skipMateDetection?: boolean
  castlingRule?: 'multiverse' | 'board'
}

export declare class Game {
  readonly variant: VariantInfo
  readonly player: Color
  readonly history: readonly Action[]
  readonly pendingMoves: readonly Move[]
  mateSearchInconclusive: boolean
  static create(variantId: string, options?: GameOptions): Game
  static fromActions(variantId: string, actions: readonly Action[], options?: GameOptions): Game
  snapshot(): MultiverseSnapshot
  movablePieces(): Pos[]
  requiredBoards(): { l: number; t: number }[]
  playableBoards(): { l: number; t: number }[]
  moveKind(move: Move): 'spatial' | 'jump' | 'branch'
  movesFrom(from: Pos): Move[]
  makeMove(move: Move): void
  undoMove(): boolean
  canSubmit(): boolean
  submitBlocker(): null | 'must-move-present' | 'in-check'
  submit(): void
  applyAction(action: Action): void
  isInCheck(): boolean
  hasLegalAction(timeBudgetMs?: number): boolean | null
  findLegalAction(timeBudgetMs?: number): Move[] | null
  result(): GameResult
  setResult(result: GameResult): void
  clone(): Game
}

export interface VariantDef {
  id: string
  name: string
  category: string
}

export declare const VARIANTS: readonly VariantDef[]
export declare function findVariant(id: string): VariantDef | undefined
export declare function createGame(variantId: string, options?: GameOptions): Game
export declare function colorAt(t: number): Color
