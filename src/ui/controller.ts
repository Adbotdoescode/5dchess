// Game controller: owns the engine Game, the selection state and the wiring to
// the renderer and (online) the network session. Framework-agnostic; React
// subscribes via subscribe()/rev.

import { Game } from '../engine'
import type { Action, Check, Color, GameResult, Move, MoveRecord, MultiverseSnapshot, Piece, Pos } from '../engine'
import type { BoardArrow, HighlightedSquare, MultiverseRenderer, RenderModel, ViewFilter } from '../render'
import type { ClockSettings, OnlineEvent, OnlineSession } from '../net'
import { LocalClock, toClockView } from './clock'
import type { ClockView, LocalClockSave } from './clock'
import { detectEnd } from './mate'
import { getSettings } from './settings'
import type { Settings } from './settings'
import { sound } from './sound'
import { KEYS, saveJson } from './storage'

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

export class GameController {
  game: Game
  readonly mode: Mode
  readonly variantId: string

  selected: Pos | null = null
  private dests: Move[] = []
  private hover: Pos | null = null
  /** Manual "Flip Persp." toggle, relative to the automatic perspective. */
  flipped = false
  viewFilter: ViewFilter = 'all'
  submitting = false
  checkingEnd = false
  opponentOnline: boolean | null = null
  drawOfferIncoming = false
  drawOfferSent = false
  rematchIncoming = false
  rematchSent = false
  overlayDismissed = false
  /** Opponent sent something we could not apply; we are waiting for a resync. */
  desynced = false

  /** Revision for React (bumped on every UI-visible change). */
  rev = 0
  private gameRev = 0
  private listeners = new Set<() => void>()
  private renderer: MultiverseRenderer | null = null
  private cache: {
    rev: number
    snapshot: MultiverseSnapshot
    decor: { highlights: HighlightedSquare[]; arrows: BoardArrow[]; pendingBoards: string[] }
    checks: Check[]
    required: string[]
  } | null = null
  private mateReq = 0
  private cycleIndex = -1
  private lastPerspective: Color | null = null
  private flagClaimed = false
  private localClock: LocalClock | null = null
  private offSession: (() => void) | null = null

  private onNotice: ((text: string, tone: NoticeTone) => void) | null = null
  private onRematch: ((code: string) => void) | null = null

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
      this.game = Game.fromActions(info.variantId, info.actions, GAME_OPTS)
      if (info.result.kind !== 'ongoing') this.game.setResult(info.result)
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

  attach(renderer: MultiverseRenderer): void {
    this.renderer = renderer
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
    this.lastPerspective = this.perspective
    this.render()
    renderer.focusPresent()
    if (this.game.result().kind === 'ongoing') this.runEndCheck()
  }

  detach(): void {
    this.offSession?.()
    this.offSession = null
    this.renderer = null
    this.mateReq++
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

  get canInteract(): boolean {
    if (!this.myTurn || this.submitting || this.desynced) return false
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

  get selectedPiece(): Piece | null {
    return this.selected ? this.pieceAt(this.selected) : null
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
      pendingBoards.push(bkey(rec.fromBoard.l, rec.fromBoard.t))
      if (rec.toBoard) pendingBoards.push(bkey(rec.toBoard.l, rec.toBoard.t))
    }
    return { highlights, arrows, pendingBoards }
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
    // Selecting a piece fades the opponent-colour boards (SG 04) unless a view is active.
    const viewFilter: ViewFilter = this.viewFilter === 'all' && this.selected ? 'history' : this.viewFilter
    return {
      snapshot: c.snapshot,
      perspective: this.perspective,
      highlights,
      arrows: c.decor.arrows,
      checks: c.checks,
      pendingBoards: c.decor.pendingBoards,
      requiredBoards: this.canInteract ? c.required : [],
      viewFilter,
      filterColor: this.selected ? this.game.player : filterColor,
      animations: s.animations,
      cameraMode: s.cameraMode,
      background: this.isOver ? 'ended' : 'default',
    }
  }

  render(): void {
    const r = this.renderer
    if (!r) return
    r.setModel(this.buildModel())
    const p = this.perspective
    if (this.lastPerspective !== null && p !== this.lastPerspective) r.focusPresent()
    this.lastPerspective = p
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
    if (!this.canInteract) return
    let kind: string
    try {
      kind = this.game.moveKind(mv)
      this.game.makeMove(mv)
    } catch (e) {
      this.notice(e instanceof Error ? e.message : String(e), 'error')
      return
    }
    this.selected = null
    this.dests = []
    sound.play(kind === 'spatial' ? 'move' : 'travel')
    this.changed()
  }

  undo(): void {
    sound.unlock()
    if (this.selected) this.deselect()
    if (!this.canInteract) return
    if (this.game.undoMove()) {
      sound.play('undo')
      this.changed()
    }
  }

  async submit(): Promise<void> {
    sound.unlock()
    if (!this.canSubmit) return
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
    const nextActive = this.activeTimelineCount()
    this.localClock?.submitted(action.player, nextActive)
    sound.play('submit')
    const s = this.online
    if (s) this.submitting = true
    this.changed()
    if (this.game.checks().length > 0) setTimeout(() => sound.play('check'), 180)
    this.renderer?.focusPresent()
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

  toggleView(v: 'history' | 'parallel'): void {
    const wasParallel = this.viewFilter === 'parallel'
    this.viewFilter = this.viewFilter === v ? 'all' : v
    this.viewChanged()
    // Parallel View packs the columns, so the camera has to follow the new layout.
    if (wasParallel || this.viewFilter === 'parallel') this.renderer?.focusPresent()
  }

  dismissOverlay(show = false): void {
    this.overlayDismissed = !show
    this.emit()
  }

  // ---------------------------------------------------------------- game end

  private runEndCheck(): void {
    const g = this.game
    if (g.result().kind !== 'ongoing') return
    const len = g.history.length
    const req = ++this.mateReq
    this.checkingEnd = true
    const actions = g.history.slice()
    detectEnd(this.variantId, actions).then((r) => {
      if (req !== this.mateReq || this.game !== g || g.history.length !== len) return
      this.checkingEnd = false
      if (r.hasLegal === false && g.result().kind === 'ongoing') {
        const result: GameResult = r.inCheck ? { kind: 'checkmate', winner: other(g.player) } : { kind: 'stalemate' }
        this.finish(result)
      } else {
        this.emit()
      }
    })
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
    this.drawOfferIncoming = false
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
    this.drawOfferSent = true
    this.notice('Draw offered')
    this.emit()
  }

  answerDraw(accept: boolean): void {
    const s = this.online
    if (!s) return
    this.drawOfferIncoming = false
    if (accept) this.finish({ kind: 'draw-agreed' })
    else s.answerDraw(false)
    this.emit()
  }

  offerRematch(): void {
    const s = this.online
    if (!s || s.role === 'spectator') return
    if (this.rematchIncoming) s.acceptRematch()
    else s.offerRematch()
    this.rematchSent = true
    this.emit()
  }

  // ---------------------------------------------------------------- online events

  /** Apply anything the session learned before we subscribed. */
  private catchUp(): void {
    const s = this.online
    if (!s) return
    const info = s.info
    if (info.actions.length > this.game.history.length) {
      this.rebuild(info.actions, info.result, [])
    } else if (info.result.kind !== 'ongoing' && this.game.result().kind === 'ongoing') {
      this.game.setResult(info.result)
      this.gameRev++
    }
  }

  private onOnlineEvent(e: OnlineEvent): void {
    const s = this.online!
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
        if (e.nextActiveTimelines !== undefined && e.nextActiveTimelines !== this.activeTimelineCount()) {
          console.warn('active timeline count mismatch', e.nextActiveTimelines, this.activeTimelineCount())
          this.notice('Clock note: your opponent counted a different number of active timelines this turn')
        }
        const recs = g.actionRecords().at(-1) ?? []
        sound.play(recs.some((r) => r.kind !== 'spatial') ? 'travel' : 'move')
        this.changed()
        if (this.game.checks().length > 0) setTimeout(() => sound.play('check'), 200)
        this.renderer?.focusPresent()
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
        this.drawOfferIncoming = false
        this.drawOfferSent = false
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
        this.drawOfferIncoming = true
        sound.play('notify')
        this.emit()
        return
      case 'draw-declined':
        this.drawOfferSent = false
        this.notice('Draw offer declined')
        this.emit()
        return
      case 'rematch-offer':
        this.rematchIncoming = true
        sound.play('notify')
        this.emit()
        return
      case 'rematch-start':
        this.onRematch?.(e.code)
        return
      case 'error':
        this.notice(e.message, 'error')
        return
    }
  }

  /** Rebuild the Game from an authoritative action list (keeps the view). */
  private rebuild(actions: readonly Action[], result: GameResult, pending: readonly Move[]): void {
    let g: Game
    try {
      g = Game.fromActions(this.variantId, actions, GAME_OPTS)
    } catch (err) {
      console.error('rebuild failed', err)
      this.desynced = true
      this.notice('This game could not be loaded: its history is invalid.', 'error')
      this.emit()
      return
    }
    if (result.kind !== 'ongoing') g.setResult(result)
    else {
      for (const m of pending) {
        try {
          g.makeMove(m)
        } catch {
          break
        }
      }
    }
    this.game = g
    this.desynced = false
    this.selected = null
    this.dests = []
    this.mateReq++
    this.checkingEnd = false
    this.changed()
    this.renderer?.focusPresent()
    this.runEndCheck()
  }

  // ---------------------------------------------------------------- persistence

  private autosave(): void {
    if (this.mode.kind !== 'local') return
    this.saveNow()
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
    const headers: Record<string, string> = { Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.') }
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
