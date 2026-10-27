// Dev harness for the time-travel cinematic (served by Vite at /cinematic-demo.html).
// URL parameters: preset=owner|custom, variant, piece, color, history, depth, seed,
// flip=1, mode=2d|history|parallel, t=<seconds> (freeze at that time), auto=1 (play on
// load), shot=1 (hide the panel), owner=1 (match the owner's recording framing).
import { createRenderer } from '../../index'
import type { MultiverseRenderer, RenderModel } from '../../types'
import { VARIANTS, type Color, type PieceType } from '../../../engine'
import { computeLayout } from '../../layout'
import { loadPieceImages } from '../../pieces'
import { playTravelCinematic, type CinematicHandle } from '../index'
import { buildScenario, type Scenario } from './scenario'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T
const params = new URLSearchParams(location.search)
if (params.has('shot')) document.body.classList.add('shot')

const view = $('view')
const panel = $('panel')
const status = $('status')
const preset = $<HTMLSelectElement>('preset')
const variant = $<HTMLSelectElement>('variant')
const piece = $<HTMLSelectElement>('piece')
const color = $<HTMLSelectElement>('color')
const history = $<HTMLInputElement>('history')
const depth = $<HTMLInputElement>('depth')
const seed = $<HTMLInputElement>('seed')
const flip = $<HTMLInputElement>('flip')
const mode = $<HTMLSelectElement>('mode')
const speed = $<HTMLInputElement>('speed')

for (const v of VARIANTS) variant.add(new Option(v.name, v.id))
const setIf = (el: HTMLInputElement | HTMLSelectElement, k: string) => {
  const v = params.get(k)
  if (v != null) el.value = v
}
setIf(preset, 'preset')
setIf(variant, 'variant')
setIf(piece, 'piece')
setIf(color, 'color')
setIf(history, 'history')
setIf(depth, 'depth')
setIf(seed, 'seed')
setIf(mode, 'mode')
setIf(speed, 'speed')
if (params.get('flip') === '1') flip.checked = true

const OWNER_PGN = `[Board "Standard"]
[Mode "5D"]
1. d4 / b5
2. (0T2)Ng1>>(0T1)g3`

const renderer: MultiverseRenderer = createRenderer(view)
let scen: Scenario | null = null
let playing: CinematicHandle | null = null

function log(s: string) {
  status.textContent = s
}

function build(): Scenario | null {
  const persp: Color = flip.checked ? 'black' : 'white'
  const r = buildScenario({
    variant: variant.value,
    piece: piece.value as PieceType | 'any',
    color: color.value as Color,
    history: Number(history.value),
    depth: Number(depth.value),
    perspective: persp,
    seed: Number(seed.value),
    pgn: preset.value === 'owner' ? OWNER_PGN : undefined,
  })
  if (typeof r === 'string') {
    log(r)
    return null
  }
  scen = r
  const m: RenderModel = { ...r.before, viewMode: mode.value as RenderModel['viewMode'] }
  renderer.setModel(m)
  frame(r)
  log(`${r.label}  (${r.record.kind}, ${r.move.from.t - r.move.to.t} half-turns)`)
  return r
}

/** The owner's recording framing: the source board centred, 341 px squares at 1022 px height. */
function frame(r: Scenario) {
  const L = computeLayout({ ...r.before, viewFilter: 'all' })
  const p = L.boardsByKey.get(`${r.move.from.l}:${r.move.from.t}`)
  if (!p || !renderer.moveCamera) return
  const h = view.clientHeight
  renderer.moveCamera({ cx: p.x, cy: p.y, zoom: (341 / 1022 / 0.768) * h })
}

function play() {
  if (playing?.playing) playing.skip()
  const r = scen ?? build()
  if (!r) return
  const frozen = params.get('t')
  const sp = Number(speed.value) || 1
  let start = -1
  renderer.setInputEnabled?.(false)
  playing = playTravelCinematic(view, {
    before: { ...r.before, viewMode: mode.value as RenderModel['viewMode'] },
    after: r.after,
    move: r.move,
    toBoard: r.record.toBoard!,
    view: renderer.getView?.() ?? null,
    debugTime:
      frozen != null
        ? () => Number(frozen)
        : sp !== 1
          ? () => {
              const now = performance.now()
              if (start < 0) start = now
              return ((now - start) / 1000) * sp
            }
          : undefined,
    onHud: (a) => (panel.style.opacity = String(a)),
    onCue: (c) => log(`cue: ${c}`),
    onLand: (cam) => {
      // the overlay shows its own copy of the new board until it has dissolved
      renderer.setModel({ ...r.after, viewMode: mode.value as RenderModel['viewMode'], animations: false, hiddenBoards: [`${cam.l}:${cam.t}`] })
      renderer.moveCamera?.({ cx: cam.cx, cy: cam.cy, zoom: cam.zoom })
    },
    onOverlayEnd: (cam) => {
      renderer.setModel({ ...r.after, viewMode: mode.value as RenderModel['viewMode'], animations: false })
      renderer.moveCamera?.({ cx: cam.cx, cy: cam.cy, zoom: cam.zoomOut }, { durationMs: cam.zoomOutMs, ease: 'out-sine' })
      renderer.setInputEnabled?.(true)
      log(`done: ${r.label}`)
    },
  })
  ;(window as unknown as { __cinematic: CinematicHandle }).__cinematic = playing
}

$('build').onclick = () => build()
$('play').onclick = () => play()
void loadPieceImages().then(() => {
  build()
  if (params.has('auto') || params.has('t')) requestAnimationFrame(() => requestAnimationFrame(play))
})
