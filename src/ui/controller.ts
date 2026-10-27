// Game controller: owns the engine Game, the selection state and the wiring to
// the renderer and (online) the network session. Framework-agnostic; React
// subscribes via subscribe()/rev.

import { Game } from '../engine'
import type { Action, Check, Color, GameResult, Move, MoveRecord, MultiverseSnapshot, Piece, Pos } from '../engine'
import type { BoardArrow, HighlightedSquare, MotionBatch, MultiverseRenderer, PieceMotion, RenderModel, ViewFilter, ViewMode } from '../render'
import { playTravelCinematic } from '../render/cinematic'
import type { CinematicHandle } from '../render/cinematic'
import type { ClockSettings, OnlineEvent, OnlineSession } from '../net'
import { LocalClock, toClockView } from './clock'
import type { ClockView, LocalClockSave } from './clock'
import { detectEnd } from './mate'
import { friendlyError } from './format'
import { getSettings, updateSettings } from './settings'
import type { Settings } from './settings'
import { sound } from './sound'
import { KEYS, loadJson, removeKey, saveJson } from './storage'

export type Mode =
  | { kind: 'local'; clock: ClockSettings | null }
  | { kind: 'online'; session: OnlineSession }

export interface LocalSave {
  v: 1
  variantId: string
  actions: Action[]
  pending: Move[]
  result: GameResult
  clock: ClockSettings | null
  clockState: LocalClockSave | null
  savedAt: number
}

export type NoticeTone = 'info' | 'error'

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white')
const samePos = (a: Pos, b: Pos) => a.l === b.l && a.t === b.t && a.x === b.x && a.y === b.y
const bkey = (l: number, t: number) => `${l}:${t}`
const GAME_OPTS = { skipMateDetection: true } as const

export function capitalize(c: Color): string {
  return c === 'white' ? 'White' : 'Black'
}

/** Where a stored action history stopped replaying. */
export interface HistoryError {
  /** Index of the first action that could not be applied. */
  index: number
  player: Color
}

/**
 * Replay `actions` from the variant's start, stopping at the first one the engine
 * rejects (the game then shows the position before it).
 */
export function replayActions(variantId: string, actions: readonly Action[]): { game: Game; error: HistoryError | null } {
  const game = Game.create(variantId, GAME_OPTS)
  for (let i = 0; i < actions.length; i++) {
    const a = actions[i]
    try {
      game.applyAction(a)
    } catch (err) {
      console.error(`[history] action ${i} (${a?.player}) does not replay:`, err, a)
      const player: Color = a?.player === 'black' || a?.player === 'white' ? a.player : game.player
      return { game, error: { index: i, player } }
    }
  }
  return { game, error: null }
}

export class GameController {
  game: Game
  readonly mode: Mode
  readonly variantId: string

  selected: Pos | null = null
  private dests: Move[] = []
  private hover: Pos | null = null
  /** Manual "Flip Persp." toggle, relative to the automatic perspective. */
  flipped = false
  /** Camera view: the flat 2D view or the original's animated History / Parallel View. */
  viewMode: ViewMode = '2d'
  submitting = false
  checkingEnd = false
  opponentOnline: boolean | null = null
  private drawIncomingLocal = false
  private drawSentLocal = false
  /** An info.drawOffer value we know is out of date (declined / overtaken by a move). */
  private staleDrawOffer: Color | null = null
  private rematchIncomingLocal = false
  private rematchSentLocal = false
  overlayDismissed = false
  /** Opponent sent something we could not apply; we are waiting for a resync. */
  desynced = false
  /** The server's action history does not replay: the game is frozen before the bad action. */
  historyError: HistoryError | null = null

  /** Revision for React (bumped on every UI-visible change). */
  rev = 0
  private gameRev = 0
  private listeners = new Set<() => void>()
  private renderer: MultiverseRenderer | null = null
  /** Element hosting the renderer: the time-travel cinematic is overlaid on it. */
  private viewHost: HTMLElement | null = null
  /** The time-travel cinematic playing over the view (presentation only). */
  private cinematic: CinematicHandle | null = null
  /** While the cinematic plays, the renderer keeps showing this model (not the live one). */
  private heldModel: RenderModel | null = null
  /** HUD opacity (the cinematic fades the HUD out and back in). */
  private onHud: ((opacity: number) => void) | null = null
  private cache: {
    rev: number
    snapshot: MultiverseSnapshot
    decor: { highlights: HighlightedSquare[]; arrows: BoardArrow[]; pendingBoards: string[]; pendingKinds: Record<string, 'move' | 'travel'> }
    checks: Check[]
    required: string[]
  } | null = null
  /** Moves for the renderer to animate (a new id each time something moved). */
  private motion: MotionBatch | undefined
  private motionSeq = 0
  private mateReq = 0
  private cycleIndex = -1
  private flagClaimed = false
  private localClock: LocalClock | null = null
  private offSession: (() => void) | null = null
  /** The last end-of-game check failed (worker crashed / couldn't load): retry later. */
  private endCheckFailed = false
  private endCheckRetry: ReturnType<typeof setTimeout> | null = null
  private endCheckAttempts = 0
  private readonly onBrowserOnline = () => this.retryEndCheck()

  private onNotice: ((text: string, tone: NoticeTone) => void) | null = null
  private onRematch: ((code: string) => void) | null = null

  /** The time-travel cinematic fades the HUD out and back in through this. */
  setHudHandler(fn: ((opacity: number) => void) | null): void {
    this.onHud = fn
  }

  setNoticeHandler(fn: ((text: string, tone: NoticeTone) => void) | null): void {
    this.onNotice = fn
  }

  setRematchHandler(fn: ((code: string) => void) | null): void {
    this.onRematch = fn
  }

  constructor(mode: Mode, variantId: string, resume?: LocalSave | null) {
    this.mode = mode
    this.variantId = variantId
    if (mode.kind === 'online') {
      const info = mode.session.info
      const { game, error } = replayActions(info.variantId, info.actions)
      this.game = game
      this.historyError = error
      if (info.result.kind !== 'ongoing') this.game.setResult(info.result)
      else if (!error) this.restorePending(this.game)
    } else if (resume) {
      this.game = Game.fromActions(variantId, resume.actions, GAME_OPTS)
      for (const m of resume.pending) {
        try {
          this.game.makeMove(m)
        } catch {
          break
        }
      }
      if (resume.result.kind !== 'ongoing') this.game.setResult(resume.result)
    } else {
      this.game = Game.create(variantId, GAME_OPTS)
    }
    if (mode.kind === 'local' && mode.clock) {
      const initial = Game.create(variantId, GAME_OPTS)
      const firstActive = initial.snapshot().timelines.filter((t) => t.active).length
      this.localClock = new LocalClock(mode.clock, initial.player, firstActive, resume?.clockState ?? null)
      if (this.game.result().kind !== 'ongoing') this.localClock.stop()
    }
  }

  // ---------------------------------------------------------------- subscription

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getRev = (): number => this.rev

  private emit(): void {
    this.rev++
    for (const l of [...this.listeners]) l()
  }

  /** Game state changed: invalidate caches, re-render, notify React, autosave. */
  private changed(): void {
    this.gameRev++
    this.render()
    this.emit()
    this.autosave()
  }

  /** Only view state changed (selection, filter, perspective). */
  private viewChanged(): void {
    this.render()
    this.emit()
  }

  private notice(text: string, tone: NoticeTone = 'info'): void {
    this.onNotice?.(text, tone)
  }

  // ---------------------------------------------------------------- lifecycle

  attach(renderer: MultiverseRenderer, host?: HTMLElement): void {
    this.renderer = renderer
    this.viewHost = host ?? null
    renderer.setEvents({
      onSquareClick: (pos) => this.clickSquare(pos),
      onSquareHover: (pos) => this.setHover(pos),
      onBackgroundClick: () => this.deselect(),
    })
    if (this.mode.kind === 'online') {
      const session = this.mode.session
      this.offSession = session.on((e) => this.onOnlineEvent(e))
      this.catchUp()
    }
    window.addEventListener('online', this.onBrowserOnline)
    this.render()
    renderer.focusPresent()
    if (this.game.result().kind === 'ongoing') this.runEndCheck()
  }

  detach(): void {
    this.cinematic?.dispose()
    this.cinematic = null
    this.heldModel = null
    this.offSession?.()
    this.offSession = null
    this.renderer = null
    this.mateReq++
    window.removeEventListener('online', this.onBrowserOnline)
    if (this.endCheckRetry) clearTimeout(this.endCheckRetry)
    this.endCheckRetry = null
    this.saveNow()
  }

  /** Re-render after a settings change. */
  settingsChanged(): void {
    this.viewChanged()
  }

  // ---------------------------------------------------------------- derived state

  get online(): OnlineSession | null {
    return this.mode.kind === 'online' ? this.mode.session : null
  }

  get isSpectator(): boolean {
    return this.online?.role === 'spectator'
  }

  /** Our seat online; null locally. */
  get myColor(): Color | null {
    const s = this.online
    if (!s) return null
    return s.role === 'spectator' ? null : s.role
  }

  get result(): GameResult {
    return this.game.result()
  }

  get isOver(): boolean {
    return this.game.result().kind !== 'ongoing'
  }

  get myTurn(): boolean {
    if (this.isOver) return false
    const s = this.online
    if (!s) return true
    return s.role === this.game.player
  }

  /** True while the time-travel cinematic covers the view. */
  get cinematicPlaying(): boolean {
    return !!this.cinematic?.playing
  }

  get canInteract(): boolean {
    if (!this.myTurn || this.submitting || this.desynced || this.historyError) return false
    const s = this.online
    if (s && !s.info.opponentJoined) return false
    return true
  }

  get perspective(): Color {
    let base: Color
    const s = this.online
    if (s) base = s.role === 'spectator' ? 'white' : s.role
    else base = getSettings().autoFlip ? this.game.player : 'white'
    return this.flipped ? other(base) : base
  }

  /** Our seat's opponent (null locally / spectating). */
  private get opponentColor(): Color | null {
    const me = this.myColor
    return me ? other(me) : null
  }

  /** The server's record of an open draw offer (persisted: survives reloads). */
  private get infoDrawOffer(): Color | null {
    return this.online?.info.drawOffer ?? null
  }

  /** The opponent offers a draw (from the live event or, after a reload, the server's state). */
  get drawOfferIncoming(): boolean {
    if (this.isOver || this.historyError) return false
    if (this.drawIncomingLocal) return true
    const d = this.infoDrawOffer
    return !!d && d === this.opponentColor && this.staleDrawOffer !== d
  }

  /** We offered a draw that is still open. */
  get drawOfferSent(): boolean {
    if (this.isOver) return false
    if (this.drawSentLocal) return true
    const d = this.infoDrawOffer
    return !!d && d === this.myColor && this.staleDrawOffer !== d
  }

  /** Any action ends an open draw offer: "Offer draw" is available again. */
  private clearDrawOffers(): void {
    this.drawIncomingLocal = false
    this.drawSentLocal = false
    this.staleDrawOffer = this.infoDrawOffer
  }

  /** The opponent asked for a rematch (live event, or the server's record after a reload). */
  get rematchIncoming(): boolean {
    if (this.rematchIncomingLocal) return true
    const r = this.online?.info.rematchOffer ?? null
    return !!r && r === this.opponentColor
  }

  /** We asked for (or accepted) a rematch. */
  get rematchSent(): boolean {
    if (this.rematchSentLocal) return true
    const r = this.online?.info.rematchOffer ?? null
    return !!r && r === this.myColor
  }

  /** Code of the rematch game once it exists (server state; survives reloads). */
  get rematchCode(): string | null {
    const info = this.online?.info
    const c = info?.rematchCode
    return typeof c === 'string' && c && c !== info?.code ? c : null
  }

  /** Follow the rematch recorded on the server (e.g. after a reload missed the live event). */
  joinRematch(): void {
    const c = this.rematchCode
    if (c) this.onRematch?.(c)
  }

  get selectedPiece(): Piece | null {
    return this.selected ? this.pieceAt(this.selected) : null
  }

  /** What the selected piece can reach: other turns (History View) / other timelines (Parallel View). */
  get selectedReach(): { time: boolean; timelines: boolean } {
    let time = false
    let timelines = false
    for (const m of this.dests) {
      if (m.to.t !== m.from.t) time = true
      if (m.to.l !== m.from.l) timelines = true
    }
    return { time, timelines }
  }

  /**
   * Boards that get the "!" badge at the end of the game: the mated player's boards in
   * the present (green for the winner's view, red otherwise; game_end_you_win/lose).
   */
  get endBadges(): { l: number; t: number }[] {
    if (this.game.result().kind !== 'checkmate') return []
    return this.game.requiredBoards()
  }

  pieceAt(pos: Pos): Piece | null {
    const b = this.game.board(pos.l, pos.t)
    if (!b || pos.x < 0 || pos.y < 0 || pos.x >= b.width || pos.y >= b.height) return null
    return b.squares[pos.y * b.width + pos.x]
  }

  private ensureCache() {
    if (this.cache && this.cache.rev === this.gameRev) return this.cache
    const g = this.game
    const snapshot = g.snapshot()
    const checks = g.checks()
    const required = g.requiredBoards().map((b) => bkey(b.l, b.t))
    this.cache = { rev: this.gameRev, snapshot, decor: this.buildDecor(), checks, required }
    return this.cache
  }

  private buildDecor() {
    const g = this.game
    const s = getSettings()
    const highlights: HighlightedSquare[] = []
    const arrows: BoardArrow[] = []
    const pendingBoards: string[] = []
    const pendingKinds: Record<string, 'move' | 'travel'> = {}
    const all = g.actionRecords()
    const mark = (rec: MoveRecord, kind: 'moved' | 'travel') => {
      const m = rec.move
      if (rec.kind === 'spatial') {
        highlights.push({ pos: { l: rec.fromBoard.l, t: rec.fromBoard.t, x: m.from.x, y: m.from.y }, kind })
        highlights.push({ pos: { l: rec.fromBoard.l, t: rec.fromBoard.t, x: m.to.x, y: m.to.y }, kind })
      } else {
        highlights.push({ pos: { l: rec.fromBoard.l, t: rec.fromBoard.t, x: m.from.x, y: m.from.y }, kind: 'travel' })
        if (rec.toBoard) highlights.push({ pos: { l: rec.toBoard.l, t: rec.toBoard.t, x: m.to.x, y: m.to.y }, kind: 'travel' })
      }
    }
    all.forEach((recs, i) => {
      const last = i === all.length - 1
      for (const rec of recs) {
        if (s.historyHighlights || last) mark(rec, 'moved')
        if (rec.kind !== 'spatial' && (s.allArrows || last)) arrows.push({ from: rec.move.from, to: rec.move.to, kind: 'last-move' })
      }
    })
    for (const rec of g.pendingRecords()) {
      mark(rec, 'moved')
      if (rec.kind !== 'spatial') arrows.push({ from: rec.move.from, to: rec.move.to, kind: 'pending' })
      const kind = rec.kind === 'spatial' ? 'move' : 'travel'
      const from = bkey(rec.fromBoard.l, rec.fromBoard.t)
      pendingBoards.push(from)
      pendingKinds[from] = kind
      if (rec.toBoard) {
        const to = bkey(rec.toBoard.l, rec.toBoard.t)
        pendingBoards.push(to)
        pendingKinds[to] = kind
      }
    }
    return { highlights, arrows, pendingBoards, pendingKinds }
  }

  get snapshot(): MultiverseSnapshot {
    return this.ensureCache().snapshot
  }

  /** Royal pieces of the player to move currently attacked (tentative position, required boards passed). */
  get checks(): Check[] {
    return this.ensureCache().checks
  }

  buildModel(): RenderModel {
    const c = this.ensureCache()
    const s = getSettings()
    const highlights = c.decor.highlights.slice()
    for (const ch of c.checks) highlights.push({ pos: ch.to, kind: 'check' })
    if (this.selected) {
      highlights.push({ pos: this.selected, kind: 'selected' })
      for (const m of this.dests) highlights.push({ pos: m.to, kind: this.pieceAt(m.to) || m.enPassant ? 'capture' : 'destination' })
    }
    if (this.hover && this.canInteract) highlights.push({ pos: this.hover, kind: 'hover' })
    const filterColor = this.myColor ?? this.game.player
    // Selecting a piece fades the opponent-colour boards (SG 04), in every view.
    const viewFilter: ViewFilter = this.selected ? 'history' : 'all'
    return {
      snapshot: c.snapshot,
      perspective: this.perspective,
      highlights,
      arrows: c.decor.arrows,
      checks: c.checks,
      pendingBoards: c.decor.pendingBoards,
      pendingBoardKinds: c.decor.pendingKinds,
      requiredBoards: this.canInteract ? c.required : [],
      viewFilter,
      filterColor: this.selected ? this.game.player : filterColor,
      animations: s.animations,
      viewMode: this.viewMode,
      motion: this.motion,
      background: this.isOver ? 'ended' : 'default',
    }
  }

  render(): void {
    const r = this.renderer
    if (!r) return
    // a perspective change flips the view in place (the renderer animates and mirrors the camera)
    r.setModel(this.heldModel ?? this.buildModel())
  }

  /** Queue moves for the renderer to animate (played once). */
  private animate(recs: readonly MoveRecord[], reverse = false): void {
    if (!recs.length) return
    const moves: PieceMotion[] = recs.map((r) => ({ from: r.move.from, to: r.move.to, fromBoard: r.fromBoard, toBoard: r.toBoard }))
    this.motion = { id: ++this.motionSeq, moves, reverse }
  }

  /** Keep the boards to move on next in view (gently), after a submit or the opponent's action. */
  private follow(): void {
    const r = this.renderer
    if (!r) return
    if (r.followPresent) r.followPresent()
    else r.focusPresent()
  }

  activeTimelineCount(): number {
    return this.game.snapshot().timelines.filter((t) => t.active).length
  }

  // ---------------------------------------------------------------- HUD state

  /** Tint of the "Undo Move" pill: yellow after a normal move, blue after travel, red if in check. */
  get undoTone(): 'disabled' | 'yellow' | 'blue' | 'red' {
    const recs = this.game.pendingRecords()
    if (recs.length === 0 || !this.canInteract) return 'disabled'
    if (this.game.submitBlocker() === 'in-check' || this.checks.length > 0) return 'red'
    return recs[recs.length - 1].kind === 'spatial' ? 'yellow' : 'blue'
  }

  get canSubmit(): boolean {
    return this.canInteract && this.game.canSubmit()
  }

  clockView(now = Date.now()): ClockView | null {
    if (this.localClock) return this.localClock.view(now)
    const s = this.online
    if (!s) return null
    const c = s.clocks()
    return c ? toClockView(c, s.info.clock) : null
  }

  /** Called every animation frame by the clock widget: claims a timeout when a flag falls. */
  tickClock(view: ClockView | null): void {
    if (!view || !view.flagged || this.isOver || this.flagClaimed) return
    const loser = view.flagged
    const result: GameResult = { kind: 'timeout', winner: other(loser) }
    const s = this.online
    if (!s) {
      this.flagClaimed = true
      this.finish(result)
      return
    }
    if (s.role === 'spectator') return
    this.flagClaimed = true
    s.setResult(result)
      .then(() => this.syncResultFromSession())
      .catch(() => {
        // server clock not expired yet / network: try again shortly
        setTimeout(() => (this.flagClaimed = false), 1500)
      })
  }

  // ---------------------------------------------------------------- input

  setHover(pos: Pos | null): void {
    if (this.hover === pos || (this.hover && pos && samePos(this.hover, pos))) return
    this.hover = pos
    this.render()
  }

  clickSquare(pos: Pos): void {
    sound.unlock()
    if (!this.canInteract) return
    if (this.selected) {
      const mv = this.dests.find((m) => samePos(m.to, pos))
      if (mv) {
        this.makeMove(mv)
        return
      }
    }
    const piece = this.pieceAt(pos)
    if (piece && piece.color === this.game.player && this.isPlayable(pos.l, pos.t)) {
      if (this.selected && samePos(this.selected, pos)) {
        this.deselect()
        return
      }
      this.selected = pos
      this.dests = this.game.movesFrom(pos)
      sound.play('select')
      this.viewChanged()
      return
    }
    this.deselect()
  }

  private isPlayable(l: number, t: number): boolean {
    return this.game.playableBoards().some((b) => b.l === l && b.t === t)
  }

  deselect(): void {
    if (!this.selected) return
    this.selected = null
    this.dests = []
    this.viewChanged()
  }

  makeMove(mv: Move): void {
    if (!this.canInteract || this.cinematicPlaying) return
    let kind: string
    // the view as it was before the move (the cinematic starts from it)
    let before: RenderModel | null = null
    try {
      kind = this.game.moveKind(mv)
      if (kind !== 'spatial' && this.cinematicWanted()) before = this.buildModel()
      this.game.makeMove(mv)
    } catch (e) {
      this.notice(e instanceof Error ? e.message : String(e), 'error')
      return
    }
    this.selected = null
    this.dests = []
    this.animate(this.game.pendingRecords().slice(-1))
    sound.play(kind === 'spatial' ? 'move' : 'travel')
    if (before) this.startCinematic(before, mv)
    this.changed()
  }

  // ---------------------------------------------------------------- time-travel cinematic

  /**
   * The original's rule: with the round button on, the next time travel the player makes on this screen plays the vortex
   * cinematic and the button turns itself off. The opponent's travel never plays it.
   */
  private cinematicWanted(): boolean {
    return getSettings().travelAnimation && !!this.renderer && !!this.viewHost && !this.cinematic
  }

  private startCinematic(before: RenderModel, mv: Move): void {
    const r = this.renderer
    const host = this.viewHost
    const rec = this.game.pendingRecords().at(-1)
    if (!r || !host || !rec?.toBoard) return
    // the button turns itself off as soon as the animation starts (before the HUD returns)
    updateSettings({ travelAnimation: false })
    this.heldModel = before
    r.setInputEnabled?.(false)
    this.gameRev++ // the model cache must see the move
    const after = this.buildModel()
    const toBoard = rec.toBoard
    this.cinematic = playTravelCinematic(host, {
      before,
      after,
      move: { from: mv.from, to: mv.to },
      toBoard,
      view: r.getView?.() ?? null,
      onHud: (a) => this.onHud?.(a),
      onCue: (c) => {
        if (c === 'land') sound.play('move')
      },
      onLand: (cam) => {
        // the move's own board-slide animation must not play under (or after) the overlay
        const m = this.buildModel() // the Present bar stays put until the camera has zoomed back out
        this.heldModel = { ...m, snapshot: { ...m.snapshot, present: before.snapshot.present }, animations: false, hiddenBoards: [bkey(cam.l, cam.t)] }
        const rr = this.renderer
        if (!rr) return
        rr.setModel(this.heldModel)
        rr.moveCamera?.({ cx: cam.cx, cy: cam.cy, zoom: cam.zoom })
      },
      onOverlayEnd: (cam) => {
        this.heldModel = this.heldModel && { ...this.heldModel, hiddenBoards: undefined }
        setTimeout(() => ((this.heldModel = null), this.render()), cam.zoomOutMs)
        this.cinematic = null
        this.onHud?.(1)
        const rr = this.renderer
        if (rr) {
          if (this.heldModel) rr.setModel(this.heldModel)
          rr.moveCamera?.({ cx: cam.cx, cy: cam.cy, zoom: cam.zoomOut }, { durationMs: cam.zoomOutMs, ease: 'out-sine' })
          rr.setInputEnabled?.(true)
        }
        this.emit()
      },
    })
    if (!this.cinematic.playing) {
      // nothing to show (e.g. the boards are not in the layout): back to the live view
      this.heldModel = null
      this.cinematic = null
      r.setInputEnabled?.(true)
    }
  }

  /** Skip the cinematic (click / key), as the original's player can't but we allow. */
  skipCinematic(): void {
    this.cinematic?.skip()
  }

  undo(): void {
    sound.unlock()
    if (this.cinematicPlaying) return
    if (this.selected) this.deselect()
    if (!this.canInteract) return
    const last = this.game.pendingRecords().slice(-1)
    if (this.game.undoMove()) {
      this.animate(last, true)
      sound.play('undo')
      this.changed()
    }
  }

  async submit(): Promise<void> {
    sound.unlock()
    if (!this.canSubmit || this.cinematicPlaying) return
    const g = this.game
    const action: Action = { player: g.player, moves: g.pendingMoves.slice() }
    const index = g.history.length
    try {
      g.submit()
    } catch (e) {
      this.notice(e instanceof Error ? e.message : String(e), 'error')
      return
    }
    this.selected = null
    this.dests = []
    this.cycleIndex = -1
    this.clearDrawOffers()
    const nextActive = this.activeTimelineCount()
    this.localClock?.submitted(action.player, nextActive)
    sound.play('submit')
    const s = this.online
    if (s) this.submitting = true
    this.changed()
    if (this.game.checks().length > 0) setTimeout(() => sound.play('check'), 180)
    this.follow()
    this.runEndCheck()
    if (!s) return
    try {
      await s.submitAction(index, action, { nextActiveTimelines: nextActive })
    } catch {
      // The session already reported the error. Rebuild from the server's history and
      // put our moves back as pending if it is still our turn.
      if (this.mode.kind === 'online') this.rebuild(s.info.actions, s.info.result, s.info.actions.length === index ? action.moves : [])
    } finally {
      this.submitting = false
      this.emit()
    }
  }

  cycleBoards(): void {
    const r = this.renderer
    if (!r) return
    const g = this.game
    const required = g.requiredBoards()
    const rest = g.playableBoards().filter((b) => !required.some((q) => q.l === b.l && q.t === b.t))
    const boards = [...required, ...rest]
    if (boards.length === 0) {
      r.focusPresent()
      return
    }
    this.cycleIndex = (this.cycleIndex + 1) % boards.length
    const b = boards[this.cycleIndex]
    r.focusBoard(b.l, b.t)
  }

  flip(): void {
    this.flipped = !this.flipped
    this.viewChanged()
  }

  /** History / Parallel View tabs (T / Y): toggle that view; the other view switches directly. */
  toggleView(v: 'history' | 'parallel'): void {
    this.viewMode = this.viewMode === v ? '2d' : v
    this.viewChanged()
  }

  dismissOverlay(show = false): void {
    this.overlayDismissed = !show
    this.emit()
  }

  // ---------------------------------------------------------------- game end

  private runEndCheck(): void {
    const g = this.game
    if (g.result().kind !== 'ongoing' || this.historyError) return
    if (this.endCheckRetry) clearTimeout(this.endCheckRetry)
    this.endCheckRetry = null
    this.endCheckFailed = false
    const len = g.history.length
    const req = ++this.mateReq
    this.checkingEnd = true
    const actions = g.history.slice()
    detectEnd(this.variantId, actions).then((r) => {
      if (req !== this.mateReq || this.game !== g || g.history.length !== len) return
      this.checkingEnd = false
      if (r.hasLegal === null && r.error && r.error !== 'cancelled') {
        // The worker failed (e.g. offline and its script could not load): try again on
        // reconnect, on the next sync, or after a pause.
        console.warn('[mate] end-of-game check failed, will retry:', r.error)
        this.endCheckFailed = true
        if (this.endCheckAttempts < 30) {
          const delay = Math.min(30000, 2000 * 2 ** Math.min(this.endCheckAttempts, 4))
          this.endCheckRetry = setTimeout(() => this.retryEndCheck(), delay)
        }
        this.endCheckAttempts++
        this.emit()
        return
      }
      this.endCheckAttempts = 0
      if (r.hasLegal === false && g.result().kind === 'ongoing') {
        const result: GameResult = r.inCheck ? { kind: 'checkmate', winner: other(g.player) } : { kind: 'stalemate' }
        this.finish(result)
      } else {
        this.emit()
      }
    })
  }

  /** Re-run a failed end-of-game check (no-op if the last one succeeded). */
  private retryEndCheck(): void {
    if (!this.endCheckFailed || !this.renderer) return
    this.runEndCheck()
  }

  /** Apply a final result locally (and report it to the server online). */
  private finish(result: GameResult): void {
    const g = this.game
    if (g.result().kind !== 'ongoing') return
    while (g.undoMove());
    g.setResult(result)
    this.localClock?.stop()
    this.selected = null
    this.dests = []
    this.overlayDismissed = false
    this.clearDrawOffers()
    sound.play('end')
    this.changed()
    const s = this.online
    if (s && s.role !== 'spectator') {
      s.setResult(result)
        .then(() => this.syncResultFromSession())
        .catch(() => {})
    }
  }

  private syncResultFromSession(): void {
    const s = this.online
    if (!s) return
    const r = s.info.result
    if (r.kind === 'ongoing') return
    const cur = this.game.result()
    if (JSON.stringify(cur) === JSON.stringify(r)) return
    // the server's result wins (e.g. the opponent resigned a moment before our mate)
    while (this.game.undoMove());
    this.game.setResult(r)
    this.overlayDismissed = false
    this.changed()
  }

  resign(): void {
    if (this.isOver) return
    const s = this.online
    if (s) {
      if (s.role === 'spectator') return
      this.finish({ kind: 'resignation', winner: other(s.role) })
    } else {
      this.finish({ kind: 'resignation', winner: other(this.game.player) })
    }
  }

  offerDraw(): void {
    const s = this.online
    if (!s || this.isOver || s.role === 'spectator') return
    if (this.drawOfferIncoming) {
      this.answerDraw(true)
      return
    }
    s.offerDraw()
    this.drawSentLocal = true
    this.staleDrawOffer = null
    this.notice('Draw offered')
    this.emit()
  }

  answerDraw(accept: boolean): void {
    const s = this.online
    if (!s) return
    this.drawIncomingLocal = false
    const d = this.infoDrawOffer
    if (d && d !== this.myColor) this.staleDrawOffer = d
    if (accept) this.finish({ kind: 'draw-agreed' })
    else s.answerDraw(false)
    this.emit()
  }

  offerRematch(): void {
    const s = this.online
    if (!s || s.role === 'spectator') return
    if (this.rematchIncoming) s.acceptRematch()
    else s.offerRematch()
    this.rematchSentLocal = true
    this.emit()
  }

  // ---------------------------------------------------------------- online events

  /** Apply anything the session learned before we subscribed. */
  private catchUp(): void {
    const s = this.online
    if (!s) return
    const info = s.info
    if (info.actions.length > this.game.history.length && !this.historyError) {
      this.rebuild(info.actions, info.result, [])
    } else if (info.result.kind !== 'ongoing' && this.game.result().kind === 'ongoing') {
      this.game.setResult(info.result)
      this.gameRev++
    }
  }

  private onOnlineEvent(e: OnlineEvent): void {
    const s = this.online!
    // the session just heard from the server: a good moment to retry a failed end check
    if (e.type !== 'error') queueMicrotask(() => this.retryEndCheck())
    switch (e.type) {
      case 'action': {
        const g = this.game
        if (e.index < g.history.length) return
        if (e.index > g.history.length) {
          this.rebuild(s.info.actions, s.info.result, [])
          return
        }
        while (g.undoMove());
        try {
          g.applyAction(e.action)
        } catch (err) {
          console.error('invalid opponent action', err, e.action)
          this.desynced = true
          this.notice('Received a move that does not fit this game - resyncing…', 'error')
          this.emit()
          s.resync()
            .then(() => {
              try {
                this.rebuild(s.info.actions, s.info.result, [])
              } catch {
                /* reported in rebuild */
              }
            })
            .catch(() => {})
          return
        }
        this.desynced = false
        this.selected = null
        this.dests = []
        this.cycleIndex = -1
        this.clearDrawOffers()
        if (e.nextActiveTimelines !== undefined && e.nextActiveTimelines !== this.activeTimelineCount()) {
          console.warn('active timeline count mismatch', e.nextActiveTimelines, this.activeTimelineCount())
          this.notice('Clock note: your opponent counted a different number of active timelines this turn')
        }
        const recs = g.actionRecords().at(-1) ?? []
        // play the opponent's moves in sequence
        this.animate(recs)
        sound.play(recs.some((r) => r.kind !== 'spatial') ? 'travel' : 'move')
        this.changed()
        if (this.game.checks().length > 0) setTimeout(() => sound.play('check'), 200)
        this.follow()
        this.runEndCheck()
        return
      }
      case 'reset':
        this.rebuild(e.info.actions, e.info.result, [])
        return
      case 'result': {
        const g = this.game
        if (JSON.stringify(g.result()) === JSON.stringify(e.result)) return
        while (g.undoMove());
        g.setResult(e.result)
        this.selected = null
        this.dests = []
        this.overlayDismissed = false
        this.clearDrawOffers()
        sound.play('end')
        this.changed()
        return
      }
      case 'opponent-joined':
        this.notice('Your opponent joined')
        sound.play('notify')
        this.emit()
        return
      case 'opponent-presence':
        if (!e.online && this.opponentOnline === true && !this.isOver) this.notice('Opponent disconnected')
        else if (e.online && this.opponentOnline === false && !this.isOver) this.notice('Opponent reconnected')
        this.opponentOnline = e.online
        this.emit()
        return
      case 'draw-offer':
        if (this.isOver) return
        this.drawIncomingLocal = true
        this.staleDrawOffer = null
        sound.play('notify')
        this.emit()
        return
      case 'draw-declined': {
        this.drawSentLocal = false
        const d = this.infoDrawOffer
        if (d && d === this.myColor) this.staleDrawOffer = d
        if (e.reason !== 'expired') this.notice('Draw offer declined')
        this.emit()
        return
      }
      case 'draw-offer-withdrawn': {
        this.drawIncomingLocal = false
        const d = this.infoDrawOffer
        if (d && d !== this.myColor) this.staleDrawOffer = d
        this.emit()
        return
      }
      case 'rematch-offer':
        this.rematchIncomingLocal = true
        sound.play('notify')
        this.emit()
        return
      case 'rematch-start':
        this.onRematch?.(e.code)
        return
      case 'error':
        console.warn('[online]', e.message)
        this.notice(friendlyError(e.message), 'error')
        return
    }
  }

  /** Rebuild the Game from an authoritative action list (keeps the view). */
  private rebuild(actions: readonly Action[], result: GameResult, pending: readonly Move[]): void {
    const { game: g, error } = replayActions(this.variantId, actions)
    this.historyError = error
    if (result.kind !== 'ongoing') g.setResult(result)
    else if (!error) {
      for (const m of pending) {
        try {
          g.makeMove(m)
        } catch {
          break
        }
      }
      this.restorePending(g)
    }
    this.game = g
    this.desynced = false
    this.selected = null
    this.dests = []
    this.mateReq++
    this.checkingEnd = false
    if (error) this.cycleIndex = -1
    this.changed()
    this.renderer?.focusPresent()
    this.runEndCheck()
  }

  // ---------------------------------------------------------------- persistence

  private autosave(): void {
    if (this.mode.kind === 'local') {
      this.saveNow()
      return
    }
    // online: keep unsubmitted moves across a reload, keyed by game code + action index
    const key = this.pendingKey()
    if (!key) return
    const g = this.game
    if (g.pendingMoves.length > 0 && this.myTurn) saveJson(key, { index: g.history.length, moves: g.pendingMoves.slice() })
    else removeKey(key)
  }

  private pendingKey(): string | null {
    const s = this.online
    return s && s.role !== 'spectator' ? `${KEYS.pendingPrefix}${s.info.code}` : null
  }

  /** Re-apply unsubmitted moves saved before a reload, if they still fit. */
  private restorePending(g: Game): void {
    const key = this.pendingKey()
    if (!key || g.pendingMoves.length > 0 || g.result().kind !== 'ongoing' || this.online?.role !== g.player) return
    const saved = loadJson<{ index: number; moves: Move[] }>(key)
    if (!saved || saved.index !== g.history.length || !Array.isArray(saved.moves)) return
    for (const m of saved.moves) {
      try {
        g.makeMove(m)
      } catch {
        while (g.undoMove());
        return
      }
    }
  }

  saveNow(): void {
    if (this.mode.kind !== 'local') return
    const g = this.game
    const save: LocalSave = {
      v: 1,
      variantId: this.variantId,
      actions: g.history.slice(),
      pending: g.pendingMoves.slice(),
      result: g.result(),
      clock: this.mode.clock,
      clockState: this.localClock?.save() ?? null,
      savedAt: Date.now(),
    }
    saveJson(KEYS.localSave, save)
  }

  /** 5D PGN export with a few headers. */
  pgn(): string {
    const s = this.online
    const d = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const headers: Record<string, string> = { Date: `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}` }
    if (s) {
      headers.Site = s.info.code
      const me = s.role
      if (me !== 'spectator') {
        headers[capitalize(me)] = 'You'
        headers[capitalize(other(me))] = 'Opponent'
      }
    }
    return this.game.toPgn(headers)
  }
}

export type { Settings }
