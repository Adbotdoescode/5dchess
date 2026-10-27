// The Three.js multiverse renderer. See ./types.ts for the public contract.

import * as THREE from 'three'
import '@fontsource/eb-garamond/400-italic.css'
import type { Board, Pos } from '../engine/types'
import type { MultiverseRenderer, RenderModel, RendererEvents } from './types'
import {
  ARROW_HALF,
  ARROW_HEAD_HALF,
  ARROW_HEAD_LEN,
  ARROW_OUTLINE,
  BAND_HALF,
  BAND_RIM,
  BAND_SHADOW,
  BAR_EDGE,
  BAR_SHADOW,
  BAR_TEXT_GAP,
  LABEL_MARGIN_BOARD,
  LABEL_MARGIN_MARKER,
  BAR_TEXT_SIZE,
  BAR_WIDTH,
  BOARD_SHADOW,
  COLORS,
  CORNER_THICK,
  CORNER_THIN,
  HEAD_BASE,
  HEAD_TIP,
  MARKER_RADIUS,
  MARKER_RIM,
} from './constants'
import {
  type BandStyle,
  type BoardPlacement,
  type Layout,
  type TimelinePlacement,
  type Vec2,
  boardKey,
  computeLayout,
  squareAt,
  squareOffset,
} from './layout'
import { canvasSize, drawBoard, textureKey } from './boardTexture'
import {
  arrowPositions,
  bezier3,
  circlePositions,
  disposeGeometryCache,
  geometryFrom,
  offsetConvex,
  polygonPositions,
  ribbonPositions,
  roundedRectGeometry,
} from './geometry'
import { CameraRig } from './camera'
import { loadPieceImages, piecesReady } from './pieces'

// ---------------------------------------------------------------------------
// Layering (renderOrder). Ground layers never test/write depth.
const RO = {
  bg: 0,
  barShadow: 1,
  bar: 2,
  marker: 3,
  bandShadow: 4,
  bandRim: 5,
  band: 6,
  boardShadow: 7,
  glow: 7.5,
  board: 8,
  hover: 9,
  arrowOutline: 10,
  arrow: 11,
}

/** Shadow "light": a point at height z is shadowed at (x, y) - z * LIGHT. */
const LIGHT = { x: -BOARD_SHADOW.x / 0.1, y: -BOARD_SHADOW.y / 0.1 }
/** Height of flat 2D boards (so their shadow offset equals BOARD_SHADOW). */
const BOARD_Z_2D = 0.1
/** 3D: boards stand on their lower edge, tilted back by this angle from the ground. */
const TILT_3D = THREE.MathUtils.degToRad(62)
const LIFT_3D = 0.1
const BOTTOM_3D = 0.36
/** 3D boards stand tall; shorten their shadows. */
const SHADOW_3D = 0.45
/** Pulsing halo around boards that must still be moved on. */
const GLOW_PAD = 0.026

const TIERS = [64, 128, 256, 512, 1024, 2048]
const NEW_BOARD_MS = 380
const BAND_MS = 380
const PRESENT_MS = 480

const BAND_COLORS: Record<BandStyle, { body: string; rim: string }> = {
  active: { body: COLORS.bandActive, rim: COLORS.bandActiveRim },
  white: { body: COLORS.bandWhite, rim: COLORS.bandWhiteRim },
  black: { body: COLORS.bandBlack, rim: COLORS.bandBlackRim },
}
const BAND_STYLES: BandStyle[] = ['active', 'white', 'black']

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

interface BoardEntry {
  key: string
  p: BoardPlacement
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  shadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  canvas: HTMLCanvasElement | null
  texture: THREE.CanvasTexture | null
  drawnBoard: Board | null
  drawnKey: string
  tier: number
  /** Displayed column x (animated). */
  dispX: number
  opacity: number
  anim: { start: number; fromX: number } | null
  glow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null
  hover: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[]
  inView: boolean
}

function basicMat(color: string, opts: THREE.MeshBasicMaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    ...opts,
  })
}

function setGeometry(mesh: THREE.Mesh, positions: number[]) {
  mesh.geometry.dispose()
  mesh.geometry = geometryFrom(positions)
  mesh.visible = positions.length > 0
}

export class Renderer implements MultiverseRenderer {
  private readonly container: HTMLElement
  private readonly gl: THREE.WebGLRenderer
  private readonly overlay: HTMLCanvasElement
  private readonly scene = new THREE.Scene()
  private readonly rig = new CameraRig()
  private events: RendererEvents = {}
  private model: RenderModel | null = null
  private layout: Layout | null = null
  private readonly entries = new Map<string, BoardEntry>()
  private readonly boardsGroup = new THREE.Group()
  private readonly planeCache = new Map<string, THREE.PlaneGeometry>()
  private readonly shadowMat = basicMat(COLORS.shadow)
  private readonly hoverMat = basicMat('#ffffff', { transparent: true, opacity: 0.32 })

  // ground
  private readonly bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly barShadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly bar: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>
  private readonly barTextures: { light: THREE.CanvasTexture; dark: THREE.CanvasTexture }
  private barX = 0
  /** "The Present" labels: one texture, a pool of planes laid out between obstacles. */
  private readonly labelGroup = new THREE.Group()
  private readonly labelMat: THREE.MeshBasicMaterial
  private labelGeo: THREE.PlaneGeometry | null = null
  private labelLen = 2.6
  private barAnim: { start: number; from: number; to: number } | null = null
  private readonly bandShadow: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private readonly bandRims: Record<BandStyle, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>
  private readonly bandBodies: Record<BandStyle, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>
  private bandEnds = new Map<number, { from: number; to: number; start: number }>()
  private readonly markerGroup = new THREE.Group()
  private readonly arrowGroup = new THREE.Group()
  private readonly arrowOutline: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
  private readonly arrowCores: Record<string, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>

  private frameRequested = false
  private pulseTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private firstModel = true
  private readonly resizeObserver: ResizeObserver
  private readonly cleanups: (() => void)[] = []
  private hoverKey = ''
  private lastCamKey = ''
  private texturesPending = false

  constructor(container: HTMLElement) {
    this.container = container
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'

    this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5))
    this.gl.setClearColor(new THREE.Color(COLORS.bgLight))
    const canvas = this.gl.domElement
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none'
    container.appendChild(canvas)

    this.overlay = document.createElement('canvas')
    this.overlay.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none'
    container.appendChild(this.overlay)

    // Background checkerboard (procedural, world-anchored)
    const bgMat = new THREE.ShaderMaterial({
      uniforms: {
        cLight: { value: new THREE.Color(COLORS.bgLight) },
        cDark: { value: new THREE.Color(COLORS.bgDark) },
        cellW: { value: 2 },
        cellOrigin: { value: -0.5 },
        rowOffset: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xy;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 cLight;
        uniform vec3 cDark;
        uniform float cellW;
        uniform float cellOrigin;
        uniform float rowOffset;
        varying vec2 vWorld;
        void main() {
          float cx = floor((vWorld.x - cellOrigin) / cellW);
          float cy = floor(vWorld.y + 0.5 + rowOffset);
          float odd = mod(cx + cy, 2.0);
          gl_FragColor = vec4(odd > 0.5 ? cLight : cDark, 1.0);
          #include <colorspace_fragment>
        }`,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.bg = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), bgMat)
    this.bg.renderOrder = RO.bg
    this.bg.frustumCulled = false
    this.scene.add(this.bg)

    // The Present bar
    this.barTextures = { light: this.makeBarTexture('white'), dark: this.makeBarTexture('black') }
    this.barShadow = new THREE.Mesh(new THREE.PlaneGeometry(BAR_WIDTH, 1), this.shadowMat)
    this.barShadow.renderOrder = RO.barShadow
    this.barShadow.frustumCulled = false
    this.bar = new THREE.Mesh(
      new THREE.PlaneGeometry(BAR_WIDTH, 1),
      new THREE.MeshBasicMaterial({ map: this.barTextures.light, depthTest: false, depthWrite: false, side: THREE.DoubleSide }),
    )
    this.bar.renderOrder = RO.bar
    this.bar.frustumCulled = false
    this.scene.add(this.barShadow, this.bar)
    this.labelMat = new THREE.MeshBasicMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      side: THREE.DoubleSide,
    })
    this.scene.add(this.labelGroup)
    this.buildLabelTexture()
    void document.fonts
      ?.load(`italic 400 64px "EB Garamond"`)
      .then(() => {
        if (this.disposed) return
        // the label size depends on the real font metrics: rebuild it (GPU sizes are immutable)
        this.buildLabelTexture()
        this.requestRender()
      })
      .catch(() => {})

    // Timeline bands
    const mk = (color: string, ro: number) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), basicMat(color))
      m.renderOrder = ro
      m.frustumCulled = false
      this.scene.add(m)
      return m
    }
    this.bandShadow = mk(COLORS.shadow, RO.bandShadow)
    this.bandRims = {} as Record<BandStyle, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>
    this.bandBodies = {} as Record<BandStyle, THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>>
    BAND_STYLES.forEach((s, i) => {
      this.bandRims[s] = mk(BAND_COLORS[s].rim, RO.bandRim + i * 0.1)
      this.bandBodies[s] = mk(BAND_COLORS[s].body, RO.band + i * 0.1)
    })

    this.scene.add(this.markerGroup)
    this.scene.add(this.boardsGroup)

    // Arrows
    // arrows are 'transparent' so they render after the (transparent) boards
    this.arrowOutline = new THREE.Mesh(new THREE.BufferGeometry(), basicMat(COLORS.arrowOutline, { transparent: true }))
    this.arrowOutline.renderOrder = RO.arrowOutline
    this.arrowOutline.frustumCulled = false
    this.arrowGroup.add(this.arrowOutline)
    this.arrowCores = {}
    const cores: [string, string][] = [
      ['last-move', COLORS.arrowMove],
      ['pending', COLORS.arrowPending],
      ['check', COLORS.arrowCheck],
    ]
    cores.forEach(([k, c], i) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), basicMat(c, { transparent: true }))
      m.renderOrder = RO.arrow + i * 0.1
      m.frustumCulled = false
      this.arrowCores[k] = m
      this.arrowGroup.add(m)
    })
    this.scene.add(this.arrowGroup)

    this.attachInput(canvas)
    this.resizeObserver = new ResizeObserver(() => this.resize())
    this.resizeObserver.observe(container)
    this.resize()

    void loadPieceImages().then(() => {
      if (!this.disposed) this.requestRender()
    })
  }

  // -------------------------------------------------------------------------
  // Public API

  setEvents(events: RendererEvents): void {
    this.events = events
  }

  setModel(model: RenderModel): void {
    if (this.disposed) return
    const prevModel = this.model
    const prev = this.layout
    const modeChanged = !prevModel || prevModel.cameraMode !== model.cameraMode
    this.model = model
    const layout = computeLayout(model)
    this.layout = layout
    const now = performance.now()
    const animate = model.animations && !this.firstModel && !!prev &&
      prevModel?.viewFilter === model.viewFilter && prevModel?.perspective === model.perspective

    if (modeChanged) this.rig.mode = model.cameraMode
    this.rig.update()
    this.hoverMat.depthTest = model.cameraMode === '3d'

    // Boards
    const seen = new Set<string>()
    for (const p of layout.boards) {
      seen.add(p.key)
      let e = this.entries.get(p.key)
      if (!e) {
        e = this.createEntry(p)
        if (animate) {
          e.anim = { start: now, fromX: p.x - 1 }
          e.dispX = p.x - 1
          e.opacity = 0
        }
      }
      e.p = p
      if (!e.anim) e.dispX = p.x
      this.placeEntry(e)
      this.updateGlow(e)
    }
    for (const [k, e] of this.entries) if (!seen.has(k)) this.removeEntry(e)

    // Bands: animate the end of timelines that grew
    const prevEnds = new Map<number, number>()
    if (prev) for (const tl of prev.timelines) prevEnds.set(tl.l, tl.endX)
    if (animate) {
      for (const tl of layout.timelines) {
        const old = prevEnds.get(tl.l)
        const cur = this.bandEnds.get(tl.l)
        const from = cur ? this.bandEndValue(cur, now) : old
        if (from !== undefined && from !== tl.endX) this.bandEnds.set(tl.l, { from, to: tl.endX, start: now })
        else if (from === undefined) this.bandEnds.set(tl.l, { from: tl.endX - 1, to: tl.endX, start: now })
      }
    } else this.bandEnds.clear()
    this.buildBands(now)

    // Present bar
    if (animate && prev && prev.presentX !== layout.presentX) {
      this.barAnim = { start: now, from: this.barX, to: layout.presentX }
    } else {
      this.barAnim = null
      this.barX = layout.presentX
    }
    this.bar.material.map = layout.presentColor === 'white' ? this.barTextures.light : this.barTextures.dark
    this.bar.material.needsUpdate = true
    this.buildMarkers()

    const u = this.bg.material.uniforms
    const [bgL, bgD] = this.bgColors()
    u.cLight.value.set(bgL)
    u.cDark.value.set(bgD)
    this.gl.setClearColor(new THREE.Color(bgL))
    u.cellW.value = layout.cellWidth
    u.cellOrigin.value = layout.cellOrigin
    u.rowOffset.value = layout.rowOffset

    this.updateHoverOverlays()
    this.buildArrows()

    if (this.firstModel) {
      this.firstModel = false
      this.focusPresentNow(0)
    } else if (modeChanged) {
      this.rig.update()
    }
    this.requestRender()
  }

  focusBoard(l: number, t: number): void {
    const e = this.entries.get(boardKey(l, t))
    let x: number
    let y: number
    if (e) {
      x = e.p.x
      y = e.p.y
    } else if (this.layout && this.model) {
      x = this.model.viewFilter === 'parallel' ? Math.floor(t / 2) : t
      y = this.model.perspective === 'white' ? -l : l
    } else return
    const minZoom = Math.min(this.rig.width, this.rig.height) / 5
    this.rig.animateTo({ cx: x, cy: y, zoom: Math.max(this.rig.state.zoom, minZoom) })
    this.requestRender()
  }

  focusPresent(): void {
    this.focusPresentNow(500)
  }

  panBy(dxPx: number, dyPx: number): void {
    if (this.disposed) return
    const w = this.rig.width / 2
    const h = this.rig.height / 2
    const a = this.rig.screenToGround(w, h)
    const b = this.rig.screenToGround(w + dxPx, h + dyPx)
    if (a && b) this.rig.panBy(b.x - a.x, b.y - a.y)
    this.requestRender()
  }

  zoomBy(factor: number): void {
    if (this.disposed) return
    this.rig.zoomAt(factor, this.rig.width / 2, this.rig.height / 2)
    this.requestRender()
  }

  resize(): void {
    if (this.disposed) return
    const w = this.container.clientWidth || 1
    const h = this.container.clientHeight || 1
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5))
    this.gl.setSize(w, h, false)
    const dpr = this.gl.getPixelRatio()
    this.overlay.width = Math.round(w * dpr)
    this.overlay.height = Math.round(h * dpr)
    this.rig.setSize(w, h)
    this.requestRender()
  }

  /** CSS pixel position (relative to the container) of a square's centre, or null. */
  projectSquare(pos: Pos): { x: number; y: number } | null {
    const v = this.squareWorld(pos)
    if (!v) return null
    const p = this.rig.project(v)
    return { x: p.x, y: p.y }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.resizeObserver.disconnect()
    for (const c of this.cleanups) c()
    if (this.pulseTimer) clearTimeout(this.pulseTimer)
    for (const e of [...this.entries.values()]) this.removeEntry(e)
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | THREE.Material[]
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      }
    })
    this.barTextures.light.dispose()
    this.barTextures.dark.dispose()
    this.labelMat.map?.dispose()
    this.labelGeo?.dispose()
    for (const g of this.planeCache.values()) g.dispose()
    this.planeCache.clear()
    disposeGeometryCache()
    this.gl.dispose()
    this.gl.domElement.remove()
    this.overlay.remove()
  }

  // -------------------------------------------------------------------------
  // Camera helpers

  /** Background checker colours [light, dark] for the model's background tint. */
  private bgColors(): [string, string] {
    return this.model?.background === 'ended' ? [COLORS.bgEndedLight, COLORS.bgEndedDark] : [COLORS.bgLight, COLORS.bgDark]
  }

  private focusPresentNow(dur: number) {
    const L = this.layout
    if (!L) return
    const b = L.presentBounds
    // include the end boards of active timelines and the markers' rows
    const minX = b.minX - 0.3
    const maxX = b.maxX + 0.3
    const minY = b.minY - 0.15
    const maxY = b.maxY + 0.15
    const w = this.rig.width
    const h = this.rig.height
    const zoomFit = Math.min(w / (maxX - minX), h / (maxY - minY))
    // never closer than the game's default framing (~5.3 rows on screen); on narrow
    // portrait screens (phones) allow ~3.4 boards across instead of 7 columns
    let zoom = Math.min(zoomFit, h / 5.3, Math.max(w / 7, Math.min(w, h) / 3.4))
    let cy = (minY + maxY) / 2
    if (this.rig.mode === '3d') {
      // boards stand up from their row: aim a little higher and back off a bit
      cy += 0.3
      zoom *= 0.85
    }
    this.rig.animateTo({ cx: (minX + maxX) / 2, cy, zoom }, dur)
    this.requestRender()
  }

  // -------------------------------------------------------------------------
  // Boards

  private planeGeometry(w: number, h: number): THREE.PlaneGeometry {
    const k = `${w.toFixed(4)}x${h.toFixed(4)}`
    let g = this.planeCache.get(k)
    if (!g) this.planeCache.set(k, (g = new THREE.PlaneGeometry(w, h)))
    return g
  }

  private createEntry(p: BoardPlacement): BoardEntry {
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      alphaTest: 0.01,
      side: THREE.DoubleSide,
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(this.planeGeometry(p.w, p.h), mat)
    mesh.renderOrder = RO.board
    mesh.userData.key = p.key
    mesh.visible = false // until it has a texture
    const shadow = new THREE.Mesh(roundedRectGeometry(p.w, p.h, this.cornerOf(p)), this.shadowMat)
    shadow.renderOrder = RO.boardShadow
    shadow.matrixAutoUpdate = false
    shadow.frustumCulled = false
    this.boardsGroup.add(shadow, mesh)
    const e: BoardEntry = {
      key: p.key,
      p,
      mesh,
      shadow,
      canvas: null,
      texture: null,
      drawnBoard: null,
      drawnKey: '',
      tier: 0,
      dispX: p.x,
      opacity: 1,
      anim: null,
      glow: null,
      hover: [],
      inView: true,
    }
    this.entries.set(p.key, e)
    return e
  }

  private cornerOf(p: BoardPlacement) {
    return p.thick || p.frame === 'pending' || p.frame === 'check' ? CORNER_THICK : CORNER_THIN
  }

  private removeEntry(e: BoardEntry) {
    this.boardsGroup.remove(e.mesh, e.shadow)
    e.texture?.dispose()
    e.mesh.material.dispose()
    if (e.glow) {
      e.glow.material.dispose()
    }
    for (const h of e.hover) h.geometry.dispose()
    this.entries.delete(e.key)
  }

  /** Positions the board mesh and its shadow for the current mode. */
  private placeEntry(e: BoardEntry) {
    const p = e.p
    const m = e.mesh
    const geo = this.planeGeometry(p.w, p.h)
    if (m.geometry !== geo) m.geometry = geo
    const sg = roundedRectGeometry(p.w, p.h, this.cornerOf(p))
    if (e.shadow.geometry !== sg) e.shadow.geometry = sg
    const three = this.rig.mode === '3d'
    if (three) {
      m.rotation.set(TILT_3D, 0, 0)
      m.position.set(
        e.dispX,
        p.y - BOTTOM_3D + (p.h / 2) * Math.cos(TILT_3D),
        LIFT_3D + (p.h / 2) * Math.sin(TILT_3D),
      )
    } else {
      m.rotation.set(0, 0, 0)
      m.position.set(e.dispX, p.y, BOARD_Z_2D)
    }
    const mat = m.material
    mat.depthTest = three
    mat.depthWrite = three
    mat.opacity = e.opacity
    m.updateMatrixWorld(true)
    // shadow = projection of the board along the light onto z = 0
    const k = three ? SHADOW_3D : 1
    const proj = new THREE.Matrix4().set(1, 0, -LIGHT.x * k, 0, 0, 1, -LIGHT.y * k, 0, 0, 0, 0, 0.001, 0, 0, 0, 1)
    e.shadow.matrix.multiplyMatrices(proj, m.matrixWorld)
    e.shadow.matrixWorldNeedsUpdate = true
    e.shadow.visible = m.visible && e.opacity > 0.05
  }

  private updateGlow(e: BoardEntry) {
    const want = e.p.required
    if (want && !e.glow) {
      const pad = GLOW_PAD
      const g = new THREE.Mesh(
        roundedRectGeometry(e.p.w + pad * 2, e.p.h + pad * 2, CORNER_THICK + pad),
        basicMat('#ffffff', { transparent: true, opacity: 0.45 }),
      )
      g.renderOrder = RO.glow
      g.position.z = -0.002
      e.mesh.add(g)
      e.glow = g
    } else if (!want && e.glow) {
      e.mesh.remove(e.glow)
      e.glow.material.dispose()
      e.glow = null
    }
    if (e.glow) {
      const pad = GLOW_PAD
      e.glow.geometry = roundedRectGeometry(e.p.w + pad * 2, e.p.h + pad * 2, CORNER_THICK + pad)
      e.glow.material.depthTest = this.rig.mode === '3d'
    }
  }

  private updateHoverOverlays() {
    const model = this.model
    const L = this.layout
    if (!model || !L) return
    const byBoard = new Map<string, Pos[]>()
    for (const h of model.highlights) {
      if (h.kind !== 'hover') continue
      const k = boardKey(h.pos.l, h.pos.t)
      let a = byBoard.get(k)
      if (!a) byBoard.set(k, (a = []))
      a.push(h.pos)
    }
    const key = [...byBoard.entries()].map(([k, v]) => k + v.map((p) => `${p.x},${p.y}`).join('/')).join('|')
    if (key === this.hoverKey) return
    this.hoverKey = key
    for (const e of this.entries.values()) {
      for (const h of e.hover) {
        e.mesh.remove(h)
        h.geometry.dispose()
      }
      e.hover = []
    }
    for (const [k, list] of byBoard) {
      const e = this.entries.get(k)
      if (!e) continue
      for (const pos of list) {
        const o = squareOffset(e.p, pos.x, pos.y, L.flip)
        const m = new THREE.Mesh(new THREE.PlaneGeometry(e.p.square, e.p.square), this.hoverMat)
        m.position.set(o.x, o.y, 0.001)
        m.renderOrder = RO.hover
        e.mesh.add(m)
        e.hover.push(m)
      }
    }
  }

  /** Re-draws board textures that are stale, within a time budget. */
  private updateTextures(): boolean {
    const L = this.layout
    if (!L) return false
    const cam = this.rig.camera
    const frustum = new THREE.Frustum().setFromProjectionMatrix(
      new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse),
    )
    const dpr = this.gl.getPixelRatio()
    const ready = piecesReady()
    const sphere = new THREE.Sphere()
    const jobs: { e: BoardEntry; tier: number; key: string; vis: boolean }[] = []
    for (const e of this.entries.values()) {
      sphere.center.copy(e.mesh.position)
      sphere.radius = Math.max(e.p.w, e.p.h) * 0.75
      const vis = frustum.intersectsSphere(sphere)
      e.inView = vis
      const px = this.rig.pxPerUnitAt(e.mesh.position) * dpr * Math.max(e.p.w, e.p.h)
      let tier = TIERS[TIERS.length - 1]
      for (const t of TIERS) {
        if (t >= px * 0.95) {
          tier = t
          break
        }
      }
      if (!vis) tier = Math.min(tier, e.tier || 128, 256)
      // hysteresis: keep a higher tier unless it is 4x too large
      if (vis && e.tier > tier && e.tier <= tier * 2) tier = e.tier
      const key = textureKey(e.p, L.flip, 0, ready)
      if (e.drawnBoard !== e.p.board || e.drawnKey !== key || e.tier !== tier) {
        if (!vis && e.texture && e.drawnBoard === e.p.board && e.drawnKey === key && e.tier < tier) continue
        jobs.push({ e, tier, key, vis })
      }
    }
    if (!jobs.length) return false
    jobs.sort((a, b) => Number(b.vis) - Number(a.vis) || Number(!!a.e.texture) - Number(!!b.e.texture))
    const start = performance.now()
    let i = 0
    for (; i < jobs.length; i++) {
      const j = jobs[i]
      const elapsed = performance.now() - start
      const first = !j.e.texture
      if (elapsed > 10 && !(first && elapsed < 60)) break
      // boards that have never been drawn get a cheap texture first when off-screen
      const tier = first && !j.vis ? Math.min(j.tier, 128) : j.tier
      this.drawEntry(j.e, tier, j.key)
    }
    return i < jobs.length || jobs.some((j) => !j.vis && !j.e.texture)
  }

  private drawEntry(e: BoardEntry, tier: number, key: string) {
    const L = this.layout!
    const { cw, ch } = canvasSize(e.p, tier)
    let canvas = e.canvas
    let tex = e.texture
    if (!canvas || !tex || tex.image !== canvas || canvas.width !== cw || canvas.height !== ch) {
      tex?.dispose()
      canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      drawBoard(canvas, e.p, L.flip, tier)
      tex = new THREE.CanvasTexture(canvas)
      tex.colorSpace = THREE.SRGBColorSpace
      tex.anisotropy = Math.min(8, this.gl.capabilities.getMaxAnisotropy())
      tex.minFilter = THREE.LinearMipmapLinearFilter
      tex.magFilter = THREE.LinearFilter
      tex.generateMipmaps = true
      e.canvas = canvas
      e.texture = tex
      e.mesh.material.map = tex
      e.mesh.material.needsUpdate = true
    } else {
      drawBoard(canvas, e.p, L.flip, tier)
      tex.needsUpdate = true
    }
    e.drawnBoard = e.p.board
    e.drawnKey = key
    e.tier = tier
    if (!e.mesh.visible) {
      e.mesh.visible = true
      e.shadow.visible = e.opacity > 0.05
    }
  }

  // -------------------------------------------------------------------------
  // Bands, bar, markers

  private bandEndValue(a: { from: number; to: number; start: number }, now: number) {
    const k = Math.min(1, (now - a.start) / BAND_MS)
    return a.from + (a.to - a.from) * easeOut(k)
  }

  private buildBands(now: number): boolean {
    const L = this.layout
    if (!L) return false
    let animating = false
    const shadow: number[] = []
    const rims: Record<BandStyle, number[]> = { active: [], white: [], black: [] }
    const bodies: Record<BandStyle, number[]> = { active: [], white: [], black: [] }
    for (const tl of L.timelines) {
      let endX = tl.endX
      const a = this.bandEnds.get(tl.l)
      if (a) {
        endX = this.bandEndValue(a, now)
        if (now - a.start < BAND_MS) animating = true
        else this.bandEnds.delete(tl.l)
      }
      const { path, head } = this.bandShape(tl, endX)
      const rimPath = ribbonPositions(path, BAND_HALF + BAND_RIM)
      const headRim = offsetConvex(head, BAND_RIM)
      rims[tl.style].push(...rimPath)
      polygonPositions(headRim, 0, rims[tl.style])
      ribbonPositions(path, BAND_HALF, 0, bodies[tl.style])
      polygonPositions(head, 0, bodies[tl.style])
      // shadow = rim shape offset
      const off = (pts: Vec2[]) => pts.map((p) => ({ x: p.x + BAND_SHADOW.x, y: p.y + BAND_SHADOW.y }))
      ribbonPositions(off(path), BAND_HALF + BAND_RIM, 0, shadow)
      polygonPositions(off(headRim), 0, shadow)
    }
    setGeometry(this.bandShadow, shadow)
    for (const s of BAND_STYLES) {
      setGeometry(this.bandRims[s], rims[s])
      setGeometry(this.bandBodies[s], bodies[s])
    }
    return animating
  }

  private bandShape(tl: TimelinePlacement, endX: number): { path: Vec2[]; head: Vec2[] } {
    const baseX = endX + HEAD_BASE
    const path = tl.path.slice()
    // replace the final point with the (possibly animated) head base
    const last = path[path.length - 1]
    path[path.length - 1] = { x: Math.max(baseX, path.length > 2 ? path[path.length - 2].x + 0.01 : -Infinity), y: last.y }
    if (path.length === 2 && path[0].x > path[1].x - 0.01) path[0] = { x: path[1].x - 0.01, y: path[0].y }
    const y = tl.y
    const head: Vec2[] = [
      { x: path[path.length - 1].x, y: y + (tl.head[0].y - y) },
      { x: path[path.length - 1].x + (HEAD_TIP - HEAD_BASE), y },
      { x: path[path.length - 1].x, y: y + (tl.head[2].y - y) },
    ]
    return { path, head }
  }

  private makeBarTexture(color: 'white' | 'black'): THREE.CanvasTexture {
    // body + edge lines only; the text is drawn by separate label planes
    const k = 320
    const c = document.createElement('canvas')
    c.width = Math.round(BAR_WIDTH * k)
    c.height = 4
    const ctx = c.getContext('2d')!
    const light = color === 'white'
    ctx.fillStyle = light ? COLORS.barLightEdge : COLORS.barDarkEdge
    ctx.fillRect(0, 0, c.width, c.height)
    const edge = Math.round(BAR_EDGE * k)
    ctx.fillStyle = light ? COLORS.barLight : COLORS.barDark
    ctx.fillRect(edge, 0, c.width - 2 * edge, c.height)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    return tex
  }

  /** White "The Present" (tinted per bar colour), rotated to read top to bottom. */
  private buildLabelTexture() {
    const k = 320 // px per world unit
    const font = `italic 400 ${Math.round(BAR_TEXT_SIZE * k)}px "EB Garamond", Garamond, "Times New Roman", serif`
    const c = document.createElement('canvas')
    const ctx0 = c.getContext('2d')!
    ctx0.font = font
    const m = ctx0.measureText('The Present')
    const left = m.actualBoundingBoxLeft || 0
    const textW = (m.actualBoundingBoxRight || m.width) + left
    const pad = Math.round(0.04 * k)
    c.width = Math.round(BAR_WIDTH * k)
    c.height = Math.ceil(textW + 2 * pad)
    const ctx = c.getContext('2d')!
    ctx.translate(c.width / 2, pad + left)
    ctx.rotate(Math.PI / 2)
    ctx.fillStyle = '#ffffff'
    ctx.font = font
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'left'
    ctx.fillText('The Present', 0, -BAR_TEXT_SIZE * k * 0.06)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = 4
    this.labelMat.map?.dispose()
    this.labelMat.map = tex
    this.labelMat.needsUpdate = true
    this.labelLen = c.height / k
    this.labelGeo?.dispose()
    this.labelGeo = new THREE.PlaneGeometry(BAR_WIDTH, this.labelLen)
    for (const o of this.labelGroup.children) (o as THREE.Mesh).geometry = this.labelGeo
  }

  private placeBar() {
    const L = this.layout
    if (!L) return
    // the bar body covers the visible region generously
    const cy = this.rig.state.cy
    const view = this.rig.mode === '3d' ? this.rig.distance() * 6 : this.rig.height / this.rig.state.zoom
    const span = Math.max(60, view * 3)
    this.bar.scale.set(1, span, 1)
    this.bar.position.set(this.barX, cy, 0)
    this.barShadow.scale.set(1, span, 1)
    this.barShadow.position.set(this.barX + BAR_SHADOW.x, cy + BAR_SHADOW.y, 0)
    for (const m of this.markerGroup.children) m.position.x = this.barX - L.presentX
    this.placeLabels(cy - span / 2, cy + span / 2)
  }

  /**
   * Lays out complete "The Present" labels along the bar: never overlapping each
   * other, the present markers or boards in the present column. As in the game
   * (01.png), the text sits just beyond the markers and repeats outwards.
   */
  private placeLabels(lo: number, hi: number) {
    const L = this.layout!
    const len = this.labelLen
    const period = len + BAR_TEXT_GAP
    const obstacles: [number, number][] = []
    const mr = MARKER_RADIUS + MARKER_RIM + LABEL_MARGIN_MARKER
    for (const mk of L.markers) obstacles.push([mk.y - mr, mk.y + mr])
    for (const e of this.entries.values()) {
      if (Math.abs(e.p.x - L.presentX) > 1e-6) continue
      obstacles.push([e.p.y - e.p.h / 2 + BOARD_SHADOW.y - LABEL_MARGIN_BOARD, e.p.y + e.p.h / 2 + LABEL_MARGIN_BOARD])
    }
    obstacles.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const o of obstacles) {
      const last = merged[merged.length - 1]
      if (last && o[0] <= last[1]) last[1] = Math.max(last[1], o[1])
      else merged.push([o[0], o[1]])
    }
    const spans: [number, number][] = [] // [bottom, top] of each label
    const push = (bottom: number) => {
      if (bottom + len >= lo && bottom <= hi) spans.push([bottom, bottom + len])
    }
    if (!merged.length) {
      for (let k = Math.floor(lo / period) - 1; k * period <= hi; k++) push(k * period)
    } else {
      const top = merged[merged.length - 1][1]
      const bottom = merged[0][0]
      // above the highest obstacle, repeating upwards
      for (let k = Math.max(0, Math.floor((lo - top - len) / period)); top + k * period <= hi; k++) push(top + k * period)
      // below the lowest obstacle, repeating downwards
      for (let k = Math.max(0, Math.floor((bottom - hi - len) / period)); bottom - len - k * period >= lo - len; k++)
        push(bottom - len - k * period)
      // gaps between obstacles: as many copies as fit, centred
      for (let i = 0; i + 1 < merged.length; i++) {
        const a = merged[i][1]
        const b = merged[i + 1][0]
        const free = b - a
        if (free < len) continue
        const n = Math.floor((free - len) / period) + 1
        const used = n * len + (n - 1) * BAR_TEXT_GAP
        for (let j = 0; j < n; j++) push(a + (free - used) / 2 + j * period)
      }
    }
    // sync the mesh pool
    const kids = this.labelGroup.children as THREE.Mesh[]
    while (kids.length < spans.length) {
      const m = new THREE.Mesh(this.labelGeo!, this.labelMat)
      m.renderOrder = RO.bar + 0.5
      m.frustumCulled = false
      this.labelGroup.add(m)
    }
    kids.forEach((m, i) => {
      const sp = spans[i]
      m.visible = !!sp
      if (sp) m.position.set(this.barX, (sp[0] + sp[1]) / 2, 0)
    })
    this.labelMat.color.set(L.presentColor === 'white' ? COLORS.barLightText : COLORS.barDarkText)
  }

  private buildMarkers() {
    const L = this.layout
    if (!L) return
    for (const c of [...this.markerGroup.children]) {
      const m = c as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>
      m.geometry.dispose()
      m.material.dispose()
      this.markerGroup.remove(m)
    }
    const add = (pos: number[], color: string, ro: number) => {
      const m = new THREE.Mesh(geometryFrom(pos), basicMat(color))
      m.renderOrder = ro
      m.frustumCulled = false
      this.markerGroup.add(m)
    }
    for (const mk of L.markers) {
      const white = mk.color === 'white'
      const x = L.presentX
      const y = mk.y
      add(circlePositions(x, y, MARKER_RADIUS + MARKER_RIM), white ? COLORS.markerWhiteRim : COLORS.markerBlackRim, RO.marker)
      add(circlePositions(x, y, MARKER_RADIUS), white ? COLORS.markerWhiteFill : COLORS.markerBlackFill, RO.marker + 0.1)
      if (mk.arrow) {
        const d = mk.dir
        const R = MARKER_RADIUS
        const shaft: Vec2[] = [
          { x: x - 0.33 * R, y: y - d * 1.0 * R },
          { x: x + 0.33 * R, y: y - d * 1.0 * R },
          { x: x + 0.33 * R, y: y - d * 0.1 * R },
          { x: x - 0.33 * R, y: y - d * 0.1 * R },
        ]
        const head: Vec2[] = [
          { x: x - 0.72 * R, y: y - d * 0.16 * R },
          { x: x + 0.72 * R, y: y - d * 0.16 * R },
          { x, y: y + d * 0.68 * R },
        ]
        const rimPos: number[] = []
        polygonPositions(offsetConvex(shaft, 0.012), 0, rimPos)
        polygonPositions(offsetConvex(head, 0.012), 0, rimPos)
        add(rimPos, COLORS.bandActiveRim, RO.marker + 0.2)
        const body: number[] = []
        polygonPositions(shaft, 0, body)
        polygonPositions(head, 0, body)
        add(body, COLORS.bandActive, RO.marker + 0.3)
      }
    }
  }

  // -------------------------------------------------------------------------
  // Arrows

  private squareWorld(pos: Pos, lift = 0): THREE.Vector3 | null {
    const L = this.layout
    const e = this.entries.get(boardKey(pos.l, pos.t))
    if (!L || !e) return null
    const o = squareOffset(e.p, pos.x, pos.y, L.flip)
    return e.mesh.localToWorld(new THREE.Vector3(o.x, o.y, lift))
  }

  private buildArrows() {
    const model = this.model
    const L = this.layout
    if (!model || !L) return
    const outline: number[] = []
    const cores: Record<string, number[]> = { 'last-move': [], pending: [], check: [] }
    const seen = new Set<string>()
    const list = [
      ...model.arrows,
      ...model.checks.map((c) => ({ from: c.from, to: c.to, kind: 'check' as const })),
    ]
    const three = this.rig.mode === '3d'
    const camPos = this.rig.persp.position
    for (const a of list) {
      const k = `${a.kind}|${a.from.l},${a.from.t},${a.from.x},${a.from.y}|${a.to.l},${a.to.t},${a.to.x},${a.to.y}`
      if (seen.has(k)) continue
      seen.add(k)
      const from = this.squareWorld(a.from)
      const to = this.squareWorld(a.to)
      if (!from || !to) continue
      const fe = this.entries.get(boardKey(a.from.l, a.from.t))!
      const sq = fe.p.square
      const len = from.distanceTo(to)
      if (len < 1e-6) continue
      const mid = from.clone().add(to).multiplyScalar(0.5)
      const sameBoard = a.from.l === a.to.l && a.from.t === a.to.t
      let pts: THREE.Vector3[]
      if (sameBoard) {
        pts = [from, to]
      } else if (three) {
        mid.z += len * 0.22
        pts = bezier3(from, mid, to, 32)
      } else {
        // the game's arcs read as lifted towards the light: bow down-left
        const bow = Math.min(len * 0.07, 0.6)
        mid.x -= bow * 0.6
        mid.y -= bow * 0.8
        pts = bezier3(from, mid, to, 32)
      }
      const view = three ? camPos.clone().sub(mid).normalize() : new THREE.Vector3(0, 0, 1)
      // pull the start in slightly from the square centre
      arrowPositions(
        pts,
        (ARROW_HALF + ARROW_OUTLINE) * sq,
        ARROW_HEAD_LEN * sq,
        (ARROW_HEAD_HALF + ARROW_OUTLINE * 1.6) * sq,
        view,
        outline,
        ARROW_OUTLINE * sq,
      )
      arrowPositions(pts, ARROW_HALF * sq, ARROW_HEAD_LEN * sq, ARROW_HEAD_HALF * sq, view, cores[a.kind])
    }
    setGeometry(this.arrowOutline, outline)
    for (const k of Object.keys(cores)) setGeometry(this.arrowCores[k], cores[k])
  }

  // -------------------------------------------------------------------------
  // Frame loop

  private requestRender() {
    if (this.frameRequested || this.disposed) return
    this.frameRequested = true
    requestAnimationFrame(this.frame)
  }

  private readonly frame = () => {
    this.frameRequested = false
    if (this.disposed) return
    const now = performance.now()
    let again = false
    if (this.rig.tick(now)) again = true

    // board animations
    let boardsMoved = false
    for (const e of this.entries.values()) {
      if (!e.anim) continue
      const k = Math.min(1, (now - e.anim.start) / NEW_BOARD_MS)
      const ek = easeOut(k)
      e.dispX = e.anim.fromX + (e.p.x - e.anim.fromX) * ek
      e.opacity = ek
      if (k >= 1) {
        e.anim = null
        e.dispX = e.p.x
        e.opacity = 1
      } else again = true
      this.placeEntry(e)
      boardsMoved = true
    }
    if (this.bandEnds.size) {
      if (this.buildBands(now)) again = true
    }
    if (this.barAnim) {
      const k = Math.min(1, (now - this.barAnim.start) / PRESENT_MS)
      this.barX = this.barAnim.from + (this.barAnim.to - this.barAnim.from) * easeOut(k)
      if (k >= 1) this.barAnim = null
      else again = true
    }

    const camKey = `${this.rig.mode}|${this.rig.state.cx.toFixed(4)}|${this.rig.state.cy.toFixed(4)}|${this.rig.state.zoom.toFixed(3)}`
    const camMoved = camKey !== this.lastCamKey
    this.lastCamKey = camKey
    if (boardsMoved || (camMoved && this.rig.mode === '3d')) this.buildArrows()

    // background follows the camera
    const s = this.rig.state
    const extent = this.rig.mode === '3d' ? this.rig.distance() * 30 + 50 : Math.max(this.rig.width, this.rig.height) / s.zoom + 4
    this.bg.scale.set(extent * 2, extent * 2, 1)
    this.bg.position.set(s.cx, s.cy, 0)
    this.placeBar()

    // pulsing required boards
    let pulsing = false
    if (this.model?.animations !== false) {
      const a = 0.4 + 0.3 * Math.sin(now / 260)
      for (const e of this.entries.values()) {
        if (e.glow) {
          e.glow.material.opacity = a
          if (e.inView) pulsing = true
        }
      }
    }

    if (this.updateTextures()) again = true
    this.texturesPending = again

    this.gl.render(this.scene, this.rig.camera)
    this.drawOverlay()

    if (again) this.requestRender()
    else if (pulsing && !this.pulseTimer) {
      this.pulseTimer = setTimeout(() => {
        this.pulseTimer = null
        this.requestRender()
      }, 40)
    }
  }

  /** Turn labels ("T1", "T2", ...) along the bottom of the screen. */
  private drawOverlay() {
    const L = this.layout
    const ctx = this.overlay.getContext('2d')!
    const dpr = this.gl.getPixelRatio()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height)
    if (!L) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const W = this.rig.width
    const H = this.rig.height
    const fontPx = Math.round(Math.min(30, Math.max(16, H * 0.026)))
    const by = H - fontPx * 1.15
    const ground = this.rig.screenToGround(W / 2, by)
    if (!ground) return
    const left = this.rig.screenToGround(0, by)
    const right = this.rig.screenToGround(W, by)
    if (!left || !right) return
    const cw = L.cellWidth
    const t0 = Math.floor((Math.min(left.x, right.x) - L.cellOrigin) / cw) - 1
    const t1 = Math.ceil((Math.max(left.x, right.x) - L.cellOrigin) / cw) + 1
    if (t1 - t0 > 400) return
    ctx.font = `700 ${fontPx}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    for (let T = Math.max(0, t0); T <= t1; T++) {
      const wx = L.cellOrigin + (T + 0.5) * cw
      const p = this.rig.project(new THREE.Vector3(wx, ground.y, 0))
      if (p.x < -50 || p.x > W + 50) continue
      // label colour = the other checker colour of the cell it sits on
      const g = this.rig.screenToGround(p.x, by)
      const gy = g ? g.y : ground.y
      const row = Math.floor(gy + 0.5 + L.rowOffset)
      const odd = (((T + row) % 2) + 2) % 2 === 1
      const [bgL, bgD] = this.bgColors()
      ctx.fillStyle = odd ? bgD : bgL
      ctx.fillText(`T${T}`, p.x, by)
    }
  }

  // -------------------------------------------------------------------------
  // Input

  private hitTest(px: number, py: number): { pos: Pos | null; onBoard: boolean } {
    const L = this.layout
    if (!L) return { pos: null, onBoard: false }
    if (this.rig.mode === '2d') {
      const g = this.rig.screenToGround(px, py)
      if (!g) return { pos: null, onBoard: false }
      for (const e of this.entries.values()) {
        if (!e.mesh.visible) continue
        const p = e.p
        const dx = g.x - e.dispX
        const dy = g.y - p.y
        if (Math.abs(dx) > p.w / 2 || Math.abs(dy) > p.h / 2) continue
        const sq = squareAt(p, dx / p.w + 0.5, dy / p.h + 0.5, L.flip)
        return { pos: sq ? { l: p.l, t: p.t, x: sq.x, y: sq.y } : null, onBoard: true }
      }
      return { pos: null, onBoard: false }
    }
    const ray = this.rig.setRay(px, py)
    const meshes: THREE.Object3D[] = []
    for (const e of this.entries.values()) if (e.mesh.visible) meshes.push(e.mesh)
    const hits = ray.intersectObjects(meshes, false)
    for (const h of hits) {
      const e = this.entries.get(h.object.userData.key as string)
      if (!e || !h.uv) continue
      const sq = squareAt(e.p, h.uv.x, h.uv.y, L.flip)
      return { pos: sq ? { l: e.p.l, t: e.p.t, x: sq.x, y: sq.y } : null, onBoard: true }
    }
    return { pos: null, onBoard: false }
  }

  private attachInput(canvas: HTMLCanvasElement) {
    const pointers = new Map<number, { x: number; y: number }>()
    let down: { x: number; y: number; time: number; id: number } | null = null
    let dragging = false
    let pinch: { dist: number; mx: number; my: number } | null = null
    let lastHover = ''
    const rel = (ev: PointerEvent | WheelEvent) => {
      const r = canvas.getBoundingClientRect()
      return { x: ev.clientX - r.left, y: ev.clientY - r.top }
    }
    const DRAG_PX = 5

    const setHover = (pos: Pos | null) => {
      const k = pos ? `${pos.l}:${pos.t}:${pos.x}:${pos.y}` : ''
      if (k === lastHover) return
      lastHover = k
      this.events.onSquareHover?.(pos)
    }

    const panFromTo = (ax: number, ay: number, bx: number, by: number) => {
      const a = this.rig.screenToGround(ax, ay)
      const b = this.rig.screenToGround(bx, by)
      if (a && b) this.rig.panBy(a.x - b.x, a.y - b.y)
    }

    const onDown = (ev: PointerEvent) => {
      if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1 && ev.button !== 2) return
      canvas.setPointerCapture?.(ev.pointerId)
      const p = rel(ev)
      pointers.set(ev.pointerId, p)
      this.rig.stopAnimation()
      if (pointers.size === 1) {
        down = { ...p, time: performance.now(), id: ev.pointerId }
        dragging = false
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
        down = null
        dragging = true
      }
    }
    const onMove = (ev: PointerEvent) => {
      const p = rel(ev)
      const prev = pointers.get(ev.pointerId)
      if (!prev) {
        if (ev.pointerType === 'mouse') setHover(this.hitTest(p.x, p.y).pos)
        return
      }
      pointers.set(ev.pointerId, p)
      if (pointers.size >= 2 && pinch) {
        const [a, b] = [...pointers.values()]
        const dist = Math.hypot(a.x - b.x, a.y - b.y)
        const mx = (a.x + b.x) / 2
        const my = (a.y + b.y) / 2
        panFromTo(pinch.mx, pinch.my, mx, my)
        if (pinch.dist > 0 && dist > 0) this.rig.zoomAt(dist / pinch.dist, mx, my)
        pinch = { dist, mx, my }
        this.requestRender()
        return
      }
      if (down && !dragging && Math.hypot(p.x - down.x, p.y - down.y) > DRAG_PX) {
        dragging = true
        panFromTo(down.x, down.y, p.x, p.y)
        this.requestRender()
        return
      }
      if (dragging) {
        panFromTo(prev.x, prev.y, p.x, p.y)
        this.requestRender()
      } else if (ev.pointerType === 'mouse') setHover(this.hitTest(p.x, p.y).pos)
    }
    const onUp = (ev: PointerEvent) => {
      const p = rel(ev)
      const had = pointers.delete(ev.pointerId)
      if (!had) return
      if (pointers.size < 2) pinch = null
      if (down && down.id === ev.pointerId && !dragging && (ev.pointerType !== 'mouse' || ev.button === 0)) {
        const hit = this.hitTest(p.x, p.y)
        if (hit.pos) this.events.onSquareClick?.(hit.pos)
        else if (!hit.onBoard) this.events.onBackgroundClick?.()
      }
      if (pointers.size === 0) {
        down = null
        dragging = false
      } else if (pointers.size === 1) {
        // continue panning with the remaining finger
        const [id, q] = [...pointers.entries()][0]
        down = { x: q.x, y: q.y, time: performance.now(), id }
        dragging = true
      }
    }
    const onCancel = (ev: PointerEvent) => {
      pointers.delete(ev.pointerId)
      if (pointers.size < 2) pinch = null
      if (pointers.size === 0) {
        down = null
        dragging = false
      }
    }
    const onLeave = () => {
      if (pointers.size === 0) setHover(null)
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      const p = rel(ev)
      let dy = ev.deltaY
      if (ev.deltaMode === 1) dy *= 16
      else if (ev.deltaMode === 2) dy *= this.rig.height
      const k = ev.ctrlKey ? 0.01 : 0.0018
      this.rig.zoomAt(Math.exp(-dy * k), p.x, p.y)
      this.requestRender()
    }
    const onContext = (ev: Event) => ev.preventDefault()

    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onCancel)
    canvas.addEventListener('pointerleave', onLeave)
    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('contextmenu', onContext)
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onCancel)
      canvas.removeEventListener('pointerleave', onLeave)
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('contextmenu', onContext)
    })
  }

  /** Debug/test hook: place the camera directly (world centre, CSS px per world unit). */
  setCamera(cx: number, cy: number, zoom: number, dur = 0): void {
    this.rig.animateTo({ cx, cy, zoom }, dur)
    this.requestRender()
  }

  /** Debug/test hook: true while textures or animations are still settling. */
  get busy(): boolean {
    return this.frameRequested || this.texturesPending || this.rig.animating
  }
}
