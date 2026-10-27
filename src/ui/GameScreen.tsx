// In-game screen: the renderer fills the window, with the original's HUD on top:
// top-centre pills, right-edge tabs, bottom-left status,
// clocks top-left, the "*" menu and the end-of-game card.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createRenderer } from '../render'
import type { HudLayout, MultiverseRenderer } from '../render'
import type { Color } from '../engine'
import type { GameController } from './controller'
import { formatClock } from './clock'
import type { ClockView } from './clock'
import { Check, PieceGlyph, Toasts } from './components/common'
import { copyText, useToasts } from './util'
import { SettingsPanel } from './components/SettingsPanel'
import { colorName, gameEndedLine, resultText, variantName, youLine } from './format'
import { online } from '../net'
import { getSettings, updateSettings, useSettings } from './settings'
import { sound } from './sound'

interface Props {
  ctrl: GameController
  onExit(): void
  onPlayAgain?(): void
}

const PAN_SPEED = 900 // CSS px per second
const ZOOM_SPEED = 1.9 // factor per second

/** history.state marker of the entry pushed when a game screen opens (Back is intercepted). */
const GAME_STATE_KEY = '5dchessGame'
let mountedGames = 0

const inGameEntry = (state: unknown): boolean =>
  !!state && typeof state === 'object' && (state as Record<string, unknown>)[GAME_STATE_KEY] === true

/** Screen areas covered by the HUD, relative to the game view. */
function measureHud(view: HTMLElement, hud: HTMLElement): HudLayout {
  const base = view.getBoundingClientRect()
  const rect = (sel: string) => {
    const el = hud.querySelector<HTMLElement>(sel)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return r.width > 0 && r.height > 0 ? r : null
  }
  const pills = rect('.top-pills')
  const clock = rect('.clock-panel')
  const status = rect('.status')
  // the right-edge column: its widest tab (the container itself spans the full height)
  let tabsLeft = base.right
  for (const el of hud.querySelectorAll<HTMLElement>('.side-tabs > *')) {
    const r = el.getBoundingClientRect()
    if (r.width > 0) tabsLeft = Math.min(tabsLeft, r.left)
  }
  const gap = 6
  const top = Math.max(pills ? pills.bottom - base.top + gap : 0, clock ? clock.bottom - base.top + gap : 0)
  const bottom = status ? base.bottom - status.top + gap : 0
  const right = base.right - tabsLeft + gap
  const avoid = status ? [{ x: status.left - base.left, y: status.top - base.top, w: status.width, h: status.height }] : []
  return { insets: { top, right, bottom, left: 0 }, avoid }
}

export function GameScreen({ ctrl, onExit, onPlayAgain }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<MultiverseRenderer | null>(null)
  useSyncExternalStore(ctrl.subscribe, ctrl.getRev)
  const settings = useSettings()
  const [toasts, toast] = useToasts()
  const hudRef = useRef<HTMLDivElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [leaveAsk, setLeaveAsk] = useState(false)
  const hudKey = useRef('')

  /** Tell the renderer where the HUD is (framing margins, label exclusions). */
  const syncHud = useCallback(() => {
    const r = rendererRef.current
    const view = hostRef.current
    const hud = hudRef.current
    if (!r?.setHud || !view || !hud) return
    const layout = measureHud(view, hud)
    const key = JSON.stringify(layout)
    if (key === hudKey.current) return
    hudKey.current = key
    r.setHud(layout)
  }, [])

  // renderer + controller wiring
  useEffect(() => {
    const host = hostRef.current!
    const r = createRenderer(host)
    rendererRef.current = r
    hudKey.current = ''
    syncHud() // before the first framing
    ctrl.setNoticeHandler(toast)
    // the time-travel cinematic fades the HUD out and back in
    ctrl.setHudHandler((a) => {
      const hud = hudRef.current
      if (!hud) return
      hud.style.opacity = a >= 1 ? '' : String(a)
      hud.style.pointerEvents = a >= 1 ? '' : 'none'
    })
    ctrl.attach(r, host)
    // test hook (dev server, or ?debug on a deployed build)
    if (import.meta.env.DEV || new URLSearchParams(location.search).has('debug')) (window as unknown as { __5d?: unknown }).__5d = { ctrl, renderer: r }
    const onContext = (e: MouseEvent) => {
      e.preventDefault()
      ctrl.deselect() // "Select/Drop: L/R mouse"
    }
    host.addEventListener('contextmenu', onContext)
    const onHide = () => ctrl.saveNow()
    window.addEventListener('pagehide', onHide)
    const onResize = () => syncHud()
    window.addEventListener('resize', onResize)
    return () => {
      host.removeEventListener('contextmenu', onContext)
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('resize', onResize)
      ctrl.setNoticeHandler(null)
      ctrl.setHudHandler(null)
      ctrl.detach()
      r.dispose()
      rendererRef.current = null
    }
  }, [ctrl, toast, syncHud])

  // the HUD's size and text change with the game state: keep the renderer informed
  useLayoutEffect(() => {
    syncHud()
  })

  // Browser Back leaves the page: keep an extra history entry while in a game and ask first.
  useEffect(() => {
    mountedGames++
    if (!inGameEntry(history.state)) history.pushState({ ...(history.state ?? {}), [GAME_STATE_KEY]: true }, '')
    const onPop = (e: PopStateEvent) => {
      if (inGameEntry(e.state)) return // e.g. Forward back onto our entry
      // re-arm the guard so a second Back is caught too, then ask
      history.pushState({ ...(e.state ?? {}), [GAME_STATE_KEY]: true }, '')
      setMenuOpen(false)
      setLeaveAsk(true)
    }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      mountedGames--
      // Left the game another way (menu button, rematch hand-over...): drop our entry
      // unless another game screen took over in the same update.
      setTimeout(() => {
        if (mountedGames === 0 && inGameEntry(history.state)) history.back()
      }, 0)
    }
  }, [])

  useEffect(() => {
    ctrl.settingsChanged()
  }, [ctrl, settings])

  /** "Leave game": online asks first (the seat is kept, no resignation); local saves and leaves. */
  const requestLeave = useCallback(() => {
    setMenuOpen(false)
    if (ctrl.online && !ctrl.isOver && !ctrl.historyError) {
      setLeaveAsk(true)
      return
    }
    ctrl.saveNow()
    onExit()
  }, [ctrl, onExit])

  // hotkeys (the original's list from the "*" menu, plus Ctrl/Cmd+Z, Enter and Esc)
  const modalOpen = menuOpen || settingsOpen || leaveAsk
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
      const k = e.key.toLowerCase()
      // Esc works even while a control (e.g. a checkbox in the "*" menu) has focus
      if (k === 'escape') {
        if (leaveAsk) setLeaveAsk(false)
        else if (menuOpen) {
          setMenuOpen(false)
          if (t && t !== document.body && t.closest('.star-menu')) t.blur()
        } else if (settingsOpen) return
        else if (ctrl.historyError && !ctrl.isOver) return
        else if (ctrl.isOver && !ctrl.overlayDismissed) ctrl.dismissOverlay()
        else if (ctrl.selected) ctrl.deselect()
        else setMenuOpen(true) // nothing to cancel: Esc opens the "*" menu (and with it "Leave game")
        return
      }
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
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
        case 'i':
          // the original's hidden hotkey for the time-travel animation button
          updateSettings({ travelAnimation: !getSettings().travelAnimation })
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
  }, [ctrl, menuOpen, settingsOpen, modalOpen, leaveAsk])

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
  const historyError = ctrl.historyError
  if (historyError && !over) {
    line1 = ''
    line2 = 'Game stopped - invalid history'
  }

  const showOverlay = over && !ctrl.overlayDismissed

  return (
    <div className="game">
      <div className="game-view" ref={hostRef} />
      <div className="hud" ref={hudRef}>
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
        <div className={`side-tabs ${ctrl.perspective === 'black' ? 'persp-black' : ''}`}>
          <button
            className={`tab tab-star ${menuOpen ? 'active' : ''}`}
            aria-label="Game menu"
            aria-expanded={menuOpen}
            onClick={(e) => {
              setMenuOpen((v) => !v)
              // mouse/touch: don't leave the button focused (no ring after the menu closes)
              if (e.detail > 0) e.currentTarget.blur()
            }}
          >
            <span>*</span>
          </button>
          <button
            className={`tab tab-round tab-anim ${settings.travelAnimation ? 'on' : ''}`}
            aria-pressed={settings.travelAnimation}
            aria-label="Time-travel animation"
            title={settings.travelAnimation ? 'Time-travel animation: plays on your next time travel (I)' : 'Time-travel animation: off (I)'}
            onClick={() => updateSettings({ travelAnimation: !settings.travelAnimation })}
          >
            <span className="checker" />
          </button>
          <button
            className={`tab tab-vert ${ctrl.viewMode === 'history' ? 'active' : ''}`}
            aria-pressed={ctrl.viewMode === 'history'}
            title="History View (T)"
            onClick={() => ctrl.toggleView('history')}
          >
            History View
          </button>
          <button
            className={`tab tab-vert ${ctrl.viewMode === 'parallel' ? 'active' : ''}`}
            aria-pressed={ctrl.viewMode === 'parallel'}
            title="Parallel View (Y)"
            onClick={() => ctrl.toggleView('parallel')}
          >
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

        {over && ctrl.overlayDismissed && ctrl.rematchIncoming && !ctrl.rematchSent && !ctrl.rematchCode && (
          <div className="banner panel">
            <span>Your opponent wants a rematch</span>
            <button className="pill small" onClick={() => ctrl.offerRematch()}>
              Accept
            </button>
          </div>
        )}

        {over && ctrl.overlayDismissed && !!me && !!ctrl.rematchCode && (
          <div className="banner panel">
            <span>A rematch is ready</span>
            <button className="pill small blue" onClick={() => ctrl.joinRematch()}>
              Go to rematch
            </button>
          </div>
        )}

        {historyError && !over && (
          <div className="overlay-wrap">
            <div className="panel game-over" role="alertdialog" aria-label="Game history error">
              <h2 className="smaller">This game can't continue</h2>
              <div className="detail">
                The game history contains an invalid move from {colorName(historyError.player)}; the game can't continue. The boards show
                the position before that move.
              </div>
              <div className="buttons">
                <button className="pill" onClick={onExit}>
                  {session ? 'Leave to menu' : 'Main menu'}
                </button>
                <button className="pill small" onClick={() => void copy(ctrl.pgn(), '5D PGN')}>
                  Export 5D PGN
                </button>
              </div>
            </div>
          </div>
        )}

        {leaveAsk && (
          <div className="overlay-wrap" onPointerDown={(e) => e.target === e.currentTarget && setLeaveAsk(false)}>
            <div className="panel game-over leave-ask" role="alertdialog" aria-label="Leave the game?">
              <h2 className="smaller">Leave the game?</h2>
              <div className="detail">{session ? 'You can rejoin from the menu.' : 'You can continue it from the menu.'}</div>
              <div className="buttons">
                <button
                  className="pill"
                  onClick={() => {
                    setLeaveAsk(false)
                    onExit()
                  }}
                >
                  Leave
                </button>
                <button className="pill" autoFocus onClick={() => setLeaveAsk(false)}>
                  Stay
                </button>
              </div>
            </div>
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
              onLeave={requestLeave}
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
    // style writes only when something changed (no per-frame style invalidation)
    const last = new WeakMap<HTMLElement, string>()
    const place = (el: HTMLElement | null, x: number, y: number, w: number, h: number, extra?: () => void) => {
      if (!el) return
      const k = `${Math.round(x - w / 2)},${Math.round(y - h / 2)},${Math.round(w)},${Math.round(h)}`
      if (last.get(el) === k) return
      last.set(el, k)
      el.style.display = ''
      el.style.transform = `translate(${Math.round(x - w / 2)}px, ${Math.round(y - h / 2)}px)`
      el.style.width = `${Math.round(w)}px`
      el.style.height = `${Math.round(h)}px`
      extra?.()
    }
    const hide = (el: HTMLElement | null) => {
      if (!el || last.get(el) === 'hidden') return
      last.set(el, 'hidden')
      el.style.display = 'none'
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
        place(el, br.maxX + out, br.minY - out, s, s, () => {
          if (el) el.style.fontSize = `${Math.round(s * 0.72)}px`
        })
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
        className={`float-btn ${reach.time ? 'go' : ''} ${ctrl.viewMode === 'history' ? 'active' : ''}`}
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
        className={`float-btn ${reach.timelines ? 'go' : ''} ${ctrl.viewMode === 'parallel' ? 'active' : ''}`}
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
      // re-render only when what is shown changes (not every tenth of a second)
      const low = (ms: number) => ms < 30000
      const text = v ? `${formatClock(v.white)}|${formatClock(v.black)}|${v.running}|${v.flagged}|${Math.ceil(v.delay / 1000)}|${low(v.white)}|${low(v.black)}` : ''
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
  const row = (c: Color) => {
    const running = view.running === c
    const ms = c === 'white' ? view.white : view.black
    // only the side to move shows its remaining delay
    const suffix = running && view.delay > 0 ? `+${Math.ceil(view.delay / 1000)}` : ''
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
          {session && me && ctrl.rematchCode ? (
            <button className="pill blue" onClick={() => ctrl.joinRematch()}>
              Go to rematch
            </button>
          ) : session && me ? (
            <button className={`pill ${ctrl.rematchIncoming ? 'blue' : ''}`} disabled={ctrl.rematchSent} onClick={() => ctrl.offerRematch()}>
              {ctrl.rematchSent ? 'Rematch offered…' : ctrl.rematchIncoming ? 'Accept rematch' : 'Rematch'}
            </button>
          ) : null}
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
        {session && me && !ctrl.rematchCode && ctrl.rematchIncoming && !ctrl.rematchSent && <div className="note">Your opponent wants a rematch (colours swap)</div>}
        {session && me && !ctrl.rematchCode && ctrl.rematchSent && <div className="note">Waiting for your opponent to accept…</div>}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ "*" menu

function StarMenu({
  ctrl,
  onClose,
  onLeave,
  onPlayAgain,
  onSettings,
  copy,
}: {
  ctrl: GameController
  onClose(): void
  onLeave(): void
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
      <button className="pill dark leave-pill" onClick={onLeave}>
        {session ? 'Leave game' : 'Main menu'}
      </button>
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
              disabled={over || (ctrl.drawOfferSent && !ctrl.drawOfferIncoming) || !session.info.opponentJoined || !!ctrl.historyError}
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
