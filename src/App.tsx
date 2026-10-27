// App shell: menu ↔ game routing and the online session lifecycle
// (create / join / ?join= links / refresh-resume / rematch).

import { useCallback, useEffect, useRef, useState } from 'react'
import { Game, VARIANTS } from './engine'
import type { Color } from './engine'
import { CLOCK_PRESETS, online } from './net'
import type { ClockPresetId, OnlineSession } from './net'
import { GameController } from './ui/controller'
import type { LocalSave } from './ui/controller'
import { GameScreen } from './ui/GameScreen'
import { Menu, WaitingRoom } from './ui/Menu'
import { RANDOM_VARIANT } from './ui/setup'
import type { MenuView } from './ui/Menu'
import type { CreateOpts } from './ui/setup'
import { Toasts } from './ui/components/common'
import { useToasts } from './ui/util'
import { sound } from './ui/sound'
import { KEYS, loadJson, removeKey, saveJson } from './ui/storage'
import './ui/ui.css'

type Screen =
  | { kind: 'menu'; view: MenuView }
  | { kind: 'connecting'; text: string }
  | { kind: 'waiting'; session: OnlineSession }
  | { kind: 'game'; ctrl: GameController; local?: { variantId: string; clock: ClockPresetId } }

function pickVariant(id: string): string {
  if (id !== RANDOM_VARIANT) return id
  const pool = VARIANTS.filter((v) => v.id !== 'misc_global_warming')
  return pool[Math.floor(Math.random() * pool.length)].id
}

function presetClock(id: ClockPresetId) {
  return CLOCK_PRESETS.find((p) => p.id === id)?.clock ?? null
}

function loadLocalSave(): LocalSave | null {
  const s = loadJson<LocalSave>(KEYS.localSave)
  if (!s || s.v !== 1 || s.result?.kind !== 'ongoing' || !VARIANTS.some((v) => v.id === s.variantId)) return null
  return s
}

let booted = false

export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'menu', view: { kind: 'main' } })
  const [toasts, toast] = useToasts()
  const [busy, setBusy] = useState(false)
  const [, setSaveRev] = useState(0)
  const sessionRef = useRef<OnlineSession | null>(null)
  const hasSave = loadLocalSave() !== null

  const toMenu = useCallback((view: MenuView = { kind: 'main' }) => {
    setScreen({ kind: 'menu', view })
    setSaveRev((n) => n + 1)
  }, [])

  // ------------------------------------------------------------ online

  const enterSession = useCallback((session: OnlineSession) => {
    sessionRef.current = session
    saveJson(KEYS.activeOnline, session.info.code)
    if (!session.info.opponentJoined && session.role !== 'spectator') {
      setScreen({ kind: 'waiting', session })
      return
    }
    try {
      const ctrl = new GameController({ kind: 'online', session }, session.info.variantId)
      setScreen({ kind: 'game', ctrl })
    } catch (e) {
      console.error(e)
      toast('This game could not be loaded', 'error')
      void session.leave()
      removeKey(KEYS.activeOnline)
      setScreen({ kind: 'menu', view: { kind: 'main' } })
    }
  }, [toast])

  const leaveSession = useCallback(async () => {
    const s = sessionRef.current
    sessionRef.current = null
    removeKey(KEYS.activeOnline)
    if (s) await s.leave().catch(() => {})
  }, [])

  const joinOnline = useCallback(
    async (code: string, opts: { resume?: boolean } = {}) => {
      const c = online.normalizeCode(code)
      if (!online.isValidCode(c)) {
        toast('That game code is not valid', 'error')
        return
      }
      setBusy(true)
      setScreen({ kind: 'connecting', text: opts.resume ? `Reconnecting to game ${c}…` : `Joining game ${c}…` })
      await leaveSession()
      try {
        const session = await online.joinGame(c)
        enterSession(session)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        if (/full/i.test(msg)) {
          // both seats taken: offer to watch instead
          try {
            const session = await online.spectateGame(c)
            toast('That game is full - you are watching it')
            enterSession(session)
            return
          } catch {
            /* fall through */
          }
        }
        if (opts.resume) removeKey(KEYS.activeOnline)
        toast(/not found/i.test(msg) ? `No game with code ${c}` : `Could not join: ${msg}`, 'error')
        setScreen({ kind: 'menu', view: { kind: 'versus', tab: 'join' } })
      } finally {
        setBusy(false)
      }
    },
    [enterSession, leaveSession, toast],
  )

  const createOnline = useCallback(
    async (o: CreateOpts) => {
      const variantId = pickVariant(o.variantId)
      const initial = Game.create(variantId, { skipMateDetection: true })
      const firstPlayer: Color = initial.player
      const firstActiveTimelines = initial.snapshot().timelines.filter((t) => t.active).length
      setBusy(true)
      setScreen({ kind: 'connecting', text: 'Creating game…' })
      await leaveSession()
      try {
        const session = await online.createGame({ variantId, color: o.color, clock: presetClock(o.clock), firstPlayer, firstActiveTimelines })
        enterSession(session)
      } catch (e) {
        toast(`Could not create the game: ${e instanceof Error ? e.message : String(e)}`, 'error')
        setScreen({ kind: 'menu', view: { kind: 'versus', tab: 'create' } })
      } finally {
        setBusy(false)
      }
    },
    [enterSession, leaveSession, toast],
  )

  const onRematch = useCallback(
    (code: string) => {
      void joinOnline(code)
    },
    [joinOnline],
  )

  // ------------------------------------------------------------ local

  const startLocal = useCallback((variantIdRaw: string, clock: ClockPresetId) => {
    const variantId = pickVariant(variantIdRaw)
    removeKey(KEYS.localSave)
    const ctrl = new GameController({ kind: 'local', clock: presetClock(clock) }, variantId)
    setScreen({ kind: 'game', ctrl, local: { variantId: variantIdRaw, clock } })
  }, [])

  const continueLocal = useCallback(() => {
    const save = loadLocalSave()
    if (!save) return
    try {
      const ctrl = new GameController({ kind: 'local', clock: save.clock }, save.variantId, save)
      const preset = CLOCK_PRESETS.find((p) => p.clock && save.clock && p.clock.initial === save.clock.initial)?.id ?? 'none'
      setScreen({ kind: 'game', ctrl, local: { variantId: save.variantId, clock: preset } })
    } catch (e) {
      console.error(e)
      removeKey(KEYS.localSave)
      toast('The saved game could not be loaded', 'error')
      setSaveRev((n) => n + 1)
    }
  }, [toast])

  // ------------------------------------------------------------ boot: ?join= link or refresh-resume

  useEffect(() => {
    if (booted) return
    booted = true
    const unlock = () => sound.unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    const code = online.parseJoinCode()
    if (code) {
      const url = new URL(location.href)
      url.searchParams.delete('join')
      history.replaceState(null, '', url.pathname + url.search + url.hash)
      setTimeout(() => void joinOnline(code), 0)
      return
    }
    const active = loadJson<string>(KEYS.activeOnline)
    if (active) setTimeout(() => void joinOnline(active, { resume: true }), 0)
  }, [joinOnline])

  // ------------------------------------------------------------ render

  if (screen.kind === 'game') {
    const ctrl = screen.ctrl
    const local = screen.local
    return (
      <>
        <GameScreenWithRematch
          key={idFor(ctrl)}
          ctrl={ctrl}
          onRematch={onRematch}
          onExit={() => {
            if (ctrl.online) void leaveSession()
            toMenu()
          }}
          onPlayAgain={local ? () => startLocal(local.variantId, local.clock) : undefined}
        />
        <Toasts toasts={toasts} />
      </>
    )
  }

  return (
    <>
      <Menu
        view={screen.kind === 'menu' ? screen.view : { kind: 'none' }}
        setView={(v) => setScreen({ kind: 'menu', view: v })}
        hasSave={hasSave}
        busy={busy}
        onContinue={continueLocal}
        onCreate={(o) => void createOnline(o)}
        onJoin={(c) => void joinOnline(c)}
        onLocal={startLocal}
      >
        {screen.kind === 'connecting' && (
          <div className="connecting">
            <div className="panel">
              <span className="waiting-dots">{screen.text.replace(/…$/, '')}</span>
            </div>
          </div>
        )}
        {screen.kind === 'waiting' && (
          <WaitingScreen
            session={screen.session}
            onToast={toast}
            onJoined={() => enterSession(screen.session)}
            onCancel={() => {
              const code = screen.session.info.code
              void leaveSession().then(() => online.forgetGame(code))
              toMenu({ kind: 'versus', tab: 'create' })
            }}
          />
        )}
      </Menu>
      <Toasts toasts={toasts} />
    </>
  )
}

const ids = new WeakMap<object, number>()
let nextId = 1
function idFor(o: object): number {
  let id = ids.get(o)
  if (!id) ids.set(o, (id = nextId++))
  return id
}

function GameScreenWithRematch({
  ctrl,
  onRematch,
  onExit,
  onPlayAgain,
}: {
  ctrl: GameController
  onRematch(code: string): void
  onExit(): void
  onPlayAgain?(): void
}) {
  useEffect(() => {
    ctrl.setRematchHandler(onRematch)
    return () => ctrl.setRematchHandler(null)
  }, [ctrl, onRematch])
  return <GameScreen ctrl={ctrl} onExit={onExit} onPlayAgain={onPlayAgain} />
}

function WaitingScreen({
  session,
  onJoined,
  onCancel,
  onToast,
}: {
  session: OnlineSession
  onJoined(): void
  onCancel(): void
  onToast(t: string, tone?: 'info' | 'error'): void
}) {
  useEffect(() => {
    if (session.info.opponentJoined) {
      // joined between enterSession() and this subscription
      const t = setTimeout(onJoined, 0)
      return () => clearTimeout(t)
    }
    return session.on((e) => {
      if (e.type === 'opponent-joined') {
        sound.play('notify')
        onJoined()
      } else if (e.type === 'error') onToast(e.message, 'error')
    })
  }, [session, onJoined, onToast])
  return <WaitingRoom session={session} onCancel={onCancel} onToast={onToast} />
}
