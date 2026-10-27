// The time-travel cinematic, as in the original:
// a self-contained overlay (2D floor canvas + transparent Three.js canvas) placed over the
// game view. Presentation only: the move is already applied; this just plays and goes.
//
// Beats (seconds from the move; see ./timing.ts for every measured constant):
//  0.00-0.27  HUD fades out; the camera starts its orbit from the current 2D framing.
//  0.04-1.50  Orthographic orbit (elevation and azimuth lerped together, easeInOutSine):
//             the boards of the trip stand up as camera-facing cards and fold into a
//             diagonal stack while the floor cross-fades into the blue vortex (0.53-1.16).
//  1.50       Cut to the flight layout (front card centred); it rests until 1.74.
//  1.74-      Perspective flight back through the boards, one per second; each passing
//             board fades as it nears the camera. The travelling piece leaves the
//             source board, rides at the landing depth, moving in a straight line to its
//             destination square, and casts its shadow on the board behind it.
//  land       The destination board stops at 77 % of the view height; the piece lands;
//             the HUD fades back in and the vortex dissolves into the game, which shows
//             the new board at the same size, then zooms out.

import * as THREE from 'three'
import type { Color, Pos } from '../../engine/types'
import type { HighlightedSquare, RenderModel, ViewState } from '../types'
import { computeLayout, squareOffset, type BoardPlacement, type Layout } from '../layout'
import { drawBoard, type PieceOverride } from '../boardTexture'
import { BOARD_INNER, CORNER_THICK, CORNER_THIN } from '../constants'
import { loadPieceImages, pieceSprite } from '../pieces'
import { CARD_LIGHT, FloorPainter, type Affine, type CardShadow } from './floor'
import { travelPath, type TravelPath } from './path'
import { createVortex } from './vortex'
import {
  DEPTH_LAND,
  DEPTH_START,
  FLIGHT_K,
  FLIGHT_START,
  FLOOR_FADE,
  RINGS_PER_SPACING,
  STACK_CUT,
  STACK_ZOOM,
  ZOOM_OUT_SECONDS,
  boardAlpha,
  endFadeCurve,
  flightDistance,
  hudOpacity,
  orbitProgress,
  schedule,
  smoothstep,
  type Schedule,
} from './timing'

/** Height of the standing cards above the floor at the end of the orbit (world units), fitted to the footage. */
export const CARD_LIFT = 0.5
/** Boards lie this high in the 2D view (renderer views.ts BOARD_Z_2D). */
const BOARD_Z = 0.1
/** Light direction of the travelling piece's shadow (world units per board spacing of depth, screen y down). */
const PIECE_LIGHT = { x: -3.2 * BOARD_INNER, y: 3.1 * BOARD_INNER }
const SHADOW_COLOR = '#303030'

export type CinematicCue = 'start' | 'vortex' | 'pass' | 'land' | 'end'

/** Where the game camera must be when the overlay dissolves, and where it then zooms out to. */
export interface LandingCamera {
  /** The new board (MoveRecord.toBoard). */
  l: number
  t: number
  /** World centre of the new board (in the `after` layout) and zoom (CSS px per world unit). */
  cx: number
  cy: number
  zoom: number
  /** Zoom-out target (CSS px per world unit) and duration, easeOutSine (as in the original). */
  zoomOut: number
  zoomOutMs: number
}

export interface TravelCinematicOptions {
  /** The render model shown just before the move (selection highlights are ignored). */
  before: RenderModel
  /** The render model after the move (the landing board and its highlights come from it). */
  after: RenderModel
  move: { from: Pos; to: Pos }
  /** Board created by the arrival (MoveRecord.toBoard). */
  toBoard: { l: number; t: number }
  /** The game camera at the start (MultiverseRenderer.getView); defaults to framing the source board. */
  view?: ViewState | null
  /** HUD opacity, every frame it changes (fade out at the start, back in after landing). */
  onHud?(opacity: number): void
  /** The piece has landed: put the game camera on the new board now (instantly), under the overlay. */
  onLand?(cam: LandingCamera): void
  /** The overlay is gone: start the game camera's zoom-out and give input back. */
  onOverlayEnd?(cam: LandingCamera): void
  /** Sound cues. */
  onCue?(cue: CinematicCue): void
  /** Clicks and key presses skip the rest (default true). */
  skippable?: boolean
  /** Dev harness: overrides the clock (seconds since the move); return null to use real time. */
  debugTime?: () => number | null
}

export interface CinematicHandle {
  /** Resolves once the overlay is gone (played to the end or skipped). */
  done: Promise<void>
  /** Jump to the end: the game shows the new board, the overlay fades out quickly. */
  skip(): void
  /** True until the overlay has been removed. */
  readonly playing: boolean
  /** Remove the overlay at once without calling any hook (e.g. the game screen closes). */
  dispose(): void
}

interface Card {
  key: string
  k: number
  p: BoardPlacement
  /** Floor anchor at the start and on the flight line. */
  x0: number
  y0: number
  x1: number
  y1: number
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  canvas: HTMLCanvasElement
  tex: THREE.CanvasTexture
  tier: number
  wantTier: number
  override: PieceOverride | null
  /** Alternative content (source board without the piece / landing board). */
  alt?: { p: BoardPlacement; override: PieceOverride | null; canvas: HTMLCanvasElement; tex: THREE.CanvasTexture | null; tier: number }
  showAlt: boolean
}

const MASK_KINDS = new Set(['moved', 'travel', 'check'])
/** The original's cards show no coordinates. */
const NO_COORDS = { coords: false }

function deviceRatio() {
  return Math.min(window.devicePixelRatio || 1, 2)
}

function nextPow2(px: number) {
  return Math.min(2048, Math.max(128, 2 ** Math.ceil(Math.log2(Math.max(1, px)))))
}

function cleanModel(m: RenderModel, persp: Color): RenderModel {
  return {
    ...m,
    perspective: persp,
    highlights: m.highlights.filter((h) => MASK_KINDS.has(h.kind)),
    viewFilter: 'all',
    viewMode: '2d',
    motion: undefined,
  }
}

/** Basis of the orbiting orthographic camera (views.ts conventions: azim = look direction). */
function basis(elev: number, azim: number) {
  const ce = Math.cos(elev)
  const fwd = new THREE.Vector3(ce * Math.cos(azim), ce * Math.sin(azim), -Math.sin(elev)).normalize()
  const right = new THREE.Vector3(Math.sin(azim), -Math.cos(azim), 0)
  const up = new THREE.Vector3().crossVectors(right, fwd).normalize()
  return { fwd, right, up }
}

/**
 * Plays the cinematic over `container` (the game view's element; the overlay is added
 * as its last child, so DOM placed above the view, like the HUD, stays on top).
 */
export function playTravelCinematic(container: HTMLElement, opts: TravelCinematicOptions): CinematicHandle {
  const persp = opts.before.perspective
  const flip = persp === 'black'
  const before = cleanModel(opts.before, persp)
  const after = cleanModel(opts.after, persp)
  const L: Layout = computeLayout(before)
  const LA: Layout = computeLayout(after)
  const path: TravelPath = travelPath(before.snapshot, opts.move.from, opts.move.to)
  const sched: Schedule = schedule(path.passes)
  const src = L.boardsByKey.get(`${opts.move.from.l}:${opts.move.from.t}`)
  const dest = L.boardsByKey.get(`${opts.move.to.l}:${opts.move.to.t}`)
  const landP = LA.boardsByKey.get(`${opts.toBoard.l}:${opts.toBoard.t}`)

  let resolveDone!: () => void
  const done = new Promise<void>((r) => (resolveDone = r))
  let playing = true
  const handle: CinematicHandle = {
    done,
    skip: () => skip(),
    dispose: () => abort(),
    get playing() {
      return playing
    },
  }
  if (!src || !dest || !landP) {
    // nothing sensible to show (e.g. boards outside the layout): finish at once
    playing = false
    resolveDone()
    return handle
  }

  // ---------------------------------------------------------------- DOM
  const root = document.createElement('div')
  root.className = 'travel-cinematic'
  Object.assign(root.style, {
    position: 'absolute',
    inset: '0',
    overflow: 'hidden',
    zIndex: '4',
    opacity: '0',
    pointerEvents: 'auto',
    touchAction: 'none',
  } satisfies Partial<CSSStyleDeclaration>)
  const floorCanvas = document.createElement('canvas')
  const glHost = document.createElement('div')
  for (const el of [floorCanvas, glHost]) Object.assign(el.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
  root.append(floorCanvas, glHost)
  container.appendChild(root)
  const fctx = floorCanvas.getContext('2d')!

  const gl = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true })
  gl.setClearColor(0x000000, 0)
  gl.outputColorSpace = THREE.SRGBColorSpace
  Object.assign(gl.domElement.style, { position: 'absolute', inset: '0', width: '100%', height: '100%' })
  glHost.appendChild(gl.domElement)
  const scene = new THREE.Scene()
  const cam = new THREE.OrthographicCamera(0, 1, 0, 1, -100, 100)
  cam.position.z = 10

  let W = 1
  let H = 1
  let dpr = 1
  let base = 1
  const resize = () => {
    W = Math.max(1, container.clientWidth)
    H = Math.max(1, container.clientHeight)
    dpr = deviceRatio()
    // the original scales with the view height; on narrow screens the width limits it
    base = Math.min(H, W * 1.15)
    floorCanvas.width = Math.round(W * dpr)
    floorCanvas.height = Math.round(H * dpr)
    gl.setPixelRatio(dpr)
    gl.setSize(W, H, false)
    cam.left = 0
    cam.right = W
    cam.top = 0
    cam.bottom = H
    cam.updateProjectionMatrix()
    vortex.setView(W / 2, H / 2, base, W, H, dpr)
  }

  // ---------------------------------------------------------------- scene
  const vortex = createVortex()
  vortex.mesh.renderOrder = 0
  scene.add(vortex.mesh)
  const planeGeo = new THREE.PlaneGeometry(1, 1)
  const floor = new FloorPainter(
    { layout: L, cards: new Set(path.boards.map((b) => `${b.l}:${b.t}`)), arrows: before.arrows, checks: before.checks, background: before.background ?? 'default' },
    flip,
  )

  const fromIdx = opts.move.from.y * before.snapshot.width + opts.move.from.x
  const cards: Card[] = []
  for (const pb of path.boards) {
    const p = L.boardsByKey.get(`${pb.l}:${pb.t}`)
    if (!p) continue
    const canvas = document.createElement('canvas')
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.flipY = false
    tex.anisotropy = 4
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
    const mesh = new THREE.Mesh(planeGeo, mat)
    mesh.frustumCulled = false
    mesh.visible = false
    scene.add(mesh)
    const card: Card = {
      key: p.key,
      k: pb.k,
      p,
      x0: p.x,
      y0: p.y,
      x1: src.x - pb.k,
      y1: src.y,
      mesh,
      canvas,
      tex,
      tier: 0,
      wantTier: 512,
      override: null,
      showAlt: false,
    }
    if (pb.k === 0) {
      // after the piece leaves, the source board is drawn without it
      card.alt = { p, override: { hide: [fromIdx], show: [] }, canvas: document.createElement('canvas'), tex: null, tier: 0 }
    }
    if (pb.k === path.passes) {
      // on landing the destination card shows the new board (keeping its own frame)
      const nb = after.snapshot.timelines.find((tl) => tl.l === opts.toBoard.l)?.boards[opts.toBoard.t - (after.snapshot.timelines.find((tl) => tl.l === opts.toBoard.l)?.startT ?? 0)]
      const hl: HighlightedSquare[] = after.highlights.filter((h) => h.pos.l === opts.toBoard.l && h.pos.t === opts.toBoard.t)
      const lp: BoardPlacement = { ...p, board: nb ?? landP.board, highlights: hl.map((h) => ({ ...h, pos: { ...h.pos, l: p.l, t: p.t } })) }
      card.alt = { p: lp, override: null, canvas: document.createElement('canvas'), tex: null, tier: 0 }
    }
    cards.push(card)
  }
  const srcCard = cards.find((c) => c.k === 0)!
  const destCard = cards.find((c) => c.k === path.passes)!

  // travelling piece and its shadow
  const movingPiece = before.snapshot.timelines.find((tl) => tl.l === opts.move.from.l)?.boards[opts.move.from.t - (before.snapshot.timelines.find((tl) => tl.l === opts.move.from.l)?.startT ?? 0)]?.squares[fromIdx] ?? null
  const pieceCanvas = document.createElement('canvas')
  const pieceTex = new THREE.CanvasTexture(pieceCanvas)
  pieceTex.colorSpace = THREE.SRGBColorSpace
  pieceTex.flipY = false
  const pieceMat = new THREE.MeshBasicMaterial({ map: pieceTex, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide })
  const pieceMesh = new THREE.Mesh(planeGeo, pieceMat)
  pieceMesh.visible = false
  pieceMesh.frustumCulled = false
  scene.add(pieceMesh)
  const shadowUniforms = {
    map: { value: pieceTex },
    color: { value: new THREE.Color(SHADOW_COLOR) },
    rect: { value: new THREE.Vector4(0, 0, 0, 0) },
    radius: { value: 0 },
  }
  const shadowMat = new THREE.ShaderMaterial({
    uniforms: shadowUniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec2 vPx;
      void main() {
        vUv = uv;
        vec4 w = modelMatrix * vec4(position, 1.0);
        vPx = w.xy;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map;
      uniform vec3 color;
      uniform vec4 rect; // x0, y0, x1, y1 in CSS px (the board the shadow falls on)
      uniform float radius;
      varying vec2 vUv;
      varying vec2 vPx;
      void main() {
        vec2 c = clamp(vPx, rect.xy + radius, rect.zw - radius);
        if (distance(vPx, c) > radius) discard;
        float a = texture2D(map, vUv).a;
        if (a < 0.01) discard;
        gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
      }`,
  })
  const shadowMesh = new THREE.Mesh(planeGeo, shadowMat)
  shadowMesh.visible = false
  shadowMesh.frustumCulled = false
  scene.add(shadowMesh)

  // ---------------------------------------------------------------- camera start
  resize()
  const view = opts.view
  const flatStart = !view || (Math.abs(view.elevation - Math.PI / 2) < 1e-3 && !view.transitioning && view.mode === '2d')
  const zoomEnd = STACK_ZOOM * base
  const cx0 = view ? view.cx : src.x
  const cy0 = view ? view.cy : src.y
  const zoom0 = view ? view.zoom * (view.width > 0 ? W / view.width : 1) : zoomEnd * 1.2
  const elev0 = view && !flatStart ? view.elevation : Math.PI / 2
  const azim0 = view && !flatStart ? view.azimuth : Math.PI / 2
  // a 3D start cannot match the standing cards of the 3D views: dissolve in instead
  const fadeIn = flatStart ? 0.12 : 0.3

  // landing camera for the game behind the overlay
  const pxPerUnitAt = (d: number) => (FLIGHT_K * base) / (d * BOARD_INNER)
  const landing = (): LandingCamera => ({
    l: opts.toBoard.l,
    t: opts.toBoard.t,
    cx: landP.x,
    cy: landP.y,
    zoom: pxPerUnitAt(DEPTH_LAND),
    zoomOut: zoomEnd,
    zoomOutMs: ZOOM_OUT_SECONDS * 1000,
  })

  // ---------------------------------------------------------------- textures (progressive)
  const ensureTex = (c: Card, alt: boolean): boolean => {
    if (alt) {
      const a = c.alt!
      const want = c.wantTier
      if (a.tier >= want) return false
      drawBoard(a.canvas, a.p, flip, want, a.override, NO_COORDS)
      if (!a.tex) {
        a.tex = new THREE.CanvasTexture(a.canvas)
        a.tex.colorSpace = THREE.SRGBColorSpace
        a.tex.flipY = false
        a.tex.anisotropy = 4
      } else a.tex.needsUpdate = true
      a.tier = want
      return true
    }
    if (c.tier >= c.wantTier) return false
    drawBoard(c.canvas, c.p, flip, c.wantTier, c.override, NO_COORDS)
    c.tex.dispose() // the canvas changes size: re-upload from scratch
    c.tex = new THREE.CanvasTexture(c.canvas)
    c.tex.colorSpace = THREE.SRGBColorSpace
    c.tex.flipY = false
    c.tex.anisotropy = 4
    c.mesh.material.map = c.tex
    c.mesh.material.needsUpdate = true
    c.tier = c.wantTier
    return true
  }
  // initial low-resolution pass for every card, so the first frame has all of them
  for (const c of cards) {
    c.wantTier = 512
    ensureTex(c, false)
  }
  const bigTier = nextPow2(0.85 * base * dpr)
  const pieceSize = nextPow2(src.square * pxPerUnitAt(DEPTH_LAND) * dpr)
  const drawPiece = () => {
    if (!movingPiece) return
    const spr = pieceSprite(movingPiece.type, movingPiece.color, pieceSize)
    if (!spr) return
    pieceCanvas.width = spr.width
    pieceCanvas.height = spr.height
    pieceCanvas.getContext('2d')!.drawImage(spr, 0, 0)
    pieceTex.needsUpdate = true
  }
  void loadPieceImages().then(() => {
    if (!playing) return
    drawPiece()
    // redraw everything with the pieces
    for (const c of cards) {
      c.tier = Math.min(c.tier, 1)
      if (c.alt) c.alt.tier = Math.min(c.alt.tier, 1)
    }
  })
  drawPiece()
  /** One texture upgrade per frame, in order of need. */
  const upgradeOne = (c: number) => {
    const order: [Card, boolean][] = []
    order.push([srcCard, false], [destCard, false])
    if (srcCard.alt) order.push([srcCard, true])
    if (destCard.alt) order.push([destCard, true])
    for (const cd of cards) if (cd !== srcCard && cd !== destCard && cd.k <= path.passes) order.push([cd, false])
    const flightD = c > FLIGHT_START ? flightDistance(sched.plan, c - FLIGHT_START) : 0
    for (const [cd, alt] of order) {
      const d = DEPTH_START + cd.k - flightD
      cd.wantTier = cd.k <= path.passes && d < 2.6 ? bigTier : Math.min(1024, bigTier)
      if (ensureTex(cd, alt)) return
    }
  }

  // ---------------------------------------------------------------- input (skip)
  let skipping = false
  const swallow = (e: Event) => {
    e.stopImmediatePropagation()
    if (e.cancelable) e.preventDefault()
  }
  const onPointer = (e: Event) => {
    swallow(e)
    if (e.type === 'pointerdown' && opts.skippable !== false) skip()
  }
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
    swallow(e)
    if (opts.skippable !== false) skip()
  }
  const capture = { capture: true, passive: false } as AddEventListenerOptions
  for (const t of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel']) window.addEventListener(t, onPointer, capture)
  window.addEventListener('keydown', onKey, capture)
  const ro = new ResizeObserver(() => resize())
  ro.observe(container)

  // ---------------------------------------------------------------- frame
  let t0 = -1
  let raf = 0
  let lastHud = -1
  let landed = false
  let ended = false
  let cueVortex = false
  let passed = 0
  let skipT0 = -1
  const cue = (c: CinematicCue) => {
    try {
      opts.onCue?.(c)
    } catch {
      /* sound is optional */
    }
  }
  const setHud = (v: number) => {
    const r = Math.round(v * 100) / 100
    if (r === lastHud) return
    lastHud = r
    opts.onHud?.(r)
  }
  const land = () => {
    if (landed) return
    landed = true
    cue('land')
    opts.onLand?.(landing())
  }

  const place = (mesh: THREE.Mesh, x: number, y: number, w: number, h: number, order: number, opacity = 1) => {
    mesh.position.set(x, y, 0)
    mesh.scale.set(w, h, 1)
    mesh.renderOrder = order
    mesh.visible = opacity > 0.002 && w > 0.5
    const m = mesh.material as THREE.MeshBasicMaterial
    if ('opacity' in m) m.opacity = opacity
  }

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame)
    if (t0 < 0) t0 = now
    const dbg = opts.debugTime?.()
    let c = dbg ?? (now - t0) / 1000
    if (skipping) c = Math.max(c, sched.land + 0.05)
    upgradeOne(c)

    // overlay opacity: quick dissolve in; skip: quick dissolve out
    let rootA = dbg != null ? 1 : Math.min(1, c / fadeIn)
    if (skipT0 >= 0) rootA *= 1 - Math.min(1, (now - skipT0) / 180)
    root.style.opacity = String(rootA)

    setHud(hudOpacity(c, sched))
    const cx = W / 2
    const cy = H / 2

    // hide everything, then show what this frame needs
    for (const cd of cards) cd.mesh.visible = false
    pieceMesh.visible = false
    shadowMesh.visible = false

    if (c < STACK_CUT) {
      // ------------------------------ orbit and card stack
      const e = orbitProgress(c)
      const elev = elev0 + (0 - elev0) * e
      const azim = azim0 + (Math.PI - azim0) * e
      const { fwd, right, up } = basis(elev, azim)
      const zoom = 1 / (1 / zoom0 + (1 / zoomEnd - 1 / zoom0) * e)
      // the cards rise as the camera tilts; the camera keeps the source card centred
      const lift = BOARD_Z + (CARD_LIFT - BOARD_Z) * e
      const T = new THREE.Vector3(cx0 + (src.x - cx0) * e, cy0 + (src.y - cy0) * e, lift)
      const proj = (x: number, y: number, z: number) => ({
        x: cx + zoom * ((x - T.x) * right.x + (y - T.y) * right.y + (z - T.z) * right.z),
        y: cy - zoom * ((x - T.x) * up.x + (y - T.y) * up.y + (z - T.z) * up.z),
      })
      // floor
      const vA = smoothstep(FLOOR_FADE.start, FLOOR_FADE.end, c)
      if (vA > 0 && !cueVortex) {
        cueVortex = true
        cue('vortex')
      }
      if (vA < 1) {
        floorCanvas.style.visibility = 'visible'
        const o = proj(0, 0, 0)
        const px = proj(1, 0, 0)
        const py = proj(0, 1, 0)
        const m: Affine = { a: px.x - o.x, b: px.y - o.y, c: py.x - o.x, d: py.y - o.y, e: o.x, f: o.y }
        const shadows: CardShadow[] = cards.map((cd) => ({
          x: cd.x0 + (cd.x1 - cd.x0) * e + lift * CARD_LIGHT.x,
          y: cd.y0 + (cd.y1 - cd.y0) * e + lift * CARD_LIGHT.y,
          w: cd.p.w,
          h: cd.p.h,
          r: cd.p.thick ? CORNER_THICK : CORNER_THIN,
        }))
        floor.paint(fctx, m, W, H, dpr, shadows)
      } else floorCanvas.style.visibility = 'hidden'
      vortex.setOpacity(vA)
      vortex.setRings(0)
      // cards: anchors glide onto the flight line, sorted far to near
      const list = cards.map((cd) => {
        const x = cd.x0 + (cd.x1 - cd.x0) * e
        const y = cd.y0 + (cd.y1 - cd.y0) * e
        const depth = x * fwd.x + y * fwd.y + lift * fwd.z
        return { cd, x, y, depth }
      })
      list.sort((a, b) => b.depth - a.depth)
      list.forEach(({ cd, x, y }, i) => {
        const s = proj(x, y, lift)
        const mat = cd.mesh.material
        if (mat.map !== cd.tex) {
          mat.map = cd.tex
          mat.needsUpdate = true
        }
        place(cd.mesh, s.x, s.y, cd.p.w * zoom, cd.p.h * zoom, 10 + i)
      })
    } else {
      // ------------------------------ flight
      floorCanvas.style.visibility = 'hidden'
      const D = flightDistance(sched.plan, c - FLIGHT_START)
      vortex.setRings(RINGS_PER_SPACING * D)
      const endA = c >= sched.endFade.start ? endFadeCurve((c - sched.endFade.start) / (sched.endFade.end - sched.endFade.start)) : 0
      vortex.setOpacity(1 - endA)
      const detached = c >= sched.detach && c < sched.land
      if (c >= sched.land) land()
      // cards far to near
      const vis = cards
        .filter((cd) => cd.k <= path.passes)
        .map((cd) => ({ cd, d: cd === destCard ? Math.max(DEPTH_LAND, DEPTH_START + cd.k - D) : DEPTH_START + cd.k - D }))
        .filter((v) => v.d > 0.005)
        .sort((a, b) => b.d - a.d)
      // pass cues
      const crossed = cards.filter((cd) => cd.k < path.passes && DEPTH_START + cd.k - D <= DEPTH_LAND).length
      while (passed < crossed) {
        passed++
        cue('pass')
      }
      let order = 10
      // the piece and its shadow sit between the boards behind and in front of DEPTH_LAND
      const pxL = pxPerUnitAt(DEPTH_LAND)
      const sqOff = (p: BoardPlacement, pos: Pos) => squareOffset(p, pos.x, pos.y, flip)
      const so = sqOff(src, opts.move.from)
      const dO = sqOff(dest, opts.move.to)
      const u = Math.min(1, Math.max(0, (c - sched.detach) / (sched.land - sched.detach)))
      const pX = so.x + (dO.x - so.x) * u // world offsets at the landing depth (y up)
      const pY = so.y + (dO.y - so.y) * u
      let behind: { cd: Card; d: number } | null = null
      for (const v of vis) if (v.d > DEPTH_LAND + 1e-6 && (!behind || v.d < behind.d)) behind = v
      for (const v of vis) {
        const { cd, d } = v
        if (detached && behind && v.d <= DEPTH_LAND + 1e-6 && order < 1000) {
          // the shadow lies on the board just behind the piece, under any board in front of it
          drawShadow()
          order = 1000
        }
        const k = pxPerUnitAt(d)
        const useAlt = (cd === srcCard && c >= sched.detach) || (cd === destCard && c >= sched.land)
        const tex = useAlt && cd.alt?.tex ? cd.alt.tex : cd.tex
        const mat = cd.mesh.material
        if (mat.map !== tex) {
          mat.map = tex
          mat.needsUpdate = true
        }
        place(cd.mesh, cx, cy, cd.p.w * k, cd.p.h * k, order++, boardAlpha(d))
      }
      if (detached && behind && order < 1000) drawShadow()
      // the travelling piece stays on top of everything, even boards passing in front of it
      if (detached && movingPiece) {
        const size = src.square * pxL
        place(pieceMesh, cx + pX * pxL, cy - pY * pxL, size, size, 2000)
      }

      function drawShadow() {
        if (!movingPiece || !behind) return
        const size = src!.square * pxL
        const dd = behind.d - DEPTH_LAND
        const kb = pxPerUnitAt(behind.d)
        // the piece projected along the light onto the board behind it
        const wx = pX + PIECE_LIGHT.x * dd
        const wy = -pY + PIECE_LIGHT.y * dd
        const p = behind.cd.p
        const hw = (p.w * kb) / 2
        const hh = (p.h * kb) / 2
        shadowUniforms.rect.value.set(cx - hw, cy - hh, cx + hw, cy + hh)
        shadowUniforms.radius.value = (p.thick ? CORNER_THICK : CORNER_THIN) * kb
        place(shadowMesh, cx + wx * kb, cy + wy * kb, (size * kb) / pxL, (size * kb) / pxL, order++)
      }
    }

    gl.render(scene, cam)

    if ((dbg == null && c >= sched.overlayEnd) || (skipT0 >= 0 && now - skipT0 >= 180)) finish()
  }

  function abort() {
    if (!playing || ended) return
    ended = true
    cleanup()
    resolveDone()
  }

  function skip() {
    if (!playing || skipT0 >= 0) return
    skipping = true
    skipT0 = performance.now()
    // the landing board must be ready for the short dissolve
    if (destCard.alt && !destCard.alt.tex) ensureTex(destCard, true)
    land()
  }

  function finish() {
    if (ended) return
    ended = true
    land()
    setHud(1)
    cue('end')
    const cam0 = landing()
    cleanup()
    try {
      opts.onOverlayEnd?.(cam0)
    } finally {
      resolveDone()
    }
  }

  function cleanup() {
    playing = false
    cancelAnimationFrame(raf)
    ro.disconnect()
    for (const t of ['pointerdown', 'pointerup', 'click', 'dblclick', 'contextmenu', 'wheel']) window.removeEventListener(t, onPointer, capture)
    window.removeEventListener('keydown', onKey, capture)
    for (const cd of cards) {
      cd.tex.dispose()
      cd.mesh.material.dispose()
      cd.canvas.width = cd.canvas.height = 0
      if (cd.alt) {
        cd.alt.tex?.dispose()
        cd.alt.canvas.width = cd.alt.canvas.height = 0
      }
    }
    pieceTex.dispose()
    pieceMat.dispose()
    shadowMat.dispose()
    planeGeo.dispose()
    vortex.dispose()
    floor.dispose()
    gl.dispose()
    gl.forceContextLoss()
    root.remove()
  }

  cue('start')
  raf = requestAnimationFrame(frame)
  return handle
}
