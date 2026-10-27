// In-game screen: the renderer fills the window, with the original's HUD on top
// (docs/ui-spec.md §3): top-centre pills, right-edge tabs, bottom-left status,
// clocks top-left, the "*" menu and the end-of-game card.

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRenderer } from '../render'
import type { MultiverseRenderer } from '../render'
import type { Color } from '../engine'
import type { GameController } from './controller'
import { formatClock } from './clock'
import type { ClockView } from './clock'
import { Check, PieceGlyph, Toasts } from './components/common'
import { copyText, useToasts } from './util'
import { SettingsPanel } from './components/SettingsPanel'
import { colorName, gameEndedLine, resultText, variantName, youLine } from './format'
import { online } from '../net'
import { updateSettings, useSettings } from './settings'
import { sound } from './sound'

interface Props {
  ctrl: GameController
  onExit(): void
  onPlayAgain?(): void
}

const PAN_SPEED = 900 // CSS px per second
const ZOOM_SPEED = 1.9 // factor per second

export function GameScreen({ ctrl, onExit, onPlayAgain }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<MultiverseRenderer | null>(null)
  useSyncExternalStore(ctrl.subscribe, ctrl.getRev)
  const settings = useSettings()
  const [toasts, toast] = useToasts()
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // renderer + controller wiring
  useEffect(() => {
    const host = hostRef.current!
    const r = createRenderer(host)
    rendererRef.current = r
    ctrl.setNoticeHandler(toast)
    ctrl.attach(r)
    // test hook (dev server, or ?debug on a deployed build)
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) (window as unknown as { __5d?: unknown }).__5d = { ctrl, renderer: r }
    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      ctrl.deselect() // "Select/Drop: L/R mouse"
    }
    host.addEventListener('contextmenu', onContext)
    const onHide = () => ctrl.saveNow()
    window.addEventListener('pagehide', onHide)
    return () => {
      host.removeEventListener('contextmenu', onContext)
      window.removeEventListener('pagehide', onHide)
      ctrl.setNoticeHandler(null)
      ctrl.detach()
      r.dispose()
      rendererRef.current = null
    }
  }, [ctrl, toast])

  useEffect(() => {
    ctrl.settingsChanged()
  }, [ctrl, settings])

  // hotkeys (the original's list from the "*" menu, plus Ctrl/Cmd+Z, Enter and Esc)
  const modalOpen = menuOpen || settingsOpen
  useEffect(() => {
    const held = new Set<string>()
    let raf = 0
    let last = 0
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const r = rendererRef.current
      if (r && held.size > 0) {
        let dx = 0
        let dy = 0
        let z = 0
        if (held.has('a') || held.has('arrowleft')) dx -= 1
        if (held.has('d') || held.has('arrowright')) dx += 1
        if (held.has('w') || held.has('arrowup')) dy -= 1
        if (held.has('s') || held.has('arrowdown')) dy += 1
        if (held.has('e')) z += 1
        if (held.has('q')) z -= 1
        if (dx || dy) r.panBy?.(dx * PAN_SPEED * dt, dy * PAN_SPEED * dt)
        if (z) r.zoomBy?.(Math.pow(ZOOM_SPEED, z * dt))
      }
      raf = held.size > 0 ? requestAnimationFrame(loop) : 0
    }
    const onDown = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'escape') {
        if (menuOpen) setMenuOpen(false)
        else if (settingsOpen) return
        else if (ctrl.isOver && !ctrl.overlayDismissed) ctrl.dismissOverlay()
        else ctrl.deselect()
        return
      }
      if (modalOpen) return
      sound.unlock()
      const mod = e.ctrlKey || e.metaKey
      if (mod && k === 'z') {
        e.preventDefault()
        ctrl.undo()
        return
      }
      if (mod || e.altKey) return
      switch (k) {
        case 'backspace':
        case 'z':
          e.preventDefault()
          ctrl.undo()
          return
        case 'enter':
        case 'f':
          e.preventDefault()
          void ctrl.submit()
          return
        case 'tab':
          e.preventDefault()
          ctrl.cycleBoards()
          return
        case 't':
          ctrl.toggleView('history')
          return
        case 'y':
          ctrl.toggleView('parallel')
          return
        case 'u':
          ctrl.flip()
          return
        case 'w':
        case 'a':
        case 's':
        case 'd':
        case 'e':
        case 'q':
        case 'arrowleft':
        case 'arrowright':
        case 'arrowup':
        case 'arrowdown':
          e.preventDefault()
          held.add(k)
          if (!raf) {
            last = performance.now()
            raf = requestAnimationFrame(loop)
          }
          return
      }
    }
    const onUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase())
    const onBlur = () => held.clear()
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ctrl, menuOpen, settingsOpen, modalOpen])

  const g = ctrl.game
  const session = ctrl.online
  const result = ctrl.result
  const over = ctrl.isOver
  const piece = ctrl.selectedPiece
  const undoTone = ctrl.undoTone
  const me = ctrl.myColor
  const waiting = !!session && !session.info.opponentJoined

  const copy = async (text: string, what: string) => {
    toast((await copyText(text)) ? `${what} copied` : `Could not copy ${what.toLowerCase()}`)
  }

  // ---- status text (bottom-left), the original's exact strings
  let line1 = ''
  let line2 = ''
  if (over) {
    line2 = gameEndedLine(result)
    if (me) line1 = youLine(result, me)
  } else if (waiting) {
    line2 = 'Waiting for opponent…'
  } else if (session && !me) {
    line2 = `${colorName(g.player)} to move - Spectating`
  } else if (ctrl.myTurn) {
    line2 = `Your turn - ${colorName(g.player)} pieces`
  } else {
    line2 = `Their turn - ${colorName(g.player)} pieces`
  }
  if (!over && session && me && ctrl.opponentOnline === false && !waiting) line1 = 'Opponent disconnected - waiting…'
  if (ctrl.desynced) line1 = 'Resyncing with the server…'

  const showOverlay = over && !ctrl.overlayDismissed

  return (
    <div className="game">
      <div className="game-view" ref={hostRef} />
      <div className="hud">
        {/* top-centre pills */}
        <div className="top-pills">
          {piece ? (
            <button className="pill tan" onClick={() => ctrl.deselect()}>
              Deselect
              <PieceGlyph className="pill-glyph" type={piece.type} color={piece.color} />
            </button>
          ) : (
            <button className={`pill ${undoTone === 'disabled' ? '' : undoTone}`} disabled={undoTone === 'disabled'} onClick={() => ctrl.undo()}>
              Undo Move
            </button>
          )}
          {over ? (
            <button className="pill dark" onClick={() => ctrl.dismissOverlay(true)}>
              Finish Game
            </button>
          ) : (
            <button className="pill" disabled={!ctrl.canSubmit} onClick={() => void ctrl.submit()}>
              Submit Moves
            </button>
          )}
        </div>

        {/* clocks / presence, top-left */}
        <ClockPanel ctrl={ctrl} />
        {session && me && !waiting && (
          <div className="player-chip" title="Opponent connection">
            <span className={`presence ${ctrl.opponentOnline === null ? '' : ctrl.opponentOnline ? 'on' : 'off'}`} />
            {ctrl.opponentOnline === false ? 'Opponent offline' : ctrl.opponentOnline ? 'Opponent online' : 'Connecting…'}
          </div>
        )}

        {/* right-edge column */}
        <div className="side-tabs">
          <button className={`tab tab-star ${menuOpen ? 'active' : ''}`} aria-label="Game menu" onClick={() => setMenuOpen((v) => !v)}>
            <span>*</span>
          </button>
          <button
            className={`tab tab-round tab-anim ${settings.animations ? 'on' : ''}`}
            aria-label={settings.animations ? 'Animations on' : 'Animations off'}
            title={settings.animations ? 'Animations: on' : 'Animations: off'}
            onClick={() => updateSettings({ animations: !settings.animations })}
          >
            <span className="checker" />
          </button>
          <button className={`tab tab-vert ${ctrl.viewFilter === 'history' ? 'active' : ''}`} onClick={() => ctrl.toggleView('history')}>
            History View
          </button>
          <button className={`tab tab-vert ${ctrl.viewFilter === 'parallel' ? 'active' : ''}`} onClick={() => ctrl.toggleView('parallel')}>
            Parallel View
          </button>
          <button className={`tab tab-vert ${ctrl.flipped ? 'active' : ''}`} onClick={() => ctrl.flip()}>
            Flip Persp.
          </button>
          <button
            className={`tab tab-round tab-cycle ${g.player === 'black' ? 'black' : ''}`}
            aria-label="Cycle playable boards (Tab)"
            title="Cycle playable boards (Tab)"
            onClick={() => ctrl.cycleBoards()}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 5v6a3 3 0 0 1-3 3H5" />
              <path d="M9 10l-4 4 4 4" />
            </svg>
          </button>
        </div>

        <BoardDecor ctrl={ctrl} rendererRef={rendererRef} />

        <div className="status" aria-live="polite">
          {line1 && <div className="sub">{line1}</div>}
          <div>{line2}</div>
        </div>

        {ctrl.drawOfferIncoming && !over && (
          <div className="banner panel">
            <span>Your opponent offers a draw</span>
            <button className="pill small" onClick={() => ctrl.answerDraw(true)}>
              Accept
            </button>
            <button className="pill small" onClick={() => ctrl.answerDraw(false)}>
              Decline
            </button>
          </div>
        )}

        {over && ctrl.overlayDismissed && ctrl.rematchIncoming && !ctrl.rematchSent && (
          <div className="banner panel">
            <span>Your opponent wants a rematch</span>
            <button className="pill small" onClick={() => ctrl.offerRematch()}>
              Accept
            </button>
          </div>
        )}

        {showOverlay && (
          <GameOver ctrl={ctrl} onExit={onExit} onPlayAgain={onPlayAgain} />
        )}

        {menuOpen && (
          <>
            <div className="dim" onPointerDown={() => setMenuOpen(false)} />
            <StarMenu
              ctrl={ctrl}
              onClose={() => setMenuOpen(false)}
              onExit={onExit}
              onPlayAgain={onPlayAgain}
              onSettings={() => {
                setMenuOpen(false)
                setSettingsOpen(true)
              }}
              copy={copy}
            />
          </>
        )}
        {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
        <Toasts toasts={toasts} />
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ board decorations

/** Screen rectangle of a board's squares (centres of the corner squares) and one square's size. */
function boardRect(r: MultiverseRenderer, l: number, t: number, w: number, h: number) {
  if (!r.projectSquare) return null
  const pts = [
    r.projectSquare({ l, t, x: 0, y: 0 }),
    r.projectSquare({ l, t, x: w - 1, y: 0 }),
    r.projectSquare({ l, t, x: 0, y: h - 1 }),
    r.projectSquare({ l, t, x: w - 1, y: h - 1 }),
  ]
  if (pts.some((p) => !p)) return null
  const xs = pts.map((p) => p!.x)
  const ys = pts.map((p) => p!.y)
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  const sq = w > 1 ? (maxX - minX) / (w - 1) : h > 1 ? (maxY - minY) / (h - 1) : 30
  return { minX, maxX, minY, maxY, sq }
}

/**
 * DOM decorations that follow the camera: the green History/Parallel View buttons
 * docked to the selected board (SG 04: left edge = History View, top edge = Parallel
 * View; green when the piece can move that way, grey otherwise), and the end-of-game
 * "!" badge on the mated player's present board(s).
 */
function BoardDecor({ ctrl, rendererRef }: { ctrl: GameController; rendererRef: { current: MultiverseRenderer | null } }) {
  const histRef = useRef<HTMLButtonElement>(null)
  const parRef = useRef<HTMLButtonElement>(null)
  const badgeRefs = useRef<(HTMLDivElement | null)[]>([])
  const badges = ctrl.endBadges
  const me = ctrl.myColor
  const result = ctrl.result
  const badgeGreen = !!me && result.kind === 'checkmate' && result.winner === me
  useEffect(() => {
    let raf = 0
    const place = (el: HTMLElement | null, x: number, y: number, w: number, h: number) => {
      if (!el) return
      el.style.display = ''
      el.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y - h / 2)}px)`
      el.style.width = `${Math.round(w)}px`
      el.style.height = `${Math.round(h)}px`
    }
    const hide = (el: HTMLElement | null) => {
      if (el) el.style.display = 'none'
    }
    const tick = () => {
      raf = requestAnimationFrame(tick)
      const r = rendererRef.current
      const snap = ctrl.snapshot
      const sel = ctrl.selected
      const reach = ctrl.selectedReach
      const rect = r && sel && (reach.time || reach.timelines) ? boardRect(r, sel.l, sel.t, snap.width, snap.height) : null
      if (rect && rect.sq >= 6) {
        const s = Math.max(rect.sq, 22)
        const midX = (rect.minX + rect.maxX) / 2
        const midY = (rect.minY + rect.maxY) / 2
        const edge = s * 0.5 + s * 0.42
        place(histRef.current, rect.minX - edge, midY, s * 1.55, s * 2.35)
        place(parRef.current, midX, rect.minY - edge, s * 2.35, s * 1.55)
      } else {
        hide(histRef.current)
        hide(parRef.current)
      }
      badges.forEach((b, i) => {
        const el = badgeRefs.current[i]
        const br = r ? boardRect(r, b.l, b.t, snap.width, snap.height) : null
        if (!br || br.sq < 4) return hide(el)
        const s = Math.max(br.sq * 1.15, 16)
        const out = br.sq * 0.5 + br.sq * 0.3
        place(el, br.maxX + out, br.minY - out, s, s)
        if (el) el.style.fontSize = `${Math.round(s * 0.72)}px`
      })
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ctrl, rendererRef, badges])
  const reach = ctrl.selectedReach
  return (
    <div className="board-decor">
      <button
        ref={histRef}
        className={`float-btn ${reach.time ? 'go' : ''} ${ctrl.viewFilter === 'history' ? 'active' : ''}`}
        style={{ display: 'none' }}
        aria-label="History View"
        title="History View (T)"
        onClick={() => ctrl.toggleView('history')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M4 6l6-2v15l-6 2z" />
          <path d="M13 4l7 2v15l-7-2z" />
        </svg>
      </button>
      <button
        ref={parRef}
        className={`float-btn ${reach.timelines ? 'go' : ''} ${ctrl.viewFilter === 'parallel' ? 'active' : ''}`}
        style={{ display: 'none' }}
        aria-label="Parallel View"
        title="Parallel View (Y)"
        onClick={() => ctrl.toggleView('parallel')}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
          <path d="M7 5h14l-4 6H3z" />
          <path d="M7 12h14l-4 6H3z" />
        </svg>
      </button>
      {badges.map((b, i) => (
        <div
          key={`${b.l}:${b.t}`}
          ref={(el) => {
            badgeRefs.current[i] = el
          }}
          className={`end-badge ${badgeGreen ? 'green' : ''}`}
          style={{ display: 'none' }}
          aria-hidden="true"
        >
          !
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ clocks

function ClockPanel({ ctrl }: { ctrl: GameController }) {
  const [view, setView] = useState<ClockView | null>(() => ctrl.clockView())
  useEffect(() => {
    let raf = 0
    let lastText = ''
    const tick = () => {
      const v = ctrl.clockView()
      ctrl.tickClock(v)
      const text = v ? `${Math.ceil(v.white / 100)}|${Math.ceil(v.black / 100)}|${v.running}|${v.flagged}|${Math.ceil(v.delay / 1000)}` : ''
      if (text !== lastText) {
        lastText = text
        setView(v)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [ctrl])
  if (!view) return null
  const session = ctrl.online
  const me = ctrl.myColor
  const idleDelay = view.delayPerTimeline > 0 ? view.delayPerTimeline * Math.max(1, ctrl.activeTimelineCount()) : 0
  const row = (c: Color) => {
    const running = view.running === c
    const ms = c === 'white' ? view.white : view.black
    const suffix = running ? (view.delay > 0 ? `+${Math.ceil(view.delay / 1000)}` : '') : idleDelay > 0 && view.running ? `+${idleDelay}` : ''
    const isOpp = !!session && !!me && c !== me
    return (
      <div className={`clock-row ${running ? 'running' : ''} ${view.flagged === c ? 'flagged' : ''} ${running && ms < 30000 ? 'low' : ''}`}>
        <span className="who">
          {c === 'white' ? 'W' : 'B'}
          {isOpp && <span className={`presence ${ctrl.opponentOnline === null ? '' : ctrl.opponentOnline ? 'on' : 'off'}`} title="Opponent connection" />}
        </span>
        <span className="time">
          {formatClock(ms)}
          {suffix}
        </span>
      </div>
    )
  }
  return (
    <div className="clock-panel" aria-label="Clocks">
      <div className="clock-label">Clocks</div>
      <div className="clock-rows">
        {row('white')}
        {row('black')}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ end card

function GameOver({ ctrl, onExit, onPlayAgain }: { ctrl: GameController; onExit(): void; onPlayAgain?(): void }) {
  const r = ctrl.result
  const { title, detail } = resultText(r)
  const me = ctrl.myColor
  const session = ctrl.online
  return (
    <div className="overlay-wrap" onPointerDown={(e) => e.target === e.currentTarget && ctrl.dismissOverlay()}>
      <div className="panel game-over" role="dialog" aria-label="Game over">
        {me && <div className="you">{youLine(r, me)}</div>}
        <h2>{title}</h2>
        <div className="detail">{detail}</div>
        <div className="buttons">
          {session && me && (
            <button className={`pill ${ctrl.rematchIncoming ? 'blue' : ''}`} disabled={ctrl.rematchSent} onClick={() => ctrl.offerRematch()}>
              {ctrl.rematchSent ? 'Rematch offered…' : ctrl.rematchIncoming ? 'Accept rematch' : 'Rematch'}
            </button>
          )}
          {!session && onPlayAgain && (
            <button className="pill" onClick={onPlayAgain}>
              Play again
            </button>
          )}
          <button className="pill" onClick={onExit}>
            Main menu
          </button>
          <button className="pill small" onClick={() => ctrl.dismissOverlay()}>
            View board
          </button>
        </div>
        {session && me && ctrl.rematchIncoming && !ctrl.rematchSent && <div className="note">Your opponent wants a rematch (colours swap)</div>}
        {session && me && ctrl.rematchSent && <div className="note">Waiting for your opponent to accept…</div>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ "*" menu

function StarMenu({
  ctrl,
  onClose,
  onExit,
  onPlayAgain,
  onSettings,
  copy,
}: {
  ctrl: GameController
  onClose(): void
  onExit(): void
  onPlayAgain?(): void
  onSettings(): void
  copy(text: string, what: string): void
}) {
  const s = useSettings()
  const session = ctrl.online
  const me = ctrl.myColor
  const [confirm, setConfirm] = useState<null | 'forfeit' | 'restart'>(null)
  const over = ctrl.isOver
  const close = useCallback(() => onClose(), [onClose])
  const forfeitLabel = session ? 'Forfeit game' : `Forfeit game (${colorName(ctrl.game.player)})`
  return (
    <div className="panel star-menu" role="menu">
      <Check label="Enable sound" checked={s.sound} onChange={(v) => updateSettings({ sound: v })} />
      <Check label="Animations" checked={s.animations} onChange={(v) => updateSettings({ animations: v })} />
      {!session && <Check label="Auto perspective flip" checked={s.autoFlip} onChange={(v) => updateSettings({ autoFlip: v })} />}

      {confirm ? (
        <div className="confirm">
          <span>{confirm === 'forfeit' ? 'Forfeit this game?' : 'Start a new game?'}</span>
          <div className="row2">
            <button
              className="pill small"
              onClick={() => {
                if (confirm === 'forfeit') ctrl.resign()
                else onPlayAgain?.()
                setConfirm(null)
                close()
              }}
            >
              Yes
            </button>
            <button className="pill small" onClick={() => setConfirm(null)}>
              No
            </button>
          </div>
        </div>
      ) : (
        <>
          {(!session || me) && (
            <button className="pill" disabled={over} onClick={() => setConfirm('forfeit')}>
              {forfeitLabel}
            </button>
          )}
          {session && me && (
            <button
              className="pill"
              disabled={over || ctrl.drawOfferSent || !session.info.opponentJoined}
              onClick={() => {
                ctrl.offerDraw()
                close()
              }}
            >
              {ctrl.drawOfferIncoming ? 'Accept draw' : ctrl.drawOfferSent ? 'Draw offered' : 'Offer draw'}
            </button>
          )}
          {!session && onPlayAgain && (
            <button className="pill" onClick={() => (over ? onPlayAgain() : setConfirm('restart'))}>
              New game
            </button>
          )}
        </>
      )}
      {session && (
        <div className="row2">
          <button className="pill small" onClick={() => copy(session.info.code, 'Game code')}>
            Copy code
          </button>
          <button className="pill small" onClick={() => copy(online.shareUrl(session.info.code), 'Link')}>
            Copy link
          </button>
        </div>
      )}
      <button className="pill small" onClick={() => copy(ctrl.pgn(), '5D PGN')}>
        Export 5D PGN
      </button>
      <button className="pill small" onClick={onSettings}>
        Settings
      </button>
      <button className="pill small" onClick={onExit}>
        {session ? 'Leave to menu' : 'Main menu'}
      </button>
      <div className="hotkeys">
        Hotkeys:
        <br />
        Select/Drop: L/R mouse
        <br />
        Undo: Backspace or Z
        <br />
        Submit: Enter or F
        <br />
        Cycle boards: Tab
        <br />
        Move: WASD or arrows
        <br />
        Zoom: EQ or scroll
        <br />
        Views: TY
        <br />
        Flip Perspective: U
      </div>
      <div className="meta">
        {variantName(ctrl.variantId)}
        {session ? ` · Game ${session.info.code}` : ' · Local match'}
        {session && me ? ` · You play ${colorName(me)}` : ''}
      </div>
    </div>
  )
}
