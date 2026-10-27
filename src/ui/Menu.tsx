// Menus in the original's style (docs/ui-spec.md §2): title and pill stack over
// the blue time-tunnel backdrop; "Versus"-style panels with tab pills.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Game, VARIANTS } from '../engine'
import type { Color, VariantInfo } from '../engine'
import { CLOCK_PRESETS, online } from '../net'
import type { ClockPresetId, OnlineSession, RecentGame } from '../net'
import { PieceGlyph, Radio } from './components/common'
import { copyText } from './util'
import { RANDOM_VARIANT, useSetup } from './setup'
import type { CreateOpts } from './setup'
import { Guide } from './components/Guide'
import { SettingsPanel } from './components/SettingsPanel'
import { Vortex } from './components/Vortex'
import { colorName, timeAgo, variantName } from './format'

export type VersusTab = 'create' | 'join' | 'local'
export type MenuView = { kind: 'main' } | { kind: 'versus'; tab: VersusTab } | { kind: 'guide' } | { kind: 'none' }

// ------------------------------------------------------------------ menu shell

interface MenuProps {
  view: MenuView
  setView(v: MenuView): void
  hasSave: boolean
  busy: boolean
  onContinue(): void
  onCreate(o: CreateOpts): void
  onJoin(code: string): void
  onLocal(variantId: string, clock: ClockPresetId): void
  children?: ReactNode
}

export function Menu({ view, setView, hasSave, busy, onContinue, onCreate, onJoin, onLocal, children }: MenuProps) {
  const [settingsOpen, setSettingsOpen] = useState(false)
  return (
    <div className="menu">
      <Vortex />
      {view.kind === 'main' && (
        <>
          <MenuArrow />
          <div className="home">
          <h1 className="title">
            <span className="big">5D Chess</span>
            <span className="sub">With Multiverse Time Travel</span>
          </h1>
          <nav className="main-buttons">
            {hasSave && (
              <button className="pill" onClick={onContinue}>
                Continue
              </button>
            )}
            <button className="pill" onClick={() => setView({ kind: 'versus', tab: 'create' })}>
              Online
            </button>
            <button className="pill" onClick={() => setView({ kind: 'versus', tab: 'local' })}>
              Local Match
            </button>
            <button className="pill" onClick={() => setView({ kind: 'guide' })}>
              Guide
            </button>
            <button className="pill" onClick={() => setSettingsOpen(true)}>
              Settings
            </button>
          </nav>
          </div>
        </>
      )}
      {view.kind === 'versus' && (
        <VersusScreen
          tab={view.tab}
          setTab={(tab) => setView({ kind: 'versus', tab })}
          onClose={() => setView({ kind: 'main' })}
          busy={busy}
          onCreate={onCreate}
          onJoin={onJoin}
          onLocal={onLocal}
          hasSave={hasSave}
          onContinue={onContinue}
        />
      )}
      {view.kind === 'guide' && (
        <div className="screen">
          <div className="screen-head">
            <h2 className="screen-title">Guide</h2>
            <button className="x-btn" onClick={() => setView({ kind: 'main' })} aria-label="Close">
              X
            </button>
          </div>
          <Guide />
        </div>
      )}
      {children}
      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  )
}

/** The big translucent purple arrow behind the main buttons (logo motif). */
function MenuArrow() {
  return (
    <svg className="menu-arrow" viewBox="0 0 100 360" aria-hidden="true">
      <path d="M23 -2 H77 V290 H99 L50 359 L1 290 H23 Z" fill="#9972a9" stroke="#845d9c" strokeWidth="1.2" />
    </svg>
  )
}

// ------------------------------------------------------------------ versus

const TAB_TITLES: Record<VersusTab, string> = {
  create: 'Online - Create Game',
  join: 'Online - Join Game',
  local: 'Versus - Local Match',
}

function VersusScreen({
  tab,
  setTab,
  onClose,
  busy,
  onCreate,
  onJoin,
  onLocal,
  hasSave,
  onContinue,
}: {
  tab: VersusTab
  setTab(t: VersusTab): void
  onClose(): void
  busy: boolean
  onCreate(o: CreateOpts): void
  onJoin(code: string): void
  onLocal(variantId: string, clock: ClockPresetId): void
  hasSave: boolean
  onContinue(): void
}) {
  const [setup, update] = useSetup()
  return (
    <div className="screen">
      <div className="screen-head">
        <h2 className="screen-title">{TAB_TITLES[tab]}</h2>
        <button className="x-btn" onClick={onClose} aria-label="Close">
          X
        </button>
      </div>
      <div className="tabs" role="tablist">
        {(['create', 'join', 'local'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`pill ${tab === t ? 'selected' : ''}`} onClick={() => setTab(t)}>
            {t === 'create' ? 'Create Game' : t === 'join' ? 'Join Game' : 'Local Match'}
          </button>
        ))}
      </div>
      {tab === 'create' && (
        <div className="panel screen-panel">
          <div className="field-label">Select color:</div>
          <div className="radios">
            {(['random', 'white', 'black'] as const).map((c) => (
              <Radio key={c} name="color" value={c} current={setup.color} label={c === 'random' ? 'Random' : colorName(c)} onChange={(v) => update({ color: v })} />
            ))}
          </div>
          <div className="field-label">Select time control:</div>
          <div className="radios">
            {CLOCK_PRESETS.map((p) => (
              <Radio key={p.id} name="clock" value={p.id} current={setup.clock} label={p.label} onChange={(v) => update({ clock: v })} />
            ))}
          </div>
          <div className="field-label">Select variant:</div>
          <VariantPicker value={setup.variantId} onChange={(v) => update({ variantId: v })} onActivate={() => !busy && onCreate(setup)} />
          <div className="panel-actions">
            <button className="pill" disabled={busy} onClick={() => onCreate(setup)}>
              Create Game
            </button>
          </div>
        </div>
      )}
      {tab === 'join' && <JoinPanel busy={busy} onJoin={onJoin} />}
      {tab === 'local' && (
        <div className="panel screen-panel">
          <div className="field-label">Select time control:</div>
          <div className="radios">
            {CLOCK_PRESETS.map((p) => (
              <Radio key={p.id} name="lclock" value={p.id} current={setup.localClock} label={p.shortLabel} onChange={(v) => update({ localClock: v })} />
            ))}
          </div>
          <div className="field-label">Select variant:</div>
          <VariantPicker value={setup.variantId} onChange={(v) => update({ variantId: v })} onActivate={() => onLocal(setup.variantId, setup.localClock)} />
          <div className="panel-actions">
            {hasSave && (
              <button className="pill" onClick={onContinue}>
                Continue
              </button>
            )}
            <button className="pill" onClick={() => onLocal(setup.variantId, setup.localClock)}>
              Play
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ variants

const CATEGORY_ORDER = ['Standard', 'Simple', 'Small', 'Very Small', 'Misc', 'Focused', 'Checkmate Practice']

function groupedVariants(): { category: string; variants: VariantInfo[] }[] {
  const cats = [...CATEGORY_ORDER, ...VARIANTS.map((v) => v.category).filter((c) => !CATEGORY_ORDER.includes(c))]
  const out: { category: string; variants: VariantInfo[] }[] = []
  for (const c of [...new Set(cats)]) {
    const vs = VARIANTS.filter((v) => v.category === c)
    if (vs.length) out.push({ category: c, variants: vs })
  }
  return out
}

export function VariantPicker({ value, onChange, onActivate }: { value: string; onChange(id: string): void; onActivate?(): void }) {
  const groups = useMemo(() => groupedVariants(), [])
  const listRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>('.variant-row.selected')
    el?.scrollIntoView({ block: 'nearest' })
  }, [value])
  const info = VARIANTS.find((v) => v.id === value)
  return (
    <>
      <div className="variant-list" ref={listRef} role="listbox" aria-label="Variants">
        <button
          role="option"
          aria-selected={value === RANDOM_VARIANT}
          className={`variant-row ${value === RANDOM_VARIANT ? 'selected' : ''}`}
          onClick={() => onChange(RANDOM_VARIANT)}
          onDoubleClick={onActivate}
        >
          Random
        </button>
        {groups.map((g) => (
          <div key={g.category} role="group" aria-label={g.category}>
            <div className="group">{g.category}</div>
            {g.variants.map((v) => (
              <button
                key={v.id}
                role="option"
                aria-selected={value === v.id}
                className={`variant-row ${value === v.id ? 'selected' : ''}`}
                onClick={() => onChange(v.id)}
                onDoubleClick={onActivate}
              >
                {v.name}
              </button>
            ))}
          </div>
        ))}
      </div>
      <div className="variant-info">
        {info ? <MiniBoards variantId={info.id} /> : null}
        <p>
          <span className="name">{info ? info.name : 'Random'}</span>
          <br />
          {info ? info.description : 'A variant chosen at random from the list.'}
        </p>
      </div>
    </>
  )
}

const previewCache = new Map<string, { w: number; h: number; boards: { white: boolean; squares: ({ type: string; color: Color } | null)[] }[] }>()

function preview(variantId: string) {
  let p = previewCache.get(variantId)
  if (!p) {
    const snap = Game.create(variantId, { skipMateDetection: true }).snapshot()
    const boards = snap.timelines.slice(0, 3).map((tl) => {
      const b = tl.boards[tl.boards.length - 1]
      return { white: b.t % 2 === 0, squares: b.squares.map((s) => (s ? { type: s.type, color: s.color } : null)) }
    })
    p = { w: snap.width, h: snap.height, boards }
    previewCache.set(variantId, p)
  }
  return p
}

function MiniBoards({ variantId }: { variantId: string }) {
  const p = preview(variantId)
  return (
    <div className="mini-boards" aria-hidden="true">
      {p.boards.map((b, i) => (
        <div key={i} className={`mini-board ${b.white ? '' : 'black'}`} style={{ gridTemplateColumns: `repeat(${p.w}, 1fr)`, gridTemplateRows: `repeat(${p.h}, 1fr)` }}>
          {Array.from({ length: p.w * p.h }, (_, k) => {
            const x = k % p.w
            const y = p.h - 1 - Math.floor(k / p.w)
            const sq = b.squares[y * p.w + x]
            return (
              <div key={k} className={(x + y) % 2 === 0 ? 'd' : ''}>
                {sq && <PieceGlyph type={sq.type as never} color={sq.color} />}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ join

function JoinPanel({ busy, onJoin }: { busy: boolean; onJoin(code: string): void }) {
  const [code, setCode] = useState('')
  const [recent, setRecent] = useState<RecentGame[]>(() => online.recentGames())
  const [focused, setFocused] = useState(false)
  const valid = online.isValidCode(code)
  const onInput = (raw: string) => {
    const fromLink = /join=/i.test(raw) ? online.parseJoinCode(raw) : null
    const c = (fromLink ?? online.normalizeCode(raw)).replace(/[^A-Z0-9]/g, '').slice(0, 6)
    setCode(c)
  }
  return (
    <div className="panel screen-panel scroll">
      <div className="field-label">Enter the game code (or paste the link):</div>
      <div style={{ position: 'relative' }}>
        <div className="code-input" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className={`code-slot ${focused && i === Math.min(code.length, 5) ? 'cursor' : ''}`}>
              {code[i] ?? ''}
            </div>
          ))}
        </div>
        <input
          aria-label="Game code"
          value={code}
          autoFocus
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => onInput(e.target.value)}
          onPaste={(e) => {
            e.preventDefault()
            onInput(e.clipboardData.getData('text'))
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && valid && !busy) onJoin(code)
          }}
          style={{ position: 'absolute', inset: 0, opacity: 0, width: '100%', height: '100%', cursor: 'text', fontSize: 16 }}
        />
      </div>
      {code.length === 6 && !valid && <div className="error-text">That isn't a valid code (codes use A-Z without I and O, and 2-9).</div>}
      <div className="panel-actions">
        <button className="pill" disabled={!valid || busy} onClick={() => onJoin(code)}>
          Join Game
        </button>
      </div>
      {recent.length > 0 && (
        <>
          <div className="field-label">Rejoin a game:</div>
          <div className="recent">
            {recent.map((g) => (
              <div key={g.code} className="recent-row">
                <span className="code">{g.code}</span>
                <span className="what">
                  {variantName(g.variantId)} · {g.color === 'spectator' ? 'spectating' : `as ${colorName(g.color)}`} · {g.finished ? 'finished' : timeAgo(g.lastSeen)}
                </span>
                <button className="pill" disabled={busy} onClick={() => onJoin(g.code)}>
                  {g.finished ? 'View' : 'Rejoin'}
                </button>
                <button
                  className="forget"
                  aria-label={`Forget game ${g.code}`}
                  title="Remove from this list"
                  onClick={() => {
                    online.forgetGame(g.code)
                    setRecent(online.recentGames())
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ waiting room

export function WaitingRoom({ session, onCancel, onToast }: { session: OnlineSession; onCancel(): void; onToast(t: string): void }) {
  const info = session.info
  const url = online.shareUrl(info.code)
  const clock = CLOCK_PRESETS.find((p) => p.clock && info.clock && p.clock.initial === info.clock.initial && p.clock.delayPerTimeline === info.clock.delayPerTimeline)
  const copy = async (text: string, what: string) => onToast((await copyText(text)) ? `${what} copied` : `Could not copy`)
  return (
    <div className="screen">
      <div className="screen-head">
        <h2 className="screen-title">Online - Waiting for opponent</h2>
        <button className="x-btn" onClick={onCancel} aria-label="Cancel game">
          X
        </button>
      </div>
      <div className="panel screen-panel" style={{ marginTop: '0.4em', textAlign: 'center', alignItems: 'center' }}>
        <div>Share this code with your opponent:</div>
        <div className="big-code" aria-label={`Game code ${info.code.split('').join(' ')}`}>
          {info.code}
        </div>
        <div className="panel-actions" style={{ marginTop: 0 }}>
          <button className="pill" onClick={() => copy(info.code, 'Code')}>
            Copy code
          </button>
          <button className="pill" onClick={() => copy(url, 'Link')}>
            Copy link
          </button>
        </div>
        <div className="share-url">{url}</div>
        <div style={{ marginTop: '0.6em' }}>
          {variantName(info.variantId)} · You play {colorName(info.myColor)} · {info.clock ? (clock?.label ?? 'Timed') : 'No clock'}
        </div>
        <div className="hint">
          <span className="waiting-dots">The game starts as soon as they join</span>
        </div>
        <div className="panel-actions">
          <button className="pill" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
