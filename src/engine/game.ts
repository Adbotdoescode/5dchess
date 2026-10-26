// The rules engine's public Game class (clean-room implementation of the rules of
// "5D Chess With Multiverse Time Travel"). See types.ts for the contract.
//
// Notes for the UI layer:
// * Game end: `result()` is updated by `submit()` (and at creation). Checkmate =
//   the player to move has no legal action and is in check; stalemate = no legal
//   action, not in check. If the exact search exceeds `mateTimeBudgetMs` (default
//   2 s; only plausible with very many timelines) the game stays 'ongoing' and
//   `mateSearchInconclusive` is set.
// * Last-move highlights: `actionRecords()` (submitted actions) and
//   `pendingRecords()` (current action) give each move's from/to squares, kind
//   (spatial → yellow, jump/branch → blue) and the boards it created
//   (`fromBoard`, `toBoard`).
// * Required boards (pulsing border): `requiredBoards()`; red arrows: `checks()`.
// * `snapshot()` reuses Board objects for unchanged boards; never mutate them.

import type {
  Action, Board, Check, Color, GameApi, GameResult, Move, MoveKind, MoveRecord, MultiverseSnapshot, PieceType, Pos,
  Timeline, VariantInfo,
} from './types'
import { colorAt } from './types'
import {
  Multiverse, Overlay, applyArrive, bkey, applyDepart, applySpatial, computePresent, copyCells, genCastling, genMoves,
  isActiveTl, isSpatial, nextLi, playableEnds, publicBoard, requiredTimelines, scanChecks, sideCounts, tlLabel,
} from './core'
import type { IMove } from './core'
import { boardToFen, multiverseFromFen } from './fen'
import { searchLegalAction } from './mate'
import type { SearchResult } from './mate'
import { moveNotation, parseMove, parseMoveCandidates, parsePgn } from './notation'
import type { NotationContext } from './notation'
import { BLACK, TYPE_LETTERS, codeToPiece, colorBit, otherColor, typeFromLetter } from './pieces'
import { VARIANTS, findVariant } from './variants'
import type { VariantDef } from './variants'

interface Applied {
  im: IMove
  srcLi: number
  /** Timeline that received a board from a non-branching jump. */
  destLi: number | null
  /** Timeline created by a branching move. */
  newLi: number | null
  record: MoveRecord
}

export interface GameOptions {
  /** Time budget for checkmate/stalemate detection after each submit (ms). Default 2000. */
  mateTimeBudgetMs?: number
  /** Skip checkmate/stalemate detection (bots, bulk replays). */
  skipMateDetection?: boolean
  /**
   * Which attacks forbid castling out of/through/into check:
   * 'multiverse' (default) — any opponent piece that could capture the king there,
   * from any board (the multiverse-wide notion of check, with still-required boards passed);
   * 'board' — only pieces on the castling board itself (the reference engine's rule).
   */
  castlingRule?: 'multiverse' | 'board'
}

const CUSTOM_VARIANT: VariantInfo = { id: 'custom', name: 'Custom', category: 'Custom' }

export class Game implements GameApi {
  readonly variant: VariantInfo
  /** Initial boards as 5DFEN strings. */
  readonly initialFen: readonly string[]
  readonly width: number
  readonly height: number
  /** Allowed promotion pieces; the first is the default (the base game: queen only). */
  readonly promotions: readonly PieceType[]
  /** True when the last checkmate/stalemate search ran out of time (the game was left ongoing). */
  mateSearchInconclusive = false
  options: GameOptions

  private mv: Multiverse
  private _player: Color
  private _history: Action[] = []
  private _pending: Move[] = []
  private applied: Applied[] = []
  private records: MoveRecord[][] = []
  private _result: GameResult = { kind: 'ongoing' }

  constructor(variant: VariantInfo, fen: readonly string[], width: number, height: number, promotions?: readonly PieceType[], options: GameOptions = {}) {
    this.variant = variant
    this.initialFen = fen.slice()
    this.width = width
    this.height = height
    this.promotions = promotions && promotions.length > 0 ? promotions.slice() : ['Q']
    this.options = options
    this.mv = multiverseFromFen(fen, width, height)
    const present = computePresent(this.mv, this.mv.even, this.mv)
    this._player = Number.isFinite(present) ? colorAt(present) : 'white'
    // A starting position may already be over (e.g. "Misc - Global Warming").
    if (!options.skipMateDetection) this.detectEnd()
  }

  // ------------------------------------------------------------------ factories

  static create(variantId: string, options?: GameOptions): Game {
    const v = findVariant(variantId)
    if (!v) throw new Error(`Unknown variant "${variantId}"`)
    return Game.fromVariant(v, options)
  }

  static fromVariant(v: VariantDef, options?: GameOptions): Game {
    const info: VariantInfo = { id: v.id, name: v.name, category: v.category, description: v.description }
    return new Game(info, v.fen, v.width, v.height, v.promotions as PieceType[] | undefined, options)
  }

  /** A game from custom 5DFEN board strings. */
  static fromFen(fen: readonly string[], width = 8, height = 8, promotions?: readonly PieceType[], options?: GameOptions): Game {
    return new Game(CUSTOM_VARIANT, fen, width, height, promotions, options)
  }

  /** Load a 5D PGN game (headers, optional 5DFEN boards, moves). An incomplete last action stays pending. */
  static fromPgn(pgn: string, options?: GameOptions): Game {
    const parsed = parsePgn(pgn)
    const h = lowerKeys(parsed.headers)
    const board = h.board
    let game: Game
    let size = [8, 8]
    if (h.size) {
      const m = /^(\d+)\s*x\s*(\d+)$/.exec(h.size)
      if (m) size = [Number(m[1]), Number(m[2])]
    }
    const promotions = h.promotions ? (h.promotions.split(/[\s,]+/).filter(Boolean) as PieceType[]) : undefined
    const variant = board && board.toLowerCase() !== 'custom' ? findVariant(board) : undefined
    if (parsed.fen.length > 0 && !variant) {
      game = Game.fromFen(parsed.fen, size[0], size[1], promotions, options)
    } else if (variant) {
      game = Game.fromVariant(variant, options)
    } else if (!board) {
      game = Game.create('standard', options)
    } else {
      throw new Error(`Unknown variant "${board}"`)
    }
    // Replay; under-specified SAN ("Rd7" with two rooks able to go there) is resolved
    // by trying each candidate and keeping the one with which the rest of the record replays.
    type Step = { tok: string; action: number } | { submit: true; action: number; last: boolean }
    const steps: Step[] = []
    parsed.actions.forEach((a, i) => {
      for (const tok of a.moves) steps.push({ tok, action: i })
      steps.push({ submit: true, action: i, last: i === parsed.actions.length - 1 })
    })
    const run = (g: Game, from: number): Game => {
      for (let i = from; i < steps.length; i++) {
        const st = steps[i]
        if ('submit' in st) {
          if (g.canSubmit()) g.submitInternal(false)
          else if (!st.last) throw new Error(`Action ${st.action + 1} (${parsed.actions[st.action].moves.join(' ')}) cannot be submitted: ${g.submitBlocker()}`)
          continue
        }
        const color = parsed.actions[st.action].color
        if (color && color !== g.player) throw new Error(`Action ${st.action + 1} is marked for ${color} but it is ${g.player}'s turn`)
        const cands = parseMoveCandidates(g.notationContext(), st.tok)
        if (cands.length === 0) throw new Error(`Illegal move: ${st.tok}`)
        if (cands.length === 1) {
          g.applyInternal(cands[0])
          continue
        }
        let err: unknown = null
        for (const c of cands) {
          const g2 = g.cloneGame()
          g2.applyInternal(c)
          try {
            return run(g2, i + 1)
          } catch (e) {
            err = e
          }
        }
        throw err
      }
      return g
    }
    const result = run(game, 0)
    if (!result.options.skipMateDetection && result._pending.length === 0 && result._history.length > 0) result.detectEnd()
    return result
  }

  /** Replay a list of actions from the start of a variant. */
  static fromActions(variantId: string, actions: readonly Action[], options?: GameOptions): Game {
    const g = Game.create(variantId, { ...options, skipMateDetection: true })
    actions.forEach((a, i) => {
      for (const m of a.moves) g.makeMove(m)
      g.submitInternal(i === actions.length - 1 && !options?.skipMateDetection)
    })
    g.options = { ...options }
    return g
  }

  // ------------------------------------------------------------------ basic state

  get player(): Color {
    return this._player
  }

  get history(): readonly Action[] {
    return this._history
  }

  get pendingMoves(): readonly Move[] {
    return this._pending
  }

  result(): GameResult {
    return this._result
  }

  setResult(result: GameResult): void {
    this._result = result
  }

  /** Records of submitted actions (one array per action). */
  actionRecords(): readonly (readonly MoveRecord[])[] {
    return this.records
  }

  /** Records of the moves of the current, not yet submitted action. */
  pendingRecords(): readonly MoveRecord[] {
    return this.applied.map((a) => a.record)
  }

  snapshot(): MultiverseSnapshot {
    const mv = this.mv
    const counts = sideCounts(mv.even, mv)
    const timelines: Timeline[] = mv.timelines().map((tl) => ({
      l: mv.lOf(tl.li),
      label: tlLabel(mv.even, tl.li),
      startT: tl.startT,
      boards: tl.boards.map((b) => publicBoard(mv, b)),
      branchedFrom: tl.branchedFrom ? { l: mv.lOf(tl.branchedFrom.li), t: tl.branchedFrom.t } : null,
      createdBy: tl.createdBy,
      active: isActiveTl(mv.even, tl.li, counts),
    }))
    let white = 0
    let black = 0
    for (const tl of timelines) {
      if (tl.createdBy === 'white') white++
      else if (tl.createdBy === 'black') black++
    }
    const present = computePresent(mv, mv.even, mv)
    return {
      width: mv.width,
      height: mv.height,
      timelines,
      present: Number.isFinite(present) ? present : 0,
      player: this._player,
      timelinesCreated: { white, black },
      canCreateActiveTimeline: { white: counts.white <= counts.black, black: counts.black <= counts.white },
    }
  }

  /** The board at (l, t), or undefined. */
  board(l: number, t: number): Board | undefined {
    const b = this.mv.boardObj(this.mv.liOf(l), t)
    return b ? publicBoard(this.mv, b) : undefined
  }

  /** Half-turn of the present. */
  present(): number {
    const p = computePresent(this.mv, this.mv.even, this.mv)
    return Number.isFinite(p) ? p : 0
  }

  /** Boards that must still be moved on before submitting. */
  requiredBoards(): { l: number; t: number }[] {
    return requiredTimelines(this.mv, this.mv.even, this.mv, this._player).map((li) => ({ l: this.mv.lOf(li), t: this.mv.endT(li)! }))
  }

  playableBoards(): { l: number; t: number }[] {
    return playableEnds(this.mv, this.mv, this._player).map(([li, t]) => ({ l: this.mv.lOf(li), t }))
  }

  // ------------------------------------------------------------------ moves

  private isPlayable(li: number, t: number): boolean {
    return this.mv.endT(li) === t && colorAt(t) === this._player
  }

  /** All internal moves of the piece at (li, t, x, y), including castling. */
  private movesAtInternal(li: number, t: number, x: number, y: number): IMove[] {
    const out: IMove[] = []
    const promo = typeFromLetter(this.promotions[0])
    genMoves(this.mv, li, t, x, y, promo, out)
    genCastling(this.mv, li, t, x, y, (sx) => this.kingSafeOnCastle(li, t, x, y, sx), out)
    return out
  }

  /** All moves of the player from the playable board at (li, t). */
  private movesFromBoard(li: number, t: number): IMove[] {
    const cells = this.mv.board(li, t)
    if (!cells) return []
    const W = this.mv.width
    const bit = colorBit(this._player)
    const out: IMove[] = []
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i]
      if (c === 0 || (c & BLACK) !== bit) continue
      const x = i % W
      out.push(...this.movesAtInternal(li, t, x, (i - x) / W))
    }
    return out
  }

  /**
   * Castling may not start from, pass through or end on an attacked square.
   * "Attacked" uses the multiverse-wide notion of check: the king is placed on the
   * square in the next board of this timeline, the other boards that still must be
   * moved on are passed, and we ask whether any opponent piece could capture it.
   */
  private kingSafeOnCastle(li: number, t: number, kx: number, ky: number, sx: number): boolean {
    const mv = this.mv
    const W = mv.width
    const ov = this.blankedOverlay(li)
    const cells = mv.board(li, t)!.slice()
    const king = cells[ky * W + kx]
    cells[ky * W + kx] = 0
    cells[ky * W + sx] = king
    ov.put(li, t + 1, cells)
    const opp = otherColor(this._player)
    const attackers: [number, number][] = this.options.castlingRule === 'board' ? [[li, t + 1]] : playableEnds(ov, mv, opp)
    return !scanChecks(ov, attackers, opp, (_fl, _ft, _fx, _fy, tl, tt, tx, ty) => tl === li && tt === t + 1 && tx === sx && ty === ky)
  }

  /** The current position with every still-required board passed (null-moved). */
  private blankedOverlay(exceptLi?: number): Overlay {
    const ov = new Overlay(this.mv)
    for (const li of requiredTimelines(this.mv, this.mv.even, this.mv, this._player)) {
      if (li === exceptLi) continue
      const e = this.mv.endT(li)!
      ov.put(li, e + 1, copyCells(this.mv.board(li, e)!))
    }
    return ov
  }

  private toPublic(m: IMove): Move {
    const mv = this.mv
    const move: Move = {
      from: { l: mv.lOf(m.fl), t: m.ft, x: m.fx, y: m.fy },
      to: { l: mv.lOf(m.tl), t: m.tt, x: m.tx, y: m.ty },
    }
    if (m.promo) move.promotion = TYPE_LETTERS[m.promo]
    if (m.rookFrom >= 0) {
      move.castle = {
        rookFrom: { l: move.from.l, t: m.ft, x: m.rookFrom, y: m.fy },
        rookTo: { l: move.from.l, t: m.ft, x: m.rookTo, y: m.fy },
      }
    }
    if (m.ep) move.enPassant = true
    return move
  }

  movablePieces(): Pos[] {
    if (this._result.kind !== 'ongoing') return []
    const mv = this.mv
    const W = mv.width
    const bit = colorBit(this._player)
    const res: Pos[] = []
    for (const [li, t] of playableEnds(mv, mv, this._player)) {
      const cells = mv.board(li, t)!
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i]
        if (c === 0 || (c & BLACK) !== bit) continue
        const x = i % W
        const y = (i - x) / W
        if (this.movesAtInternal(li, t, x, y).length > 0) res.push({ l: mv.lOf(li), t, x, y })
      }
    }
    return res
  }

  movesFrom(from: Pos): Move[] {
    if (this._result.kind !== 'ongoing') return []
    const li = this.mv.liOf(from.l)
    if (!this.isPlayable(li, from.t)) return []
    const cells = this.mv.board(li, from.t)!
    const c = cells[from.y * this.mv.width + from.x]
    if (c === 0 || (c & BLACK) !== colorBit(this._player)) return []
    return this.movesAtInternal(li, from.t, from.x, from.y).map((m) => this.toPublic(m))
  }

  moveKind(move: Move): MoveKind {
    if (move.from.l === move.to.l && move.from.t === move.to.t) return 'spatial'
    const li = this.mv.liOf(move.to.l)
    return this.mv.endT(li) === move.to.t ? 'jump' : 'branch'
  }

  private findInternal(move: Move): IMove {
    const li = this.mv.liOf(move.from.l)
    const { t, x, y } = move.from
    if (!this.isPlayable(li, t)) throw new Error('Illegal move: the source board is not playable')
    const cells = this.mv.board(li, t)!
    const c = cells[y * this.mv.width + x]
    if (c === 0 || (c & BLACK) !== colorBit(this._player)) throw new Error('Illegal move: no piece of the current player there')
    const tl = this.mv.liOf(move.to.l)
    const cand = this.movesAtInternal(li, t, x, y).find((m) => m.tl === tl && m.tt === move.to.t && m.tx === move.to.x && m.ty === move.to.y)
    if (!cand) throw new Error('Illegal move')
    if (move.promotion && cand.promo) {
      if (!this.promotions.includes(move.promotion)) throw new Error(`Promotion to ${move.promotion} is not allowed`)
      return { ...cand, promo: typeFromLetter(move.promotion) }
    }
    return cand
  }

  makeMove(move: Move): void {
    if (this._result.kind !== 'ongoing') throw new Error('The game is over')
    this.applyInternal(this.findInternal(move))
  }

  /** Make a move given in 5D PGN notation; returns the move. */
  makeMoveNotation(notation: string): Move {
    if (this._result.kind !== 'ongoing') throw new Error('The game is over')
    const im = parseMove(this.notationContext(), notation)
    this.applyInternal(im)
    return this.toPublic(im)
  }

  /** Parse a move in 5D PGN notation in the current position (without making it). */
  parseMove(notation: string): Move {
    return this.toPublic(parseMove(this.notationContext(), notation))
  }

  private notationContext(): NotationContext {
    return {
      mv: this.mv,
      playerColor: this._player,
      promoType: typeFromLetter(this.promotions[0]),
      movesAt: (li, t, x, y) => this.movesAtInternal(li, t, x, y),
      branchWouldBeActive: () => {
        const c = sideCounts(this.mv.even, this.mv)
        return this._player === 'white' ? c.white <= c.black : c.black <= c.white
      },
    }
  }

  moveToNotation(move: Move): string {
    return moveNotation(this.notationContext(), this.findInternal(move))
  }

  private applyInternal(im: IMove): void {
    const mv = this.mv
    const W = mv.width
    const notation = moveNotation(this.notationContext(), im)
    const move = this.toPublic(im)
    const src = mv.board(im.fl, im.ft)!
    const dst = mv.board(im.tl, im.tt)!
    const code = src[im.fy * W + im.fx]
    const capturedCode = im.ep ? src[im.fy * W + im.tx] : dst[im.ty * W + im.tx]
    const record: MoveRecord = {
      move,
      kind: 'spatial',
      player: this._player,
      notation,
      fromBoard: { l: mv.lOf(im.fl), t: im.ft + 1 },
    }
    if (capturedCode) record.captured = codeToPiece(capturedCode)!
    const applied: Applied = { im, srcLi: im.fl, destLi: null, newLi: null, record }
    if (isSpatial(im)) {
      mv.appendBoard(im.fl, applySpatial(src, W, im))
    } else if (mv.endT(im.tl) === im.tt) {
      record.kind = 'jump'
      mv.appendBoard(im.fl, applyDepart(src, W, im))
      mv.appendBoard(im.tl, applyArrive(dst, W, im, code))
      applied.destLi = im.tl
      record.toBoard = { l: mv.lOf(im.tl), t: im.tt + 1 }
    } else {
      record.kind = 'branch'
      const li = nextLi(mv, this._player)
      mv.appendBoard(im.fl, applyDepart(src, W, im))
      mv.addTimeline({
        li,
        startT: im.tt + 1,
        boards: [{ li, t: im.tt + 1, cells: applyArrive(dst, W, im, code), pub: null }],
        branchedFrom: { li: im.tl, t: im.tt },
        createdBy: this._player,
      })
      applied.newLi = li
      record.toBoard = { l: mv.lOf(li), t: im.tt + 1 }
      record.createdTimeline = mv.lOf(li)
    }
    this.applied.push(applied)
    this._pending.push(move)
  }

  undoMove(): boolean {
    const a = this.applied.pop()
    if (!a) return false
    this._pending.pop()
    if (a.newLi !== null) this.mv.removeTimeline(a.newLi)
    if (a.destLi !== null) this.mv.popBoard(a.destLi)
    this.mv.popBoard(a.srcLi)
    return true
  }

  // ------------------------------------------------------------------ checks and submitting

  checks(): Check[] {
    const mv = this.mv
    const ov = this.blankedOverlay()
    const opp = otherColor(this._player)
    const res: Check[] = []
    // Positions on passed (hypothetical) boards are reported on the real end board.
    const realT = (li: number, t: number): number => (ov.extra.has(bkey(li, t)) ? t - 1 : t)
    scanChecks(ov, playableEnds(ov, mv, opp), opp, (fl, ft, fx, fy, tl, tt, tx, ty) => {
      res.push({
        from: { l: mv.lOf(fl), t: realT(fl, ft), x: fx, y: fy },
        to: { l: mv.lOf(tl), t: realT(tl, tt), x: tx, y: ty },
      })
      return false
    })
    return res
  }

  /** Whether the current player's royal pieces are attacked (passing on all still-required boards). */
  isInCheck(): boolean {
    const ov = this.blankedOverlay()
    const opp = otherColor(this._player)
    return scanChecks(ov, playableEnds(ov, this.mv, opp), opp, () => true)
  }

  canSubmit(): boolean {
    return this.submitBlocker() === null && this._result.kind === 'ongoing'
  }

  submitBlocker(): null | 'must-move-present' | 'in-check' {
    if (requiredTimelines(this.mv, this.mv.even, this.mv, this._player).length > 0) return 'must-move-present'
    const opp = otherColor(this._player)
    if (scanChecks(this.mv, playableEnds(this.mv, this.mv, opp), opp, () => true)) return 'in-check'
    return null
  }

  submit(): void {
    this.submitInternal(!this.options.skipMateDetection)
  }

  private submitInternal(detect: boolean): void {
    if (!this.canSubmit()) throw new Error(`Cannot submit: ${this.submitBlocker() ?? 'game over'}`)
    const records = this.applied.map((a) => a.record)
    this._history.push({ player: this._player, moves: this._pending })
    this.records.push(records)
    this._pending = []
    this.applied = []
    this._player = otherColor(this._player)
    this.mateSearchInconclusive = false
    if (detect) this.detectEnd()
    else if (this.isInCheck()) this.markLastMove('+')
  }

  /** Checkmate/stalemate detection for the player to move (start of an action). */
  private detectEnd(): void {
    const r = this.searchAction()
    const inCheck = this.isInCheck()
    if (r.status === 'none') {
      this._result = inCheck ? { kind: 'checkmate', winner: otherColor(this._player) } : { kind: 'stalemate' }
    } else if (r.status === 'timeout') {
      this.mateSearchInconclusive = true
    }
    if (inCheck) this.markLastMove(this._result.kind === 'checkmate' ? '#' : '+')
  }

  /** Put a check ("+") or mate ("#") marker on the last move of the last submitted action. */
  private markLastMove(suffix: string): void {
    const records = this.records[this.records.length - 1]
    if (!records || records.length === 0) return
    const last = records[records.length - 1]
    const present = last.notation.endsWith('~')
    const base = last.notation.replace(/~$/, '').replace(/[+#]$/, '')
    last.notation = base + suffix + (present ? '~' : '')
  }

  applyAction(action: Action): void {
    if (this._pending.length > 0) throw new Error('Cannot apply an action while moves are pending')
    if (action.player !== this._player) throw new Error(`It is ${this._player}'s turn`)
    try {
      for (const m of action.moves) this.makeMove(m)
      this.submit()
    } catch (e) {
      while (this.undoMove());
      throw e
    }
  }

  // ------------------------------------------------------------------ mate detection

  private searchAction(relaxed = false, timeBudgetMs?: number): SearchResult {
    return searchLegalAction(this.mv, this._player, (li, t) => this.movesFromBoard(li, t), {
      relaxed,
      timeBudgetMs: timeBudgetMs ?? this.options.mateTimeBudgetMs ?? 2000,
    })
  }

  /**
   * Whether the current player can still complete a legal action from the current
   * position (pending moves included). Returns null if the search timed out.
   */
  hasLegalAction(timeBudgetMs?: number): boolean | null {
    const r = this.searchAction(false, timeBudgetMs)
    return r.status === 'timeout' ? null : r.status === 'found'
  }

  /** A legal completion of the current action (moves in a valid order), or null if none/timeout. */
  findLegalAction(timeBudgetMs?: number): Move[] | null {
    return this.completeAction(false, timeBudgetMs)
  }

  private completeAction(relaxed: boolean, timeBudgetMs?: number): Move[] | null {
    const r = this.searchAction(relaxed, timeBudgetMs)
    if (r.status !== 'found') return null
    // Convert in order, applying moves on a scratch copy so later moves see the right kinds.
    const g = this.cloneGame()
    const res: Move[] = []
    for (const im of r.moves!) {
      res.push(g.toPublic(im))
      g.applyInternal(im)
    }
    return res
  }

  /**
   * @internal Escape search with the reference engine's semantics (passing on
   * required boards allowed). Returns the moves, null if none, 'timeout' on timeout.
   */
  relaxedEscape(timeBudgetMs?: number): Move[] | null | 'timeout' {
    const r = this.searchAction(true, timeBudgetMs)
    if (r.status === 'timeout') return 'timeout'
    if (r.status === 'none') return null
    return this.completeAction(true, timeBudgetMs)
  }

  // ------------------------------------------------------------------ notation / PGN

  /** 5DFEN of all current boards (for debugging/hashes). */
  fen(): string[] {
    const res: string[] = []
    for (const tl of this.mv.timelines()) {
      for (const b of tl.boards) res.push(boardToFen(this.mv.even, b.li, b.t, b.cells, this.mv.width, this.mv.height))
    }
    return res
  }

  toPgn(headers: Record<string, string> = {}): string {
    const lines: string[] = []
    const isCustom = !VARIANTS.some((v) => v.id === this.variant.id)
    const h: Record<string, string> = { Mode: '5D', Board: isCustom ? 'custom' : this.variant.name }
    if (isCustom || this.width !== 8 || this.height !== 8) h.Size = `${this.width}x${this.height}`
    if (isCustom && (this.promotions.length > 1 || this.promotions[0] !== 'Q')) h.Promotions = this.promotions.join(',')
    const r = this._result
    if (r.kind !== 'ongoing') {
      h.Result = r.kind === 'stalemate' || r.kind === 'draw-agreed' ? '1/2-1/2' : r.winner === 'white' ? '1-0' : '0-1'
    }
    Object.assign(h, headers)
    for (const [k, v] of Object.entries(h)) lines.push(`[${k} "${v.replace(/"/g, "'")}"]`)
    if (isCustom) lines.push(...this.initialFen)
    lines.push('')
    let turn = 1
    let line = ''
    this.records.forEach((rec, i) => {
      const player = this._history[i].player
      const moves = rec.map((m) => m.notation).join(' ')
      if (player === 'white') {
        if (line) lines.push(line)
        line = `${turn}. ${moves}`
      } else {
        if (line) {
          line += ` / ${moves}`
          lines.push(line)
          line = ''
        } else {
          lines.push(`${turn}b. ${moves}`)
        }
        turn++
      }
    })
    if (line) lines.push(line)
    return lines.join('\n') + '\n'
  }

  // ------------------------------------------------------------------ cloning

  private cloneGame(): Game {
    const g = Object.create(Game.prototype) as Game
    const self = this as unknown as Record<string, unknown>
    const other = g as unknown as Record<string, unknown>
    for (const k of Object.keys(self)) other[k] = self[k]
    g.mv = this.mv.clone()
    g._history = this._history.slice()
    g._pending = this._pending.slice()
    g.applied = this.applied.map((a) => ({ ...a, record: { ...a.record } }))
    g.records = this.records.map((r) => r.map((x) => ({ ...x })))
    g.options = { ...this.options }
    return g
  }

  clone(): Game {
    return this.cloneGame()
  }
}

function lowerKeys(h: Record<string, string>): Record<string, string> {
  const r: Record<string, string> = {}
  for (const [k, v] of Object.entries(h)) r[k.toLowerCase()] = v
  return r
}

/** Create a new game of the given variant (id, display name or alias). */
export function createGame(variantId: string, options?: GameOptions): Game {
  return Game.create(variantId, options)
}

/** Load a game from 5D PGN. */
export function loadPgn(pgn: string, options?: GameOptions): Game {
  return Game.fromPgn(pgn, options)
}
