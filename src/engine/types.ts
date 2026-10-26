// Shared engine contract. The renderer, UI and netcode depend ONLY on what is
// exported here (plus the `Game` class in ./game.ts implementing `GameApi`).
// Change with care: other modules are written against these shapes.

export type Color = 'white' | 'black'

/**
 * Piece letters follow 5D PGN / 5D FEN:
 * P pawn, N knight, B bishop, R rook, Q queen, K king,
 * U unicorn, D dragon, S princess (rook+bishop), W brawn,
 * C common king (non-royal king), Y royal queen.
 */
export type PieceType = 'P' | 'N' | 'B' | 'R' | 'Q' | 'K' | 'U' | 'D' | 'S' | 'W' | 'C' | 'Y'

export interface Piece {
  type: PieceType
  color: Color
  /** True once the piece has moved (pawn double-step, castling rights). */
  moved: boolean
}

/**
 * Time is measured in half-turns: t = 2*T + (black to move ? 1 : 0).
 * So "T1 white" is t=2, "T1 black" is t=3, and turn-zero variants start at t=0.
 * A board at time t is the position *where `colorAt(t)` is to move*.
 */
export const colorAt = (t: number): Color => (t % 2 === 0 ? 'white' : 'black')
export const turnNumber = (t: number): number => Math.floor(t / 2)

/**
 * A square in the multiverse.
 * l: timeline coordinate. Adjacent timelines differ by exactly 1. The main
 *    timeline is 0. Timelines created by WHITE have l > 0 and by BLACK l < 0
 *    (5D PGN convention). Even-timeline variants (e.g. Two Timelines, whose
 *    starting timelines are named "-0" and "+0") use half-integers -0.5 / +0.5,
 *    so the next ones are ±1.5 etc.; use `Timeline.label` for display text.
 * t: half-turn index (see above).
 * x: file, 0 = 'a'. y: rank, 0 = rank 1 (white's back rank in standard).
 */
export interface Pos {
  l: number
  t: number
  x: number
  y: number
}

export interface Board {
  l: number
  t: number
  width: number
  height: number
  /** Row-major: squares[y * width + x]. */
  squares: (Piece | null)[]
}

export interface Timeline {
  l: number
  /** 5D PGN timeline name: "0", "+1", "-1", "-0", "+0", ... */
  label: string
  /** Half-turn of boards[0]. */
  startT: number
  /** boards[i] is at t = startT + i. The last board is the timeline's "end". */
  boards: Board[]
  /** Board this timeline branched from (null for starting timelines). It is at (from.l, startT - 1). */
  branchedFrom: { l: number; t: number } | null
  /** Color whose time-travel move created this timeline (null for starting timelines). */
  createdBy: Color | null
  /** Active timelines count towards the present; inactive ones are drawn with a white/black arrow. */
  active: boolean
}

export interface Move {
  from: Pos
  to: Pos
  /** Promotion piece when a pawn/brawn reaches the last rank (game default: 'Q'). */
  promotion?: PieceType
  /** Present when the move is castling: the rook's from/to on the same board. */
  castle?: { rookFrom: Pos; rookTo: Pos }
  /** True for an en passant capture (captured pawn square is next to `to`). */
  enPassant?: boolean
}

export type MoveKind =
  /** Moves within one board (creates the next board in that timeline). */
  | 'spatial'
  /** Moves to another timeline's playable end board (no new timeline). */
  | 'jump'
  /** Moves to a past board (or a non-end board), creating a new timeline. */
  | 'branch'

/** One player's full turn: every move made before pressing "Submit Moves". */
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

/** A capture threat on a royal piece, used to draw red check arrows. */
export interface Check {
  from: Pos
  to: Pos
}

export interface VariantInfo {
  id: string
  /** Display name, e.g. "Standard", "Standard - Turn Zero", "Very Small - Open". */
  name: string
  /** Menu category, e.g. "Standard", "Simple", "Small", "Misc", "Focused". */
  category: string
  description?: string
}

/**
 * Snapshot of everything the renderer needs. Treat as immutable; the engine
 * returns a fresh object after every state change.
 */
export interface MultiverseSnapshot {
  width: number
  height: number
  /** All timelines, sorted by l ascending. */
  timelines: Timeline[]
  /** Half-turn of the present (min end-board t over active timelines, adjusted per the rules). */
  present: number
  /** Whose action is in progress. */
  player: Color
  /** Count of timelines created by each color (for the Present bar's arrows). */
  timelinesCreated: { white: number; black: number }
  /** True if `player` may create a new *active* timeline with their next travel. */
  canCreateActiveTimeline: { white: boolean; black: boolean }
}

/** Public API of the rules engine (implemented by `Game` in ./game.ts). */
export interface GameApi {
  readonly variant: VariantInfo
  /** Current state including tentative (unsubmitted) moves of the current action. */
  snapshot(): MultiverseSnapshot
  /** Player whose action is in progress. */
  readonly player: Color
  /** Submitted actions so far (the authoritative history used for multiplayer sync). */
  readonly history: readonly Action[]
  /** Moves made so far in the current, not-yet-submitted action. */
  readonly pendingMoves: readonly Move[]

  /** Squares that may currently be moved from (pieces of `player` on playable boards). */
  movablePieces(): Pos[]
  /** Pseudo-legal destinations for the piece at `from` (the real game allows moving into check and only blocks the submit). */
  movesFrom(from: Pos): Move[]
  /** Classify a move. */
  moveKind(move: Move): MoveKind
  /** Make a tentative move in the current action. Throws if the move is illegal. */
  makeMove(move: Move): void
  /** Undo the last tentative move. Returns false if there was nothing to undo. */
  undoMove(): boolean
  /** Whether the current tentative action may be submitted (present has moved, not leaving own king in check). */
  canSubmit(): boolean
  /** Why submit is unavailable, for the status text; null if `canSubmit()`. */
  submitBlocker(): null | 'must-move-present' | 'in-check'
  /** Submit the current action. Throws if `!canSubmit()`. */
  submit(): void
  /** Apply a whole action (used by netcode/replay). Validates every move. */
  applyAction(action: Action): void

  /** Checks against `player`'s royal pieces in the current snapshot (red arrows). */
  checks(): Check[]
  /** Game result; checkmate/stalemate are detected after each submit. */
  result(): GameResult
  /** Mark resignation/timeout/draw (multiplayer and clocks). */
  setResult(result: GameResult): void

  /** Playable boards (end boards where `player` is to move), for Tab-cycling. */
  playableBoards(): { l: number; t: number }[]

  /** Move notation in 5D PGN, e.g. "(0T1)Nb1c3" or "(0T7)Qd1>>(0T5)d3". */
  moveToNotation(move: Move): string
  /** Export the whole game as 5D PGN. */
  toPgn(): string

  /** Deep copy (used by the bot and mate search). */
  clone(): GameApi
}
