// Dev-only harness for the renderer (served by Vite at /render-demo.html).
import { createRenderer } from '../index'
import type { HighlightedSquare, MultiverseRenderer, RenderModel } from '../types'
import type { Board, Pos } from '../../engine/types'
import { fixtures, type Fixture } from './fixtures'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const view = $('view')
const logEl = $('log')
const sel = $<HTMLSelectElement>('fixture')
const flip = $<HTMLInputElement>('flip')
const filter = $<HTMLSelectElement>('filter')
const viewSel = $<HTMLSelectElement>('view')
const anim = $<HTMLInputElement>('anim')

const params = new URLSearchParams(location.search)
if (params.has('shot')) document.body.classList.add('shot')

const all: Fixture[] = fixtures()
for (const f of all) sel.add(new Option(f.name, f.id))

const renderer: MultiverseRenderer = createRenderer(view)
let base: RenderModel = all[0].model
let selected: Pos | null = null
let hover: Pos | null = null

function log(msg: string) {
  logEl.textContent = (msg + '\n' + (logEl.textContent ?? '')).slice(0, 4000)
}

function model(): RenderModel {
  const extra: HighlightedSquare[] = []
  if (selected) extra.push({ pos: selected, kind: 'selected' })
  if (hover) extra.push({ pos: hover, kind: 'hover' })
  return {
    ...base,
    perspective: flip.checked ? 'black' : 'white',
    viewFilter: filter.value as RenderModel['viewFilter'],
    viewMode: viewSel.value as RenderModel['viewMode'],
    animations: anim.checked,
    highlights: [...base.highlights, ...extra],
  }
}

const update = () => renderer.setModel(model())

function setFixture(id: string, focus = true) {
  const f = all.find((x) => x.id === id) ?? all[0]
  sel.value = f.id
  base = f.model
  selected = null
  update()
  if (focus) renderer.focusPresent()
}

renderer.setEvents({
  onSquareClick(pos) {
    log(`click (${pos.l}T${pos.t}) ${String.fromCharCode(97 + pos.x)}${pos.y + 1}`)
    selected = pos
    update()
  },
  onSquareHover(pos) {
    hover = pos
    update()
  },
  onBackgroundClick() {
    log('background click')
    selected = null
    update()
  },
})

sel.onchange = () => setFixture(sel.value)
flip.onchange = filter.onchange = viewSel.onchange = anim.onchange = update
$('present').onclick = () => renderer.focusPresent()
$('advance').onclick = () => {
  // append a board to the active timeline with the earliest end (visual only)
  const snap = base.snapshot
  const active = snap.timelines.filter((t) => t.active)
  const tl = active.reduce((a, b) => (a.startT + a.boards.length <= b.startT + b.boards.length ? a : b))
  const last = tl.boards[tl.boards.length - 1]
  const t = last.t + 1
  const squares = last.squares.slice()
  const own = squares.map((p, i) => (p && (p.color === (last.t % 2 === 0 ? 'white' : 'black')) ? i : -1)).filter((i) => i >= 0)
  const empty = squares.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0)
  const from = own[Math.floor(Math.random() * own.length)]
  const to = empty[Math.floor(Math.random() * empty.length)]
  squares[to] = squares[from]
  squares[from] = null
  const nb: Board = { ...last, t, squares }
  const timelines = snap.timelines.map((x) => (x === tl ? { ...x, boards: [...x.boards, nb] } : x))
  const ends = timelines.filter((x) => x.active).map((x) => x.startT + x.boards.length - 1)
  const present = Math.min(...ends)
  base = {
    ...base,
    snapshot: { ...snap, timelines, present, player: present % 2 === 0 ? 'white' : 'black' },
    highlights: [
      ...base.highlights,
      { pos: { l: tl.l, t, x: from % 8, y: Math.floor(from / 8) }, kind: 'moved' },
      { pos: { l: tl.l, t, x: to % 8, y: Math.floor(to / 8) }, kind: 'moved' },
    ],
    pendingBoards: [...base.pendingBoards, `${tl.l}:${t}`],
  }
  update()
}

// hooks for automated screenshots
declare global {
  interface Window {
    __demo: {
      setFixture(id: string, opts?: { flip?: boolean; filter?: string; view?: string; anim?: boolean }): void
      renderer: MultiverseRenderer
      focusBoard(l: number, t: number): void
    }
  }
}
window.__demo = {
  setFixture(id, opts = {}) {
    flip.checked = !!opts.flip
    filter.value = opts.filter ?? 'all'
    viewSel.value = opts.view ?? '2d'
    anim.checked = opts.anim ?? true
    setFixture(id)
  },
  renderer,
  focusBoard: (l, t) => renderer.focusBoard(l, t),
}

setFixture(params.get('fixture') ?? 'branch')
