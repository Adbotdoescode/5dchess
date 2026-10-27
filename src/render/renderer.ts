// The Three.js multiverse renderer. See ./types.ts for the public contract.
//
// One scene serves the flat 2D view and the two 3D views (History / Parallel View,
// see ./views.ts): boards, slabs (bands and the Present bar), shadows and labels are
// all placed from the camera rig's current pose, so a view transition is simply the
// pose blending from one view to another while the boards rise or lie down.
//
// Layering: everything above the floor is drawn in the transparent pass, ordered by
// renderOrder (painter's order, as in 2D). In 3D the slabs and boards also depth-test
// so standing boards and raised tracks occlude each other correctly.

import * as THREE from 'three'
import '@fontsource/crimson-text/400-italic.css'
import type { Board, Piece, Pos } from '../engine/types'
import type { HudLayout, MotionBatch, MultiverseRenderer, PieceMotion, RenderModel, RendererEvents, ViewInsets, ViewMode, ViewState } from './types'
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
  LABEL_CAP,
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
import { type PieceOverride, canvasSize, drawBoard, textureKey } from './boardTexture'
import {
  type RibbonOut,
  alphaGeometry,
  arrowPositions,
  bezier3,
  circlePositions,
  disposeExtrudeCache,
  disposeGeometryCache,
  geometryFrom,
  offsetConvex,
  polygonAlpha,
  polygonPositions,
  ribbonAlpha,
  ribbonEdges,
  roundedPrismGeometry,
  roundedRectGeometry,
  wallsAlpha,
} from './geometry'
import { CameraRig, easeInOut, easeOut } from './camera'
import { BAND_HEIGHT, BAR_HEIGHT, BOARD_THICKNESS, boardMatrix, cameraBasis, lerp, light3D, type ViewPose } from './views'
import { loadPieceImages, pieceSprite, piecesReady } from './pieces'

// ---------------------------------------------------------------------------
// Layering (renderOrder).
const RO = {
  bg: 0,
  floorLabel: 0.5,
  barShadow: 1,
  bandShadow: 1.5,
  /** 3D: board shadows lie on the floor, under the raised slabs. */
  boardShadow3D: 1.6,
  barWall: 1.8,
  bar: 2,
  barDark: 2.05,
  barText: 2.5,
  marker: 3,
  bandWall: 4.5,
  bandRim: 5,
  band: 6,
  ghostBand: 6.6,
  boardShadow: 7,
  glow: 7.5,
  board: 8,
  boardTop: 8.02,
  hover: 9,
  arrowOutline: 10,
  arrow: 11,
  motion: 12,
}

/** 2D shadow "light": a point at height z is shadowed at (x, y) + z * LIGHT. */
const LIGHT = { x: BOARD_SHADOW.x / 0.1, y: BOARD_SHADOW.y / 0.1 }
/** 3D: shadow length per unit of height for standing boards, and for the slabs. */
const SHADOW_3D = 1.0
const SLAB_SHADOW_3D = 1.0
/** Pulsing halo around boards that must still be moved on. */
const GLOW_PAD = 0.026
/** 3D hover: the whole board turns green (measured from the recording: #478448 at ~57%). */
const HOVER_TINT = '#478448'
const HOVER_TINT_ALPHA = 0.57
/** Hover over a piece: green square; over a legal destination: a ghost of the selected piece. */
const HOVER_SQUARE = '#5f8f45'
const HOVER_SQUARE_ALPHA = 0.5
const GHOST_ALPHA = 0.5
/** Slab sides in 3D. */
const SLAB_SIDE = '#2e2e30'

const TIERS = [64, 128, 256, 512, 1024, 2048]
/** New board slide (recording: ~0.3-0.4 s, ease-out). */
const NEW_BOARD_MS = 340
/** The present bar slides and cross-fades once the boards have landed. */
const PRESENT_DELAY = 0.6
const PRESENT_MS = 260
/** Strength of the white veil over the board a new board slid out of. */
const VEIL_ALPHA = 0.72
/** Undo: boards slide back into their predecessor. */
const LEAVE_MS = 220
/** Moves of one action (e.g. the opponent's) play in sequence, this far apart. */
const MOVE_STAGGER = 300
/** Time-travel pieces fly along the arrow for this long. */
const TRAVEL_MS = 560
/** Flip Persp.: 2D squash / 3D darken-swing-undarken. */
const FLIP_2D_MS = 380
const FLIP_3D_MS = 540
const FLIP_DARK = 0.92
/** Texture work per frame (ms) once every board has a texture. */
const TEXTURE_BUDGET_MS = 6
/** Defer sharper/blurrier textures until the zoom has been still this long. */
const ZOOM_QUIET_MS = 140

/** Screens whose short side is below this get the touch-friendly framing (big present boards). */
const COMPACT_PX = 560
/** Camera limits: the target may rest this far (world units, ~1.5 boards) outside the multiverse. */
const PAN_MARGIN = 1.5
/** Zoomed fully out you see at least this many rows and columns (even for a tiny multiverse)... */
const MIN_VIEW_ROWS = 6
const MIN_VIEW_COLS = 8
/** ...or the whole multiverse plus this margin (world units) around it, whichever is more. */
const FIT_MARGIN = 1.5
/** Zoomed fully in, one board slot spans this multiple of the view's short side. */
const MAX_SLOT_VIEW = 1.6

const BAND_COLORS: Record<BandStyle, { body: string; rim: string }> = {
  active: { body: COLORS.bandActive, rim: COLORS.bandActiveRim },
  white: { body: COLORS.bandWhite, rim: COLORS.bandWhiteRim },
  black: { body: COLORS.bandBlack, rim: COLORS.bandBlackRim },
}
const BAND_STYLES: BandStyle[] = ['active', 'white', 'black']

const smooth = (t: number) => t * t * (3 - 2 * t)

type Mat = THREE.MeshBasicMaterial
type MeshB = THREE.Mesh<THREE.BufferGeometry, Mat>

interface BoardEntry {
  key: string
  p: BoardPlacement
  mesh: MeshB
  shadow: MeshB
  edge: MeshB
  canvas: HTMLCanvasElement | null
  texture: THREE.CanvasTexture | null
  drawnBoard: Board | null
  drawnKey: string
  tier: number
  /** Displayed position (animated). */
  dispX: number
  dispY: number
  opacity: number
  /** Slide in from (fromX, fromY), starting at `start`. */
  anim: { start: number; dur: number; fromX: number; fromY: number } | null
  /** The board a new one slid out of appears under a white veil that clears (as in the original). */
  fade: { start: number; dur: number } | null
  veil: MeshB | null
  /** Undo: slide back into the predecessor, then go away. */
  leaving: { start: number; dur: number; fromX: number; fromY: number; toX: number; toY: number } | null
  override: PieceOverride | null
  glow: MeshB | null
  hover: THREE.Mesh[]
  tint: MeshB | null
  inView: boolean
  center: THREE.Vector3
}

interface MotionSprite {
  mesh: MeshB
  start: number
  dur: number
  /** Board (key) the piece starts on and the square there; board it lands on and the square. */
  fromKey: string
  fromSq: Pos
  toKey: string
  toSq: Pos
  travel: boolean
  /** Texture override to clear once the piece has landed. */
  clearKey: string
  done: boolean
}

function basicMat(color: string, opts: THREE.MeshBasicMaterialParameters = {}) {
  return new THREE.MeshBasicMaterial({
    color: new THREE.Color(color),
    side: THREE.DoubleSide,
    // transparent + double-sided would make three draw (and re-flag) every object twice
    forceSinglePass: true,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    ...opts,
  })
}

function setGeometry(mesh: THREE.Mesh, g: THREE.BufferGeometry, hasData: boolean) {
  mesh.geometry.dispose()
  mesh.geometry = g
  mesh.visible = hasData
}

export class Renderer implements MultiverseRenderer {
  private readonly container: HTMLElement
  private readonly gl: THREE.WebGLRenderer
  private readonly dim: HTMLDivElement
  private readonly scene = new THREE.Scene()
  private readonly rig = new CameraRig()
  private events: RendererEvents = {}
  private model: RenderModel | null = null
  private layout: Layout | null = null
  private readonly entries = new Map<string, BoardEntry>()
  private readonly boardsGroup = new THREE.Group()
  private readonly planeCache = new Map<string, THREE.PlaneGeometry>()
  private readonly shadowMat = basicMat(COLORS.shadow)
  private readonly hoverSquareMat = basicMat(HOVER_SQUARE, { opacity: HOVER_SQUARE_ALPHA })

  // floor
  private readonly bg: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
  private readonly floorLabels = new THREE.Group()
  private readonly labelTextures = new Map<string, { tex: THREE.CanvasTexture; w: number; h: number }>()
  private floorLabelKey = ''
  private readonly labelUniforms: Record<string, THREE.IUniform>

  // the Present bar
  private readonly barShadow: MeshB
  private readonly barWall: MeshB
  private readonly bar: MeshB
  private readonly barDark: MeshB
  private barX = 0
  /** 0 = light (white to move), 1 = dark. */
  private barMix = 0
  private barAnim: { start: number; fromX: number; toX: number; fromMix: number; toMix: number } | null = null
  private readonly labelGroup = new THREE.Group()
  private readonly labelMat: Mat
  private labelGeo: THREE.PlaneGeometry | null = null
  private labelLen = 2.6

  // bands
  private readonly bandGroup = new THREE.Group()
  private readonly bandShadow: MeshB
  private readonly bandWalls: MeshB
  private readonly bandRims: Record<BandStyle, MeshB>
  private readonly bandBodies: Record<BandStyle, MeshB>
  private readonly ghostBand: MeshB
  /** Timelines whose end is moving: purple keeps the old end (null = new timeline) until `landAt`. */
  private bandAnims = new Map<number, { oldEnd: number | null; landAt: number }>()
  private bandKey = ''

  private readonly markerGroup = new THREE.Group()
  private markerKey = ''
  private readonly arrowGroup = new THREE.Group()
  private readonly arrowOutline: MeshB
  private readonly arrowCores: Record<string, MeshB>
  private arrowKey = ''

  // motion
  private readonly motionGroup = new THREE.Group()
  private motions: MotionSprite[] = []
  private lastMotionId: number | null = null
  private readonly spriteTextures = new Map<string, THREE.CanvasTexture>()
  private ghost: MeshB | null = null

  // view / flip
  private flip: { start: number; dur: number; dark: boolean; swapped: boolean } | null = null
  private pendingModel: RenderModel | null = null
  private poseKey = ''
  private slabDepth = false
  private boardDepth = false

  private frameRequested = false
  private pulseTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private firstModel = true
  private readonly resizeObserver: ResizeObserver
  private readonly cleanups: (() => void)[] = []
  private hoverKey = ''
  private hoverBoard = ''
  private pointer: { x: number; y: number } | null = null
  private lastCamKey = ''
  private texturesPending = false
  private lastZoomChange = 0
  private lastZoom = 0
  private insets: ViewInsets = { top: 0, right: 0, bottom: 0, left: 0 }
  private pendingFollow: { dx: number; dy: number } | null = null
  /** focusPresent / followPresent asked for while a flip still shows the old perspective. */
  private deferredFocus: 'present' | 'follow' | null = null
  private structKey = ''
  /** Boards whose matrices need recomputing next frame (besides animating ones / pose changes). */
  private readonly dirty = new Set<BoardEntry>()
  private tintKey = ''
  private obstacleLayout: Layout | null = null
  private obstacles: [number, number][] = []
  private inputEnabled = true

  constructor(container: HTMLElement) {
    this.container = container
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative'

    this.gl = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' })
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2.5))
    this.gl.setClearColor(new THREE.Color(COLORS.bgLight))
    const canvas = this.gl.domElement
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;touch-action:none;outline:none'
    container.appendChild(canvas)

    // Flip Persp. in 3D darkens the whole screen (HUD included, as in the original).
    this.dim = document.createElement('div')
    this.dim.style.cssText = 'position:fixed;inset:0;background:#000;opacity:0;pointer-events:none;z-index:30;display:none'
    container.appendChild(this.dim)

    // Background checkerboard (procedural, world-anchored)
    const checker = /* glsl */ `
      uniform vec3 cLight;
      uniform vec3 cDark;
      uniform float cellW;
      uniform float cellOrigin;
      uniform float rowOffset;
      float cellOdd(vec2 w) {
        float cx = floor((w.x - cellOrigin) / cellW);
        float cy = floor(w.y + 0.5 + rowOffset);
        return mod(cx + cy, 2.0);
      }`
    const uniforms = {
      cLight: { value: new THREE.Color(COLORS.bgLight) },
      cDark: { value: new THREE.Color(COLORS.bgDark) },
      cellW: { value: 2 },
      cellOrigin: { value: -0.5 },
      rowOffset: { value: 0 },
    }
    const bgMat = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: /* glsl */ `
        varying vec2 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xy;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        ${checker}
        varying vec2 vWorld;
        void main() {
          gl_FragColor = vec4(cellOdd(vWorld) > 0.5 ? cLight : cDark, 1.0);
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

    // Floor labels ("0L", "T1"): drawn in the other checker colour of the cell under them.
    this.labelUniforms = { ...uniforms, map: { value: null } }
    this.scene.add(this.floorLabels)

    // The Present bar: floor shadow, dark sides (3D), light and dark tops (cross-fade).
    this.barShadow = new THREE.Mesh(new THREE.PlaneGeometry(BAR_WIDTH, 1), this.shadowMat)
    this.barShadow.renderOrder = RO.barShadow
    this.barShadow.frustumCulled = false
    this.barWall = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), basicMat(SLAB_SIDE))
    this.barWall.renderOrder = RO.barWall
    this.barWall.frustumCulled = false
    this.bar = new THREE.Mesh(new THREE.PlaneGeometry(BAR_WIDTH, 1), basicMat('#ffffff', { map: this.makeBarTexture('white') }))
    this.bar.renderOrder = RO.bar
    this.bar.frustumCulled = false
    this.barDark = new THREE.Mesh(new THREE.PlaneGeometry(BAR_WIDTH, 1), basicMat('#ffffff', { map: this.makeBarTexture('black'), opacity: 0 }))
    this.barDark.renderOrder = RO.barDark
    this.barDark.frustumCulled = false
    this.scene.add(this.barShadow, this.barWall, this.bar, this.barDark)
    this.labelMat = basicMat('#ffffff')
    this.scene.add(this.labelGroup)
    this.buildLabelTexture()
    void document.fonts
      ?.load(`italic 400 64px "Crimson Text"`)
      .then(() => {
        if (this.disposed) return
        // the label size depends on the real font metrics: rebuild it (GPU sizes are immutable)
        this.buildLabelTexture()
        this.requestRender()
      })
      .catch(() => {})

    // Timeline bands (slabs in 3D)
    const mk = (color: string, ro: number, opts: THREE.MeshBasicMaterialParameters = {}) => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), basicMat(color, { vertexColors: true, ...opts }))
      m.renderOrder = ro
      m.frustumCulled = false
      this.bandGroup.add(m)
      return m
    }
    this.bandShadow = mk(COLORS.shadow, RO.bandShadow)
    this.bandWalls = mk(SLAB_SIDE, RO.bandWall)
    this.bandRims = {} as Record<BandStyle, MeshB>
    this.bandBodies = {} as Record<BandStyle, MeshB>
    BAND_STYLES.forEach((s, i) => {
      this.bandRims[s] = mk(BAND_COLORS[s].rim, RO.bandRim + i * 0.1)
      this.bandBodies[s] = mk(BAND_COLORS[s].body, RO.band + i * 0.1, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 })
    })
    this.ghostBand = mk('#8f8f8c', RO.ghostBand, { opacity: 0.42 })
    // the shadow lies on the floor; the slabs (bandGroup) are scaled in z with the pose
    this.bandGroup.remove(this.bandShadow)
    this.scene.add(this.bandShadow, this.bandGroup)

    this.scene.add(this.markerGroup)
    this.scene.add(this.boardsGroup)

    // Arrows
    this.arrowOutline = new THREE.Mesh(new THREE.BufferGeometry(), basicMat(COLORS.arrowOutline))
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
      const m = new THREE.Mesh(new THREE.BufferGeometry(), basicMat(c))
      m.renderOrder = RO.arrow + i * 0.1
      m.frustumCulled = false
      this.arrowCores[k] = m
      this.arrowGroup.add(m)
    })
    this.scene.add(this.arrowGroup)
    this.scene.add(this.motionGroup)

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
    const prev = this.model
    if (this.flip && !this.flip.swapped) {
      // the old perspective is still on screen until the middle of the flip
      this.pendingModel = model
      return
    }
    if (prev && !this.firstModel && model.perspective !== prev.perspective && model.animations) {
      this.pendingModel = model
      const dark = !this.rig.flat || resolveView(model) !== '2d'
      this.flip = { start: performance.now(), dur: dark ? FLIP_3D_MS : FLIP_2D_MS, dark, swapped: false }
      this.finishMotions()
      this.requestRender()
      return
    }
    if (prev && !this.firstModel && model.perspective !== prev.perspective) {
      // no animation: flip in place (rows mirror top <-> bottom), keep looking at the same boards
      this.mirrorCamera()
      this.applyModel(model, true)
      return
    }
    this.applyModel(model, false)
  }

  /** Rows mirror top <-> bottom on a perspective flip: move the camera to the same boards. */
  private mirrorCamera() {
    const ins = this.viewInsets()
    const off = this.rig.mode === '2d' ? (ins.top - ins.bottom) / 2 / this.rig.state.zoom : 0
    this.rig.stopAnimation()
    this.rig.state.cy = -this.rig.state.cy + 2 * off
    this.rig.update()
  }

  focusBoard(l: number, t: number, opts?: { instant?: boolean }): void {
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
    const minZoom = this.compact() ? this.tapZoom() : Math.min(this.rig.width, this.rig.height) / 5
    const zoom = Math.max(this.rig.goal.zoom, minZoom)
    const c = this.cameraCentreFor(x, y, zoom)
    this.rig.animateTo({ cx: c.x, cy: c.y, zoom }, opts?.instant ? 0 : 450)
    this.requestRender()
  }

  getView(): ViewState {
    const cam = this.rig.camera
    const vp = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)
    return {
      mode: this.rig.mode,
      transitioning: this.rig.transitioning,
      cx: this.rig.state.cx,
      cy: this.rig.state.cy,
      zoom: this.rig.state.zoom,
      elevation: this.rig.pose.elev,
      azimuth: this.rig.pose.azim,
      width: this.rig.width,
      height: this.rig.height,
      viewProjection: vp.toArray(),
    }
  }

  setInputEnabled(enabled: boolean): void {
    this.inputEnabled = enabled
    if (!enabled) {
      this.rig.releaseAll()
      this.hoverBoard = ''
      this.events.onSquareHover?.(null)
    }
    this.requestRender()
  }

  setHud(hud: HudLayout): void {
    const i = hud.insets
    const r = (v: number) => Math.max(0, Math.round(v))
    this.insets = { top: r(i.top), right: r(i.right), bottom: r(i.bottom), left: r(i.left) }
    this.requestRender()
  }

  focusPresent(): void {
    if (this.flip && !this.flip.swapped) {
      this.deferredFocus = 'present'
      return
    }
    this.focusPresentNow(500)
  }

  followPresent(): void {
    if (this.flip && !this.flip.swapped) {
      this.deferredFocus ??= 'follow'
      return
    }
    const targets = this.focusTargets()
    if (!targets.length) return
    this.followBoxes(targets.map((p) => this.boxOf(p)), 0, 0, 480, true)
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
    this.rig.setSize(w, h)
    this.updateZoomLimits()
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
    for (const m of this.motions) this.motionGroup.remove(m.mesh)
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.geometry?.dispose()
        const mat = m.material as THREE.Material | THREE.Material[]
        if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
        else mat?.dispose()
      }
    })
    this.bar.material.map?.dispose()
    this.barDark.material.map?.dispose()
    this.labelMat.map?.dispose()
    this.labelGeo?.dispose()
    for (const t of this.labelTextures.values()) t.tex.dispose()
    for (const t of this.spriteTextures.values()) t.dispose()
    for (const g of this.planeCache.values()) g.dispose()
    this.planeCache.clear()
    disposeGeometryCache()
    disposeExtrudeCache()
    this.gl.dispose()
    this.gl.domElement.remove()
    this.dim.remove()
  }

  // -------------------------------------------------------------------------
  // Model

  private applyModel(model: RenderModel, fromFlip: boolean): void {
    const prevModel = this.model
    const prev = this.layout
    const now = performance.now()
    const mode = resolveView(model)
    const viewChanged = mode !== this.rig.mode
    if (viewChanged) this.rig.setView(mode, model.animations && !this.firstModel ? undefined : 0)

    const sk = structureKey(model)
    const structural = sk !== this.structKey || !prev
    this.structKey = sk
    this.model = model
    const layout = computeLayout(model)
    this.layout = layout

    if (!structural) {
      // highlights / hover only: keep geometry, refresh placements (textures follow their keys)
      for (const p of layout.boards) {
        const e = this.entries.get(p.key)
        if (e) e.p = p
      }
      this.updateHoverOverlays()
      this.requestRender()
      return
    }

    const animate =
      model.animations && !this.firstModel && !fromFlip && !!prev && !!prevModel &&
      // the selection fade doesn't move boards; only the (legacy) parity packing does
      (prevModel.viewFilter === 'parallel') === (model.viewFilter === 'parallel') &&
      prevModel.perspective === model.perspective
    const motion = animate && model.motion && model.motion.id !== this.lastMotionId ? model.motion : null
    if (model.motion) this.lastMotionId = model.motion.id
    if (motion) this.finishMotions()

    // which move (index) made each new board, for sequencing the moves of one action
    const order = new Map<string, number>()
    if (motion && !motion.reverse) {
      motion.moves.forEach((m, i) => {
        order.set(boardKey(m.fromBoard.l, m.fromBoard.t), i)
        if (m.toBoard) order.set(boardKey(m.toBoard.l, m.toBoard.t), i)
      })
    }
    const stagger = (key: string) => (motion && motion.moves.length > 1 ? (order.get(key) ?? 0) * MOVE_STAGGER : 0)

    // Boards
    const seen = new Set<string>()
    const added: BoardPlacement[] = []
    const parents = new Map<string, { x: number; y: number; key: string | null }>()
    for (const p of layout.boards) {
      seen.add(p.key)
      let e = this.entries.get(p.key)
      if (e?.leaving) {
        // a board that was going away came back (redo): keep it
        e.leaving = null
        e.opacity = 1
      }
      if (!e) {
        e = this.createEntry(p)
        if (animate && prev) {
          const par = this.parentOf(p, layout)
          if (par) {
            parents.set(p.key, par)
            e.anim = { start: now + stagger(p.key), dur: NEW_BOARD_MS, fromX: par.x, fromY: par.y }
            e.dispX = par.x
            e.dispY = par.y
            // the board it slid out of fades in behind it (same timeline only)
            const pe = par.key ? this.entries.get(par.key) : undefined
            if (pe && pe.p.y === p.y && !pe.anim) {
              pe.fade = { start: now + stagger(p.key), dur: NEW_BOARD_MS * 1.1 }
              this.setVeil(pe, VEIL_ALPHA)
            }
          }
          added.push(p)
        }
      }
      e.p = p
      if (!e.anim) {
        e.dispX = p.x
        e.dispY = p.y
      }
      this.dirty.add(e)
      this.updateGlow(e)
    }
    const removed: BoardEntry[] = []
    for (const [k, e] of this.entries) {
      if (seen.has(k) || e.leaving) continue
      removed.push(e)
    }
    // Undo: boards created by the undone moves slide back into their predecessor
    const leavingKeys = new Set<string>()
    if (motion?.reverse) {
      for (const m of motion.moves) {
        leavingKeys.add(boardKey(m.fromBoard.l, m.fromBoard.t))
        if (m.toBoard) leavingKeys.add(boardKey(m.toBoard.l, m.toBoard.t))
      }
    }
    for (const e of removed) {
      const par = leavingKeys.has(e.key) ? this.parentOf(e.p, layout) : null
      if (par) {
        e.anim = null
        e.fade = null
        e.leaving = { start: now, dur: LEAVE_MS, fromX: e.dispX, fromY: e.dispY, toX: par.x, toY: par.y }
      } else this.removeEntry(e)
    }

    // Bands: timelines that grew keep their old end (purple) under a grey ghost until the board lands
    const prevEnds = new Map<number, number>()
    if (prev) for (const tl of prev.timelines) prevEnds.set(tl.l, tl.endX)
    if (animate) {
      for (const tl of layout.timelines) {
        const old = prevEnds.get(tl.l)
        if (old === tl.endX) continue
        const key = boardKey(tl.l, layout.boards.find((b) => b.l === tl.l && b.thick)?.t ?? 0)
        const landAt = now + stagger(key) + NEW_BOARD_MS
        if (old === undefined) this.bandAnims.set(tl.l, { oldEnd: null, landAt })
        else if (old < tl.endX) this.bandAnims.set(tl.l, { oldEnd: this.bandAnims.get(tl.l)?.oldEnd ?? old, landAt })
        else this.bandAnims.delete(tl.l)
      }
    } else this.bandAnims.clear()
    this.bandKey = ''
    this.buildBands(now)

    // Present bar: slides to its column and cross-fades once the new boards have landed
    const mix = layout.presentColor === 'white' ? 0 : 1
    const barMoves = prev && (prev.presentX !== layout.presentX || prev.presentColor !== layout.presentColor)
    if (animate && barMoves) {
      const maxStagger = added.reduce((m, p) => Math.max(m, stagger(p.key)), 0)
      const delay = added.length ? maxStagger + NEW_BOARD_MS * PRESENT_DELAY : 0
      this.barAnim = { start: now + delay, fromX: this.barX, toX: layout.presentX, fromMix: this.barMix, toMix: mix }
    } else if (!this.barAnim || !animate) {
      this.barAnim = null
      this.barX = layout.presentX
      this.barMix = mix
    } else {
      this.barAnim.toX = layout.presentX
      this.barAnim.toMix = mix
    }
    this.markerKey = ''
    this.buildMarkers()

    const u = this.bg.material.uniforms
    const [bgL, bgD] = this.bgColors()
    u.cLight.value.set(bgL)
    u.cDark.value.set(bgD)
    this.gl.setClearColor(new THREE.Color(bgL))
    u.cellW.value = layout.cellWidth
    u.cellOrigin.value = layout.cellOrigin
    u.rowOffset.value = layout.rowOffset
    this.buildFloorLabels()

    this.updateHoverOverlays()
    this.arrowKey = ''
    this.updateZoomLimits()

    if (motion) this.startMotions(motion, now, prevModel)

    if (this.firstModel) {
      this.firstModel = false
      this.focusPresentNow(0)
    } else if (animate && (added.length || removed.length)) {
      this.followChanges(added, parents, removed, now)
    }
    this.requestRender()
  }

  /** The board a new board slides out of: its predecessor on the timeline, or the branch point. */
  private parentOf(p: BoardPlacement, layout: Layout): { x: number; y: number; key: string | null } | null {
    const key = boardKey(p.l, p.t - 1)
    const same = layout.boardsByKey.get(key) ?? this.entries.get(key)?.p
    if (same) return { x: same.x, y: same.y, key }
    const tl = this.model?.snapshot.timelines.find((t) => t.l === p.l)
    if (tl?.branchedFrom && tl.startT === p.t) {
      const sk = boardKey(tl.branchedFrom.l, tl.branchedFrom.t)
      const src = layout.boardsByKey.get(sk)
      if (src) return { x: src.x, y: src.y, key: sk }
    }
    // unknown predecessor (e.g. parity-filtered view): come in from the left
    return { x: p.x - 1, y: p.y, key: null }
  }

  // -------------------------------------------------------------------------
  // Camera helpers

  /** Background checker colours [light, dark] for the model's background tint. */
  private bgColors(): [string, string] {
    return this.model?.background === 'ended' ? [COLORS.bgEndedLight, COLORS.bgEndedDark] : [COLORS.bgLight, COLORS.bgDark]
  }

  /** HUD insets, limited so at least half of each screen dimension stays usable. */
  private viewInsets(): ViewInsets {
    const w = this.rig.width
    const h = this.rig.height
    const i = this.insets
    const kx = Math.min(1, (w * 0.5) / Math.max(1, i.left + i.right))
    const ky = Math.min(1, (h * 0.5) / Math.max(1, i.top + i.bottom))
    return { top: i.top * ky, bottom: i.bottom * ky, left: i.left * kx, right: i.right * kx }
  }

  /** Phones and other small views: frame the present boards large enough to tap. */
  private compact(): boolean {
    return Math.min(this.rig.width, this.rig.height) < COMPACT_PX
  }

  /** Size (world units) of an end board, for the tap-friendly zoom. */
  private endBoardSize(): { w: number; h: number } {
    for (const p of this.layout?.boards ?? []) if (p.thick) return { w: p.w, h: p.h }
    return { w: 0.88, h: 0.88 }
  }

  /**
   * Zoom at which one board fills ~80% of the screen width (squares of ~32+ px on a
   * phone), as long as it still fits the space between the HUD elements.
   */
  private tapZoom(): number {
    const ins = this.viewInsets()
    const aw = this.rig.width - ins.left - ins.right
    const ah = this.rig.height - ins.top - ins.bottom
    const b = this.endBoardSize()
    return Math.min((0.8 * this.rig.width) / b.w, (0.94 * aw) / b.w, (0.9 * ah) / b.h)
  }

  /** Camera target that puts world point (x, y) in the middle of the area the HUD leaves free. */
  private cameraCentreFor(x: number, y: number, zoom: number): { x: number; y: number } {
    const ins = this.viewInsets()
    if (this.rig.mode !== '2d') return { x, y }
    return { x: x + (ins.right - ins.left) / 2 / zoom, y: y + (ins.top - ins.bottom) / 2 / zoom }
  }

  /**
   * Camera limits from the multiverse's extent: zoom out to the whole multiverse plus a
   * margin (or a few rows, for a small one), zoom in to about one board per screen, and
   * keep the target near the content (soft bounds, see CameraRig).
   */
  private updateZoomLimits() {
    const L = this.layout
    if (!L) return
    const b = L.bounds
    let minY = b.minY
    let maxY = b.maxY
    for (const mk of L.markers) {
      minY = Math.min(minY, mk.y - 0.5)
      maxY = Math.max(maxY, mk.y + 0.5)
    }
    const box = { minX: Math.min(b.minX, L.presentX - 0.5), maxX: Math.max(b.maxX, L.presentX + 0.5), minY, maxY }
    const w = this.rig.width
    const h = this.rig.height
    const fitAll = Math.min(w / (box.maxX - box.minX + 2 * FIT_MARGIN), h / (box.maxY - box.minY + 2 * FIT_MARGIN))
    const minZoom = Math.min(fitAll, h / MIN_VIEW_ROWS, w / MIN_VIEW_COLS)
    const maxZoom = Math.max(Math.min(w, h) * MAX_SLOT_VIEW, minZoom * 2)
    this.rig.setLimits({ box, margin: PAN_MARGIN, minZoom, maxZoom })
  }

  private focusPresentNow(dur: number) {
    const L = this.layout
    if (!L) return
    const b = L.presentBounds
    // the end boards of active timelines plus the present markers just beyond them
    let minX = b.minX - 0.3
    let maxX = b.maxX + 0.3
    let minY = b.minY - 0.15
    let maxY = b.maxY + 0.15
    const mr = MARKER_RADIUS + MARKER_RIM + 0.08
    for (const mk of L.markers) {
      minY = Math.min(minY, mk.y - mr)
      maxY = Math.max(maxY, mk.y + mr)
    }
    const w = this.rig.width
    const h = this.rig.height
    const ins = this.viewInsets()
    const aw = w - ins.left - ins.right
    const ah = h - ins.top - ins.bottom
    // never closer than the game's default framing (~5.3 rows on screen)
    let zoom = Math.min(aw / (maxX - minX), ah / (maxY - minY), h / 5.3)
    let cx = (minX + maxX) / 2
    let cy = (minY + maxY) / 2
    if (this.compact()) {
      // phones: one board ~80% of the screen width, centred on the boards to move on
      zoom = Math.max(zoom, this.tapZoom())
      const t = this.focusTargets()
      if (t.length) {
        const tMinX = Math.min(...t.map((p) => p.x - p.w / 2))
        const tMaxX = Math.max(...t.map((p) => p.x + p.w / 2))
        const tMinY = Math.min(...t.map((p) => p.y - p.h / 2))
        const tMaxY = Math.max(...t.map((p) => p.y + p.h / 2))
        cx = (tMinX + tMaxX) / 2
        cy = (tMinY + tMaxY) / 2
        if ((tMaxX - tMinX) * zoom > aw * 0.96 || (tMaxY - tMinY) * zoom > ah * 0.96) {
          // they don't all fit: centre the one nearest the middle of the group (Tab cycles the rest)
          let best = t[0]
          for (const p of t) if (Math.hypot(p.x - cx, p.y - cy) < Math.hypot(best.x - cx, best.y - cy)) best = p
          cx = best.x
          cy = best.y
        }
      }
    }
    if (this.rig.mode !== '2d') zoom *= 0.85
    zoom = Math.max(zoom, this.rig.minZoom)
    const c = this.cameraCentreFor(cx, cy, zoom)
    this.rig.animateTo({ cx: c.x, cy: c.y, zoom }, dur)
    this.requestRender()
  }

  /** Boards the player must move on, else the present end boards of active timelines. */
  private focusTargets(): BoardPlacement[] {
    const L = this.layout
    const model = this.model
    if (!L || !model) return []
    const req = model.requiredBoards.map((k) => L.boardsByKey.get(k)).filter((p): p is BoardPlacement => !!p)
    if (req.length) return req
    const present = L.boards.filter((p) => p.thick && Math.abs(p.x - L.presentX) < 1e-6)
    if (present.length) return present
    return L.boards.filter((p) => p.thick)
  }

  private boxOf(p: { x: number; y: number; w: number; h: number }) {
    return { minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minY: p.y - p.h / 2, maxY: p.y + p.h / 2 }
  }

  /**
   * The camera follows new boards (and boards going away on undo): it moves along with
   * the slide (one column forward per move, as in the original), then just enough to keep
   * the new boards, and if possible the boards still to be moved on, comfortably in view.
   */
  private followChanges(
    added: BoardPlacement[],
    parents: Map<string, { x: number; y: number; key: string | null }>,
    removed: BoardEntry[],
    now: number,
  ) {
    void now
    let lock = 0
    let n = 0
    const boxes: { minX: number; maxX: number; minY: number; maxY: number }[] = []
    for (const p of added) {
      const par = parents.get(p.key)
      boxes.push(this.boxOf(p))
      if (par && Math.abs(par.y - p.y) < 1e-6) {
        // the source board was on screen: keep the new board where it was
        if (this.onScreen(par.x, par.y)) {
          lock = Math.max(lock, p.x - par.x)
          n++
        }
      }
    }
    for (const e of removed) {
      if (!e.leaving) continue
      boxes.push(this.boxOf({ x: e.leaving.toX, y: e.leaving.toY, w: e.p.w, h: e.p.h }))
      if (this.onScreen(e.p.x, e.p.y)) {
        lock = Math.min(lock, e.leaving.toX - e.p.x)
        n++
      }
    }
    if (!boxes.length) return
    const req = this.focusTargets().map((p) => this.boxOf(p))
    this.followBoxes(boxes, n ? lock : 0, 0, NEW_BOARD_MS, false, req)
  }

  /** Is world point (x, y) inside the visible area (HUD excluded)? */
  private onScreen(x: number, y: number): boolean {
    const p = this.rig.project(new THREE.Vector3(x, y, 0))
    const ins = this.viewInsets()
    return p.visible && p.x > ins.left && p.x < this.rig.width - ins.right && p.y > ins.top && p.y < this.rig.height - ins.bottom
  }

  /**
   * Ease the camera by (lockX, lockY) plus the smallest extra pan that brings `boxes`
   * (and `extra`, when everything fits) inside the comfortable area. With `zoomOut`, zoom
   * out if the boxes don't fit. Deferred while the user is dragging.
   */
  private followBoxes(
    boxes: { minX: number; maxX: number; minY: number; maxY: number }[],
    lockX: number,
    lockY: number,
    dur: number,
    zoomOut: boolean,
    extra: { minX: number; maxX: number; minY: number; maxY: number }[] = [],
  ) {
    const goal = this.rig.goal
    const ins = this.viewInsets()
    const W = this.rig.width
    const H = this.rig.height
    const m = Math.min(W, H) * 0.05
    const safe = { x0: ins.left + m, x1: W - ins.right - m, y0: ins.top + m, y1: H - ins.bottom - m }
    // screen-space extent of boxes for a camera shifted to the goal + lock
    const shiftX = goal.cx - this.rig.state.cx + lockX
    const shiftY = goal.cy - this.rig.state.cy + lockY
    const extent = (list: typeof boxes) => {
      let x0 = Infinity
      let x1 = -Infinity
      let y0 = Infinity
      let y1 = -Infinity
      const v = new THREE.Vector3()
      const zMid = this.rig.pose.s * 0.4
      for (const b of list) {
        for (const [x, y] of [[b.minX, b.minY], [b.maxX, b.minY], [b.minX, b.maxY], [b.maxX, b.maxY]]) {
          for (const z of zMid > 0 ? [0, zMid * 2] : [0]) {
            const p = this.rig.project(v.set(x - shiftX, y - shiftY, z))
            x0 = Math.min(x0, p.x)
            x1 = Math.max(x1, p.x)
            y0 = Math.min(y0, p.y)
            y1 = Math.max(y1, p.y)
          }
        }
      }
      return { x0, x1, y0, y1 }
    }
    const fits = (e: { x0: number; x1: number; y0: number; y1: number }) => e.x1 - e.x0 <= safe.x1 - safe.x0 && e.y1 - e.y0 <= safe.y1 - safe.y0
    let ext = extent([...boxes, ...extra])
    if (!fits(ext)) ext = extent(boxes)
    let zoomK = 1
    if (!fits(ext) && zoomOut) {
      zoomK = Math.max(0.35, Math.min((safe.x1 - safe.x0) / (ext.x1 - ext.x0), (safe.y1 - safe.y0) / (ext.y1 - ext.y0)))
    }
    // screen overflow -> pan (centre what doesn't fit)
    const over = (lo: number, hi: number, s0: number, s1: number) => {
      if (hi - lo > s1 - s0) return (lo + hi) / 2 - (s0 + s1) / 2
      if (lo < s0) return lo - s0
      if (hi > s1) return hi - s1
      return 0
    }
    const ox = zoomK < 1 ? (ext.x0 + ext.x1) / 2 - (safe.x0 + safe.x1) / 2 : over(ext.x0, ext.x1, safe.x0, safe.x1)
    const oy = zoomK < 1 ? (ext.y0 + ext.y1) / 2 - (safe.y0 + safe.y1) / 2 : over(ext.y0, ext.y1, safe.y0, safe.y1)
    let dx = lockX
    let dy = lockY
    if (ox || oy) {
      const c = { x: W / 2, y: H / 2 }
      const a = this.rig.screenToGround(c.x, c.y)
      const b = this.rig.screenToGround(c.x + ox, c.y + oy)
      if (a && b) {
        dx += b.x - a.x
        dy += b.y - a.y
      }
    }
    if (Math.abs(dx) < 1e-4 && Math.abs(dy) < 1e-4 && zoomK === 1) return
    if (this.rig.holding) {
      // never fight a drag: follow once the user lets go
      this.pendingFollow = { dx: (this.pendingFollow?.dx ?? 0) + dx, dy: (this.pendingFollow?.dy ?? 0) + dy }
      return
    }
    const end = this.rig.goal
    // in step with the board slide when following one column; longer pans ease in and out
    const extraPx = Math.hypot(dx - lockX, dy - lockY) * end.zoom
    const long = extraPx > Math.min(W, H) * 0.25 || zoomK < 1
    this.rig.animateTo({ cx: end.cx + dx, cy: end.cy + dy, zoom: end.zoom * zoomK }, long ? Math.max(dur, 520) : dur, long ? easeInOut : easeOut)
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
      forceSinglePass: true,
      depthTest: false,
      depthWrite: false,
    })
    const mesh = new THREE.Mesh(this.planeGeometry(p.w, p.h), mat)
    mesh.renderOrder = RO.board
    mesh.userData.key = p.key
    mesh.matrixAutoUpdate = false
    mesh.visible = false // until it has a texture
    const shadow = new THREE.Mesh(roundedRectGeometry(p.w, p.h, this.cornerOf(p)), this.shadowMat)
    shadow.renderOrder = RO.boardShadow
    shadow.matrixAutoUpdate = false
    shadow.frustumCulled = false
    const edge = new THREE.Mesh(roundedPrismGeometry(p.w, p.h, this.cornerOf(p)), basicMat('#c9cabf'))
    edge.renderOrder = RO.board - 0.01
    edge.visible = false
    mesh.add(edge)
    this.boardsGroup.add(shadow, mesh)
    const e: BoardEntry = {
      key: p.key,
      p,
      mesh,
      shadow,
      edge,
      canvas: null,
      texture: null,
      drawnBoard: null,
      drawnKey: '',
      tier: 0,
      dispX: p.x,
      dispY: p.y,
      opacity: 1,
      anim: null,
      fade: null,
      veil: null,
      leaving: null,
      override: null,
      glow: null,
      hover: [],
      tint: null,
      inView: true,
      center: new THREE.Vector3(p.x, p.y, 0),
    }
    this.entries.set(p.key, e)
    return e
  }

  private cornerOf(p: BoardPlacement) {
    return p.thick || p.frame === 'pending' || p.frame === 'pending-move' || p.frame === 'check' ? CORNER_THICK : CORNER_THIN
  }

  private removeEntry(e: BoardEntry) {
    this.boardsGroup.remove(e.mesh, e.shadow)
    e.texture?.dispose()
    e.mesh.material.dispose()
    e.edge.material.dispose()
    if (e.glow) e.glow.material.dispose()
    if (e.tint) e.tint.material.dispose()
    if (e.veil) e.veil.material.dispose()
    for (const h of e.hover) h.geometry.dispose()
    this.entries.delete(e.key)
    if (this.hoverBoard === e.key) this.hoverBoard = ''
  }

  /** Positions the board mesh, its thickness and shadow for the current pose. */
  private placeEntry(e: BoardEntry, pose: ViewPose, lightX: number, lightY: number) {
    const p = e.p
    const m = e.mesh
    const geo = this.planeGeometry(p.w, p.h)
    if (m.geometry !== geo) m.geometry = geo
    const corner = this.cornerOf(p)
    const sg = roundedRectGeometry(p.w, p.h, corner)
    if (e.shadow.geometry !== sg) e.shadow.geometry = sg
    const eg = roundedPrismGeometry(p.w, p.h, corner)
    if (e.edge.geometry !== eg) e.edge.geometry = eg
    boardMatrix(pose, e.dispX, e.dispY, p.h, m.matrix)
    m.updateMatrixWorld(true)
    e.center.set(0, 0, 0).applyMatrix4(m.matrixWorld)
    const mat = m.material
    mat.opacity = e.opacity
    // thickness (3D)
    const th = BOARD_THICKNESS * pose.s
    e.edge.visible = th > 0.002 && m.visible
    if (e.edge.visible) {
      // behind the face (never coplanar with it)
      e.edge.position.z = -th - 0.002
      e.edge.scale.set(1, 1, th)
      e.edge.updateMatrixWorld(true)
      e.edge.material.opacity = e.opacity
      e.edge.material.color.set(edgeColor(p))
    }
    // shadow = projection of the board along the light onto the floor
    const proj = new THREE.Matrix4().set(1, 0, lightX, 0, 0, 1, lightY, 0, 0, 0, 0, 0.0005, 0, 0, 0, 1)
    e.shadow.matrix.multiplyMatrices(proj, m.matrixWorld)
    e.shadow.matrixWorldNeedsUpdate = true
    e.shadow.visible = m.visible && e.opacity > 0.5
    m.renderOrder = e.anim ? RO.boardTop : RO.board
    // flat: shadows over bands and bar (painter's order); 3D: on the floor, hidden under the slabs
    const shadowRO = this.slabDepth ? RO.boardShadow3D : RO.boardShadow
    e.shadow.renderOrder = e.anim ? shadowRO + 0.01 : shadowRO
  }

  private updateGlow(e: BoardEntry) {
    const want = e.p.required
    const pad = GLOW_PAD
    if (want && !e.glow) {
      const g = new THREE.Mesh(roundedRectGeometry(e.p.w + pad * 2, e.p.h + pad * 2, CORNER_THICK + pad), basicMat('#ffffff', { opacity: 0.45 }))
      g.renderOrder = RO.glow
      g.position.z = -0.003
      e.mesh.add(g)
      e.glow = g
    } else if (!want && e.glow) {
      e.mesh.remove(e.glow)
      e.glow.material.dispose()
      e.glow = null
    }
    if (e.glow) e.glow.geometry = roundedRectGeometry(e.p.w + pad * 2, e.p.h + pad * 2, CORNER_THICK + pad)
  }

  /** White veil over a board (0 = none). */
  private setVeil(e: BoardEntry, alpha: number) {
    if (alpha <= 0.001) {
      if (e.veil) {
        e.mesh.remove(e.veil)
        e.veil.material.dispose()
        e.veil = null
      }
      return
    }
    if (!e.veil) {
      const v = new THREE.Mesh(roundedRectGeometry(e.p.w, e.p.h, this.cornerOf(e.p)), basicMat('#ffffff', { opacity: alpha }))
      v.renderOrder = RO.board + 0.005
      v.position.z = 0.0015
      e.mesh.add(v)
      v.updateMatrixWorld(true)
      e.veil = v
    }
    e.veil.material.opacity = alpha
    e.veil.material.depthTest = this.boardDepth
  }

  /** Whole-board green tint while the pointer is over a board in a 3D view. */
  private updateTint(pose: ViewPose) {
    // with a piece selected the square under the pointer (ghost / green square) matters more
    const selecting = !!this.model?.highlights.some((h) => h.kind === 'selected')
    const show = pose.s > 0.5 && !selecting ? this.hoverBoard : ''
    const key = `${show}|${this.boardDepth}|${this.entries.size}`
    if (key === this.tintKey) return
    this.tintKey = key
    for (const e of this.entries.values()) {
      const want = e.key === show && !e.leaving
      if (want && !e.tint) {
        const t = new THREE.Mesh(roundedRectGeometry(e.p.w, e.p.h, this.cornerOf(e.p)), basicMat(HOVER_TINT, { opacity: HOVER_TINT_ALPHA }))
        t.renderOrder = RO.hover
        t.position.z = 0.002
        e.mesh.add(t)
        e.tint = t
      } else if (!want && e.tint) {
        e.mesh.remove(e.tint)
        e.tint.material.dispose()
        e.tint = null
      }
      if (e.tint) {
        e.tint.material.depthTest = this.boardDepth
        e.tint.updateMatrixWorld(true)
      }
    }
  }

  private spriteTexture(pc: Piece): THREE.CanvasTexture | null {
    const k = `${pc.color}${pc.type}`
    let t = this.spriteTextures.get(k)
    if (t) return t
    const c = pieceSprite(pc.type, pc.color, 256)
    if (!c) return null
    t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    this.spriteTextures.set(k, t)
    return t
  }

  private pieceAt(pos: Pos): Piece | null {
    const tl = this.model?.snapshot.timelines.find((t) => t.l === pos.l)
    const b = tl?.boards[pos.t - tl.startT]
    if (!b || pos.x < 0 || pos.y < 0 || pos.x >= b.width || pos.y >= b.height) return null
    return b.squares[pos.y * b.width + pos.x]
  }

  private updateHoverOverlays() {
    const model = this.model
    const L = this.layout
    if (!model || !L) return
    let hover: Pos | null = null
    let selected: Pos | null = null
    const dest = new Set<string>()
    for (const h of model.highlights) {
      if (h.kind === 'hover') hover = h.pos
      else if (h.kind === 'selected') selected = h.pos
      else if (h.kind === 'destination' || h.kind === 'capture') dest.add(`${h.pos.l}:${h.pos.t}:${h.pos.x}:${h.pos.y}`)
    }
    const hk = hover ? `${hover.l}:${hover.t}:${hover.x}:${hover.y}` : ''
    const key = `${hk}|${selected ? `${selected.l}:${selected.t}:${selected.x}:${selected.y}` : ''}|${dest.has(hk)}`
    if (key === this.hoverKey) return
    this.hoverKey = key
    for (const e of this.entries.values()) {
      for (const h of e.hover) {
        e.mesh.remove(h)
        h.geometry.dispose()
      }
      e.hover = []
    }
    if (this.ghost) {
      this.ghost.parent?.remove(this.ghost)
      this.ghost.geometry.dispose()
      this.ghost.material.dispose()
      this.ghost = null
    }
    if (!hover) return
    const e = this.entries.get(boardKey(hover.l, hover.t))
    if (!e) return
    const o = squareOffset(e.p, hover.x, hover.y, L.flip)
    const sel = selected ? this.pieceAt(selected) : null
    if (sel && dest.has(hk)) {
      // a ghost of the selected piece on the hovered destination (as in the original)
      const tex = this.spriteTexture(sel)
      if (tex) {
        const g = new THREE.Mesh(new THREE.PlaneGeometry(e.p.square, e.p.square), basicMat('#ffffff', { map: tex, opacity: GHOST_ALPHA }))
        g.position.set(o.x, o.y, 0.003)
        g.renderOrder = RO.hover + 0.1
        e.mesh.add(g)
        g.updateMatrixWorld(true)
        this.ghost = g
      }
    } else if (this.pieceAt(hover)) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(e.p.square, e.p.square), this.hoverSquareMat)
      m.position.set(o.x, o.y, 0.002)
      m.renderOrder = RO.hover
      e.mesh.add(m)
      m.updateMatrixWorld(true)
      e.hover.push(m)
    }
  }

  /** Re-draws board textures that are stale, within a time budget, uploading as it goes. */
  private updateTextures(now: number): boolean {
    const L = this.layout
    if (!L) return false
    const cam = this.rig.camera
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse))
    const dpr = this.gl.getPixelRatio()
    const ready = piecesReady()
    const sphere = new THREE.Sphere()
    const zoomBusy = now - this.lastZoomChange < ZOOM_QUIET_MS
    const jobs: { e: BoardEntry; tier: number; key: string; vis: boolean }[] = []
    for (const e of this.entries.values()) {
      sphere.center.copy(e.center)
      sphere.radius = Math.max(e.p.w, e.p.h) * 0.75
      const vis = frustum.intersectsSphere(sphere)
      e.inView = vis
      const px = this.rig.pxPerUnitAt(e.center) * dpr * Math.max(e.p.w, e.p.h)
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
      // while zooming, keep the current texture (no churn); only boards without one get drawn
      if (zoomBusy && e.texture && e.tier) tier = e.tier
      const key = textureKey(e.p, L.flip, 0, ready, e.override)
      if (e.drawnBoard !== e.p.board || e.drawnKey !== key || e.tier !== tier) {
        if (!vis && e.texture && e.drawnBoard === e.p.board && e.drawnKey === key && e.tier < tier) continue
        jobs.push({ e, tier, key, vis })
      }
    }
    if (!jobs.length) return false
    // content changes first (visible), then missing textures, then resolution changes
    jobs.sort(
      (a, b) =>
        Number(b.vis) - Number(a.vis) ||
        Number(!!a.e.texture) - Number(!!b.e.texture) ||
        Number(a.e.drawnKey === a.key) - Number(b.e.drawnKey === b.key),
    )
    const start = performance.now()
    let i = 0
    for (; i < jobs.length; i++) {
      const j = jobs[i]
      const elapsed = performance.now() - start
      const first = !j.e.texture
      if (i > 0 && elapsed > TEXTURE_BUDGET_MS && !(first && elapsed < 40)) break
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
      // a new canvas + texture: the old one stays on screen until this one is uploaded
      canvas = document.createElement('canvas')
      canvas.width = cw
      canvas.height = ch
      drawBoard(canvas, e.p, L.flip, tier, e.override)
      const next = new THREE.CanvasTexture(canvas)
      next.colorSpace = THREE.SRGBColorSpace
      next.anisotropy = Math.min(8, this.gl.capabilities.getMaxAnisotropy())
      next.minFilter = THREE.LinearMipmapLinearFilter
      next.magFilter = THREE.LinearFilter
      next.generateMipmaps = true
      this.gl.initTexture(next)
      tex?.dispose()
      tex = next
      e.canvas = canvas
      e.texture = tex
      e.mesh.material.map = tex
      e.mesh.material.needsUpdate = true
    } else {
      drawBoard(canvas, e.p, L.flip, tier, e.override)
      tex.needsUpdate = true
      this.gl.initTexture(tex)
    }
    e.drawnBoard = e.p.board
    e.drawnKey = key
    e.tier = tier
    if (!e.mesh.visible) {
      e.mesh.visible = true
      this.dirty.add(e)
    }
  }

  // -------------------------------------------------------------------------
  // Bands, bar, markers, labels

  private buildBands(now: number) {
    const L = this.layout
    if (!L) return
    let animState = ''
    for (const [l, a] of this.bandAnims) {
      if (now >= a.landAt) this.bandAnims.delete(l)
      else animState += `${l}:${a.oldEnd}|`
    }
    const key = `${L.timelines.length}|${animState}`
    if (key === this.bandKey) return
    this.bandKey = key
    const empty = (): RibbonOut => ({ pos: [], alpha: [] })
    const shadow = empty()
    const walls = empty()
    const ghost = empty()
    const rims: Record<BandStyle, RibbonOut> = { active: empty(), white: empty(), black: empty() }
    const bodies: Record<BandStyle, RibbonOut> = { active: empty(), white: empty(), black: empty() }
    L.timelines.forEach((tl, order) => {
      // later timelines (branch curves) a hair higher, so they draw over their parents
      const z = 1 + 0.004 * Math.min(order, 8)
      const a = this.bandAnims.get(tl.l)
      const finalShape = this.bandShape(tl, tl.endX)
      if (a) {
        ribbonAlpha(finalShape.path, finalShape.alphas, BAND_HALF, z + 0.05, ghost)
        polygonAlpha(finalShape.head, z + 0.05, ghost)
      }
      if (a && a.oldEnd === null) return
      const { path, alphas, head } = a ? this.bandShape(tl, a.oldEnd!) : finalShape
      const headRim = offsetConvex(head, BAND_RIM)
      ribbonAlpha(path, alphas, BAND_HALF + BAND_RIM, z, rims[tl.style])
      polygonAlpha(headRim, z, rims[tl.style])
      ribbonAlpha(path, alphas, BAND_HALF, z, bodies[tl.style])
      polygonAlpha(head, z, bodies[tl.style])
      // shadow: the rim shape on the floor (offset per pose in the frame loop)
      ribbonAlpha(path, alphas, BAND_HALF + BAND_RIM, 0, shadow)
      polygonAlpha(headRim, 0, shadow)
      // sides: along the rim outline
      const { left, right } = ribbonEdges(path, BAND_HALF + BAND_RIM)
      const outline = [...left, headRim[0], headRim[1], headRim[2], ...right.slice().reverse()]
      const oa = [...alphas, 1, 1, 1, ...alphas.slice().reverse()]
      wallsAlpha(outline, oa, 0, z, walls, true)
    })
    setGeometry(this.bandShadow, alphaGeometry(shadow), shadow.pos.length > 0)
    setGeometry(this.bandWalls, alphaGeometry(walls), walls.pos.length > 0)
    setGeometry(this.ghostBand, alphaGeometry(ghost), ghost.pos.length > 0)
    for (const s of BAND_STYLES) {
      setGeometry(this.bandRims[s], alphaGeometry(rims[s]), rims[s].pos.length > 0)
      setGeometry(this.bandBodies[s], alphaGeometry(bodies[s]), bodies[s].pos.length > 0)
    }
  }

  /** Band centre line (with the tail fade subdivided), per-point alphas and arrowhead for an end at endX. */
  private bandShape(tl: TimelinePlacement, endX: number): { path: Vec2[]; alphas: number[]; head: Vec2[] } {
    const baseX = endX + HEAD_BASE
    let path = tl.path.slice()
    // replace the final point with the (possibly animated) head base
    const last = path[path.length - 1]
    path[path.length - 1] = { x: Math.max(baseX, path.length > 2 ? path[path.length - 2].x + 0.01 : -Infinity), y: last.y }
    if (path.length === 2 && path[0].x > path[1].x - 0.01) path[0] = { x: path[1].x - 0.01, y: path[0].y }
    let alphas = path.map(() => 1)
    if (tl.tail > 0 && path.length >= 3) {
      // soft tail: subdivide the first segment with a smooth alpha ramp
      const a = path[0]
      const b = path[1]
      const n = 6
      const pts: Vec2[] = []
      const al: number[] = []
      for (let i = 0; i < n; i++) {
        const t = i / n
        pts.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
        al.push(smooth(t))
      }
      path = [...pts, ...path.slice(1)]
      alphas = [...al, ...path.slice(n).map(() => 1)]
    }
    const y = tl.y
    const hx = path[path.length - 1].x
    const head: Vec2[] = [
      { x: hx, y: y + (tl.head[0].y - y) },
      { x: hx + (HEAD_TIP - HEAD_BASE), y },
      { x: hx, y: y + (tl.head[2].y - y) },
    ]
    return { path, alphas, head }
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
    const font = `italic 400 ${Math.round(BAR_TEXT_SIZE * k)}px "Crimson Text", "EB Garamond", Garamond, "Times New Roman", serif`
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
    tex.anisotropy = 8
    this.labelMat.map?.dispose()
    this.labelMat.map = tex
    this.labelMat.needsUpdate = true
    this.labelLen = c.height / k
    this.labelGeo?.dispose()
    this.labelGeo = new THREE.PlaneGeometry(BAR_WIDTH, this.labelLen)
    for (const o of this.labelGroup.children) (o as THREE.Mesh).geometry = this.labelGeo
  }

  private placeBar(pose: ViewPose) {
    const L = this.layout
    if (!L) return
    const cy = this.rig.state.cy
    const view = this.rig.flat ? this.rig.height / this.rig.state.zoom / Math.max(0.05, this.rig.squash) : this.rig.viewRadius() * 2
    const span = Math.max(60, view * 3)
    const h = BAR_HEIGHT * pose.s
    this.bar.scale.set(1, span, 1)
    this.bar.position.set(this.barX, cy, h)
    this.barDark.scale.set(1, span, 1)
    this.barDark.position.set(this.barX, cy, h + 0.0001)
    this.barDark.material.opacity = this.barMix
    this.barDark.visible = this.barMix > 0.001
    this.bar.visible = this.barMix < 0.999
    this.barWall.visible = h > 0.002
    this.barWall.scale.set(BAR_WIDTH, span, h * 0.995)
    this.barWall.position.set(this.barX, cy, (h * 0.995) / 2)
    const sh = this.slabShadow(BAR_SHADOW, BAR_HEIGHT, pose)
    this.barShadow.scale.set(1, span, 1)
    this.barShadow.position.set(this.barX + sh.x, cy + sh.y, 0)
    for (const m of this.markerGroup.children) {
      m.position.x = this.barX - L.presentX
      m.position.z = h + 0.0004
    }
    this.placeLabels(cy - span / 2, cy + span / 2, h + 0.0002)
  }

  /** Floor offset of a slab's shadow: the 2D offset when flat, the camera-relative light in 3D. */
  private slabShadow(flat: { x: number; y: number }, height: number, pose: ViewPose): { x: number; y: number } {
    const l = light3D(pose, height * SLAB_SHADOW_3D)
    return { x: lerp(flat.x, l.x, pose.s), y: lerp(flat.y, l.y, pose.s) }
  }

  /**
   * Lays out complete "The Present" labels along the bar: never overlapping each
   * other, the present markers or boards in the present column. As in the game
   * (01.png), the text sits just beyond the markers and repeats outwards.
   */
  private placeLabels(lo: number, hi: number, z: number) {
    const L = this.layout!
    const len = this.labelLen
    const period = len + BAR_TEXT_GAP
    if (this.obstacleLayout !== L) {
      // markers and boards in the present column (recomputed only when the layout changes)
      this.obstacleLayout = L
      const obstacles: [number, number][] = []
      const mr = MARKER_RADIUS + MARKER_RIM + LABEL_MARGIN_MARKER
      for (const mk of L.markers) obstacles.push([mk.y - mr, mk.y + mr])
      for (const p of L.boards) {
        if (Math.abs(p.x - L.presentX) > 1e-6) continue
        obstacles.push([p.y - p.h / 2 + BOARD_SHADOW.y - LABEL_MARGIN_BOARD, p.y + p.h / 2 + LABEL_MARGIN_BOARD])
      }
      obstacles.sort((a, b) => a[0] - b[0])
      const merged: [number, number][] = []
      for (const o of obstacles) {
        const last = merged[merged.length - 1]
        if (last && o[0] <= last[1]) last[1] = Math.max(last[1], o[1])
        else merged.push([o[0], o[1]])
      }
      this.obstacles = merged
    }
    const merged = this.obstacles
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
      for (let k = Math.max(0, Math.floor((bottom - hi - len) / period)); bottom - len - k * period >= lo - len; k++) push(bottom - len - k * period)
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
      m.renderOrder = RO.barText
      m.frustumCulled = false
      this.labelGroup.add(m)
    }
    kids.forEach((m, i) => {
      const sp = spans[i]
      m.visible = !!sp
      if (sp) m.position.set(this.barX, (sp[0] + sp[1]) / 2, z)
    })
    // the text colour cross-fades with the bar
    const c = new THREE.Color(COLORS.barLightText).lerp(new THREE.Color(COLORS.barDarkText), this.barMix)
    this.labelMat.color.copy(c)
  }

  private buildMarkers() {
    const L = this.layout
    if (!L) return
    const key = JSON.stringify(L.markers) + L.presentX
    if (key === this.markerKey) return
    this.markerKey = key
    for (const c of [...this.markerGroup.children]) {
      const m = c as MeshB
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
        const { shaft, head } = markerArrow(x, y, mk.dir, MARKER_RADIUS)
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

  /** Faint timeline / turn labels lying on the floor (world-anchored, as in the original). */
  private buildFloorLabels() {
    const L = this.layout
    if (!L) return
    const key = JSON.stringify(L.labels)
    if (key === this.floorLabelKey) return
    this.floorLabelKey = key
    for (const c of [...this.floorLabels.children]) {
      const m = c as THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>
      m.geometry.dispose()
      m.material.dispose()
      this.floorLabels.remove(m)
    }
    for (const lb of L.labels) {
      const t = this.labelTexture(lb.text)
      const mat = new THREE.ShaderMaterial({
        uniforms: { ...this.labelUniforms, map: { value: t.tex } },
        vertexShader: /* glsl */ `
          varying vec2 vWorld;
          varying vec2 vUv;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xy;
            vUv = uv;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 cLight;
          uniform vec3 cDark;
          uniform float cellW;
          uniform float cellOrigin;
          uniform float rowOffset;
          uniform sampler2D map;
          varying vec2 vWorld;
          varying vec2 vUv;
          void main() {
            float cx = floor((vWorld.x - cellOrigin) / cellW);
            float cy = floor(vWorld.y + 0.5 + rowOffset);
            float odd = mod(cx + cy, 2.0);
            float a = texture2D(map, vUv).a;
            gl_FragColor = vec4(odd > 0.5 ? cDark : cLight, a);
            #include <colorspace_fragment>
          }`,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        forceSinglePass: true,
      })
      const m = new THREE.Mesh(new THREE.PlaneGeometry(t.w, t.h), mat)
      m.position.set(lb.align === 'right' ? lb.x - t.w / 2 : lb.x, lb.y, 0.0005)
      m.renderOrder = RO.floorLabel
      this.floorLabels.add(m)
    }
  }

  private labelTexture(text: string): { tex: THREE.CanvasTexture; w: number; h: number } {
    let t = this.labelTextures.get(text)
    if (t) return t
    const k = 400 // px per world unit
    const size = (LABEL_CAP / 0.72) * k
    const font = `700 ${Math.round(size)}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    const c = document.createElement('canvas')
    const ctx0 = c.getContext('2d')!
    ctx0.font = font
    const w = Math.ceil(ctx0.measureText(text).width + size * 0.2)
    const h = Math.ceil(size * 1.1)
    c.width = w
    c.height = h
    const ctx = c.getContext('2d')!
    ctx.font = font
    ctx.fillStyle = '#ffffff'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, w / 2, h / 2 + size * 0.04)
    const tex = new THREE.CanvasTexture(c)
    tex.anisotropy = 8
    t = { tex, w: w / k, h: h / k }
    this.labelTextures.set(text, t)
    return t
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

  /** Path between two squares on different boards: bowed down-left in 2D, lifted in 3D. */
  private arcPoints(from: THREE.Vector3, to: THREE.Vector3, s: number): THREE.Vector3[] {
    const len = from.distanceTo(to)
    const mid = from.clone().add(to).multiplyScalar(0.5)
    const bow = Math.min(len * 0.07, 0.6) * (1 - s)
    mid.x -= bow * 0.6
    mid.y -= bow * 0.8
    mid.z += len * 0.22 * s
    return bezier3(from, mid, to, 32)
  }

  private buildArrows(pose: ViewPose) {
    const model = this.model
    const L = this.layout
    if (!model || !L) return
    const outline: number[] = []
    const cores: Record<string, number[]> = { 'last-move': [], pending: [], check: [] }
    const seen = new Set<string>()
    // the original's 3D views show no history arrows (recording 65 / 72 s): only tentative and check arrows
    const history = pose.s < 0.5
    const list = [...model.arrows.filter((a) => history || a.kind !== 'last-move'), ...model.checks.map((c) => ({ from: c.from, to: c.to, kind: 'check' as const }))]
    const flat = this.rig.flat
    const toCam = cameraBasis(pose).forward.clone().negate()
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
      const sameBoard = a.from.l === a.to.l && a.from.t === a.to.t
      const pts = sameBoard ? [from, to] : this.arcPoints(from, to, pose.s)
      const view = flat ? new THREE.Vector3(0, 0, 1) : toCam
      arrowPositions(pts, (ARROW_HALF + ARROW_OUTLINE) * sq, ARROW_HEAD_LEN * sq, (ARROW_HEAD_HALF + ARROW_OUTLINE * 1.6) * sq, view, outline, ARROW_OUTLINE * sq)
      arrowPositions(pts, ARROW_HALF * sq, ARROW_HEAD_LEN * sq, ARROW_HEAD_HALF * sq, view, cores[a.kind])
    }
    setGeometry(this.arrowOutline, geometryFrom(outline), outline.length > 0)
    for (const k of Object.keys(cores)) setGeometry(this.arrowCores[k], geometryFrom(cores[k]), cores[k].length > 0)
  }

  // -------------------------------------------------------------------------
  // Piece motion

  private startMotions(batch: MotionBatch, now: number, prevModel: RenderModel | null) {
    const moves = batch.reverse ? batch.moves.slice().reverse() : batch.moves
    moves.forEach((m: PieceMotion, i) => {
      const delay = moves.length > 1 ? i * MOVE_STAGGER : 0
      const travel = !!m.toBoard && (m.to.l !== m.from.l || m.to.t !== m.from.t)
      const landing = m.toBoard ?? m.fromBoard
      const landKey = boardKey(landing.l, landing.t)
      // the moving piece: on the board it left (still in the snapshot as a past board)
      const piece = this.pieceAt(m.from) ?? (prevModel ? pieceIn(prevModel, m.from) : null)
      if (!piece) return
      const tex = this.spriteTexture(piece)
      if (!tex) return
      const L = this.layout!
      const dur = travel ? TRAVEL_MS : NEW_BOARD_MS
      let fromKey: string
      let fromSq: Pos
      let toKey: string
      let toSq: Pos
      let clearKey: string
      if (!batch.reverse) {
        fromKey = travel ? boardKey(m.from.l, m.from.t) : landKey
        fromSq = { ...m.from, l: travel ? m.from.l : landing.l, t: travel ? m.from.t : landing.t }
        toKey = landKey
        toSq = { ...m.to, l: landing.l, t: landing.t }
        clearKey = landKey
        const e = this.entries.get(landKey)
        if (!e) return
        // until the piece arrives, the landing board shows what stood there before
        const captured = this.pieceAt(m.to)
        const idx = m.to.y * e.p.board.width + m.to.x
        e.override = { hide: [idx], show: captured ? [{ idx, piece: captured }] : [] }
      } else {
        // undo: from the board going away back to the square it came from
        fromKey = landKey
        fromSq = { ...m.to, l: landing.l, t: landing.t }
        toKey = boardKey(m.from.l, m.from.t)
        toSq = m.from
        clearKey = toKey
        const e = this.entries.get(toKey)
        if (!e) return
        e.override = { hide: [m.from.y * e.p.board.width + m.from.x], show: [] }
      }
      const fe = this.entries.get(fromKey) ?? this.entries.get(toKey)
      const sqSize = fe?.p.square ?? L.boards[0]?.square ?? 0.1
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(sqSize, sqSize), basicMat('#ffffff', { map: tex }))
      mesh.renderOrder = RO.motion
      mesh.frustumCulled = false
      mesh.visible = false
      this.motionGroup.add(mesh)
      this.motions.push({ mesh, start: now + delay, dur, fromKey, fromSq, toKey, toSq, travel, clearKey, done: false })
    })
  }

  /** Advance piece sprites; returns true while any is still moving. */
  private updateMotions(now: number, pose: ViewPose): boolean {
    if (!this.motions.length) return false
    let active = false
    for (const mo of this.motions) {
      if (mo.done) continue
      const k = Math.min(1, Math.max(0, (now - mo.start) / mo.dur))
      const a = this.squareWorld(mo.fromSq)
      const b = this.squareWorld(mo.toSq)
      if (!a || !b || k >= 1) {
        this.endMotion(mo)
        continue
      }
      active = true
      mo.mesh.visible = now >= mo.start
      const e = easeOut(k)
      let p: THREE.Vector3
      if (mo.travel) {
        const pts = this.arcPoints(a, b, pose.s)
        const f = e * (pts.length - 1)
        const i = Math.min(pts.length - 2, Math.floor(f))
        p = pts[i].clone().lerp(pts[i + 1], f - i)
      } else p = a.clone().lerp(b, e)
      // face like the board it lands on, a touch in front of it
      const te = this.entries.get(mo.toKey) ?? this.entries.get(mo.fromKey)
      if (te) {
        const q = new THREE.Quaternion()
        te.mesh.matrixWorld.decompose(new THREE.Vector3(), q, new THREE.Vector3())
        mo.mesh.quaternion.copy(q)
        const n = new THREE.Vector3(0, 0, 1).applyQuaternion(q)
        p.addScaledVector(n, 0.01)
      }
      mo.mesh.position.copy(p)
      mo.mesh.updateMatrixWorld(true)
    }
    this.motions = this.motions.filter((m) => !m.done)
    return active
  }

  private endMotion(mo: MotionSprite) {
    mo.done = true
    this.motionGroup.remove(mo.mesh)
    mo.mesh.geometry.dispose()
    mo.mesh.material.dispose()
    const e = this.entries.get(mo.clearKey)
    if (e && !this.motions.some((o) => !o.done && o.clearKey === mo.clearKey)) e.override = null
  }

  /** Fast-forward every running animation (a new click, a new batch, a flip). */
  private finishMotions() {
    for (const mo of this.motions) if (!mo.done) this.endMotion(mo)
    this.motions = []
    for (const e of [...this.entries.values()]) {
      if (e.leaving) {
        this.removeEntry(e)
        continue
      }
      e.override = null
      if (e.anim) {
        e.anim = null
        e.dispX = e.p.x
        e.dispY = e.p.y
        this.dirty.add(e)
      }
      if (e.fade) {
        e.fade = null
        this.setVeil(e, 0)
      }
    }
    this.bandAnims.clear()
    this.bandKey = ''
    if (this.barAnim) {
      this.barX = this.barAnim.toX
      this.barMix = this.barAnim.toMix
      this.barAnim = null
    }
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

    // Flip Persp.: squash (2D) or darken (3D); the new perspective comes in at the middle
    const f = this.flip
    if (f) {
      const k = Math.min(1, (now - f.start) / f.dur)
      if (k >= 0.5 && !f.swapped) {
        f.swapped = true
        const m = this.pendingModel
        this.pendingModel = null
        if (m) {
          this.mirrorCamera()
          this.applyModel(m, true)
          this.poseKey = ''
        }
        const df = this.deferredFocus
        this.deferredFocus = null
        if (df === 'present') this.focusPresentNow(400)
        else if (df === 'follow') this.followPresent()
      }
      if (f.dark) {
        const a = k < 0.42 ? k / 0.42 : k < 0.58 ? 1 : (1 - k) / 0.42
        this.dim.style.display = 'block'
        this.dim.style.opacity = String(FLIP_DARK * smooth(Math.min(1, Math.max(0, a))))
        this.rig.squash = 1
      } else {
        this.rig.squash = Math.abs(Math.cos(Math.PI * k))
        this.rig.update()
      }
      if (k >= 1) {
        this.flip = null
        this.dim.style.display = 'none'
        this.rig.squash = 1
        this.rig.update()
        const m = this.pendingModel
        this.pendingModel = null
        if (m) this.applyModel(m, true)
      } else again = true
    }

    if (this.rig.tick(now)) again = true
    if (this.rig.state.zoom !== this.lastZoom) {
      this.lastZoom = this.rig.state.zoom
      this.lastZoomChange = now
    }
    const pose = this.rig.pose
    const poseKey = `${pose.elev.toFixed(5)}|${pose.azim.toFixed(5)}|${pose.yaw.toFixed(5)}|${pose.tilt.toFixed(5)}|${pose.s.toFixed(5)}`
    const poseChanged = poseKey !== this.poseKey
    this.poseKey = poseKey

    // depth testing for 3D (painter's order alone when flat)
    const slabDepth = pose.s > 0.15
    const boardDepth = pose.s > 0.01
    if (slabDepth !== this.slabDepth || boardDepth !== this.boardDepth || poseChanged) {
      this.slabDepth = slabDepth
      this.boardDepth = boardDepth
      const slabs: Mat[] = [this.bar.material, this.barDark.material, this.barWall.material, this.bandWalls.material]
      for (const s of BAND_STYLES) slabs.push(this.bandRims[s].material, this.bandBodies[s].material)
      for (const m of slabs) {
        m.depthTest = slabDepth
        m.depthWrite = slabDepth
      }
      for (const e of this.entries.values()) {
        e.mesh.material.depthTest = boardDepth
        e.mesh.material.depthWrite = boardDepth
        e.edge.material.depthTest = boardDepth
        e.edge.material.depthWrite = boardDepth
        if (e.glow) e.glow.material.depthTest = boardDepth
        this.dirty.add(e)
      }
      this.hoverSquareMat.depthTest = boardDepth
    }
    const l3 = light3D(pose, SHADOW_3D)
    const lightX = lerp(LIGHT.x, l3.x, pose.s)
    const lightY = lerp(LIGHT.y, l3.y, pose.s)

    // boards: slides, fades, undo
    let boardsMoved = false
    for (const e of [...this.entries.values()]) {
      let changed = false
      if (e.anim) {
        const k = Math.min(1, Math.max(0, (now - e.anim.start) / e.anim.dur))
        const ek = easeOut(k)
        e.dispX = e.anim.fromX + (e.p.x - e.anim.fromX) * ek
        e.dispY = e.anim.fromY + (e.p.y - e.anim.fromY) * ek
        if (k >= 1) {
          e.anim = null
          e.dispX = e.p.x
          e.dispY = e.p.y
        } else again = true
        changed = true
      }
      if (e.fade) {
        const k = Math.min(1, Math.max(0, (now - e.fade.start) / e.fade.dur))
        this.setVeil(e, VEIL_ALPHA * (1 - smooth(k)))
        if (k >= 1) e.fade = null
        else again = true
      }
      if (e.leaving) {
        const lv = e.leaving
        const k = Math.min(1, (now - lv.start) / lv.dur)
        const ek = easeOut(k)
        e.dispX = lv.fromX + (lv.toX - lv.fromX) * ek
        e.dispY = lv.fromY + (lv.toY - lv.fromY) * ek
        e.opacity = 1 - smooth(Math.max(0, (k - 0.5) / 0.5))
        if (k >= 1) {
          this.removeEntry(e)
          boardsMoved = true
          continue
        }
        again = true
        changed = true
      }
      if (changed || poseChanged || this.dirty.has(e)) {
        this.placeEntry(e, pose, lightX, lightY)
        boardsMoved = true
      }
    }
    this.dirty.clear()
    this.updateTint(pose)

    // bands: heights follow the pose; ghosts turn purple when their board lands
    if (this.bandAnims.size) {
      this.buildBands(now)
      if (this.bandAnims.size) again = true
    }
    const bandH = BAND_HEIGHT * pose.s
    this.bandGroup.scale.set(1, 1, Math.max(1e-5, bandH))
    this.bandWalls.visible = bandH > 0.002 && (this.bandWalls.geometry.getAttribute('position')?.count ?? 0) > 0
    const bs = this.slabShadow(BAND_SHADOW, BAND_HEIGHT, pose)
    this.bandShadow.position.set(bs.x, bs.y, 0)

    // the present bar
    const ba = this.barAnim
    if (ba) {
      const k = Math.min(1, Math.max(0, (now - ba.start) / PRESENT_MS))
      const ek = easeOut(k)
      this.barX = ba.fromX + (ba.toX - ba.fromX) * ek
      this.barMix = ba.fromMix + (ba.toMix - ba.fromMix) * smooth(k)
      if (k >= 1) this.barAnim = null
      else again = true
    }

    if (this.updateMotions(now, pose)) again = true

    const camKey = `${poseKey}|${this.rig.state.cx.toFixed(4)}|${this.rig.state.cy.toFixed(4)}|${this.rig.state.zoom.toFixed(3)}`
    const camMoved = camKey !== this.lastCamKey
    this.lastCamKey = camKey
    const ak = `${this.model?.arrows.length}|${this.model?.checks.length}|${pose.s < 0.5}`
    if (boardsMoved || (camMoved && !this.rig.flat) || this.arrowKey !== ak) {
      this.arrowKey = ak
      this.buildArrows(pose)
    }
    if (camMoved && !this.rig.flat && this.pointer && pose.s > 0.5) {
      // keep the 3D hover tint under a still pointer while the camera moves
      const hit = this.hitTest(this.pointer.x, this.pointer.y)
      this.hoverBoard = hit.key
    }

    // floor follows the camera
    const s = this.rig.state
    const extent = this.rig.flat ? Math.max(this.rig.width, this.rig.height) / s.zoom / Math.max(0.05, this.rig.squash) + 4 : this.rig.viewRadius() * 2.5 + 8
    this.bg.scale.set(extent * 2, extent * 2, 1)
    this.bg.position.set(s.cx, s.cy, 0)
    this.placeBar(pose)

    // pulsing required boards
    let pulsing = false
    if (this.model?.animations !== false) {
      const a = 0.4 + 0.3 * Math.sin(now / 260)
      for (const e of this.entries.values()) {
        if (e.glow) {
          e.glow.material.opacity = a * e.opacity
          if (e.inView) pulsing = true
        }
      }
    }

    if (this.updateTextures(now)) again = true
    if (now - this.lastZoomChange < ZOOM_QUIET_MS + 20) again = true // pick sharper textures once still
    this.texturesPending = again

    this.gl.render(this.scene, this.rig.camera)

    if (again) this.requestRender()
    else if (pulsing && !this.pulseTimer) {
      this.pulseTimer = setTimeout(() => {
        this.pulseTimer = null
        this.requestRender()
      }, 40)
    }
  }

  // -------------------------------------------------------------------------
  // Input

  private hitTest(px: number, py: number): { pos: Pos | null; onBoard: boolean; key: string } {
    const L = this.layout
    if (!L) return { pos: null, onBoard: false, key: '' }
    if (this.rig.flat) {
      const g = this.rig.screenToGround(px, py)
      if (!g) return { pos: null, onBoard: false, key: '' }
      // topmost first: a sliding board is drawn above the others
      const list = [...this.entries.values()].filter((e) => e.mesh.visible && !e.leaving && e.opacity > 0.3)
      list.sort((a, b) => Number(!!b.anim) - Number(!!a.anim))
      for (const e of list) {
        const p = e.p
        const dx = g.x - e.dispX
        const dy = g.y - e.dispY
        if (Math.abs(dx) > p.w / 2 || Math.abs(dy) > p.h / 2) continue
        const sq = squareAt(p, dx / p.w + 0.5, dy / p.h + 0.5, L.flip)
        return { pos: sq ? { l: p.l, t: p.t, x: sq.x, y: sq.y } : null, onBoard: true, key: e.key }
      }
      return { pos: null, onBoard: false, key: '' }
    }
    const ray = this.rig.setRay(px, py)
    const meshes: THREE.Object3D[] = []
    for (const e of this.entries.values()) if (e.mesh.visible && !e.leaving && e.opacity > 0.3) meshes.push(e.mesh)
    const hits = ray.intersectObjects(meshes, false)
    for (const h of hits) {
      const e = this.entries.get(h.object.userData.key as string)
      if (!e || !h.uv) continue
      const sq = squareAt(e.p, h.uv.x, h.uv.y, L.flip)
      return { pos: sq ? { l: e.p.l, t: e.p.t, x: sq.x, y: sq.y } : null, onBoard: true, key: e.key }
    }
    return { pos: null, onBoard: false, key: '' }
  }

  private attachInput(canvas: HTMLCanvasElement) {
    const pointers = new Map<number, { x: number; y: number }>()
    let down: { x: number; y: number; time: number; id: number } | null = null
    let dragging = false
    let pinch: { dist: number; mx: number; my: number } | null = null
    let lastHover = ''
    /** Recent drag samples (time, world target) for the release fling. */
    let trail: { t: number; x: number; y: number }[] = []
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
    const hover = (x: number, y: number) => {
      const hit = this.hitTest(x, y)
      if (hit.key !== this.hoverBoard) {
        this.hoverBoard = hit.key
        this.requestRender()
      }
      setHover(hit.pos)
    }

    const panFromTo = (ax: number, ay: number, bx: number, by: number) => {
      const a = this.rig.screenToGround(ax, ay)
      const b = this.rig.screenToGround(bx, by)
      // the drag sets where the camera goes; it follows smoothly every frame
      if (a && b) this.rig.dragBy(a.x - b.x, a.y - b.y)
      const now = performance.now()
      const g = this.rig.dragTarget
      trail.push({ t: now, x: g.x, y: g.y })
      trail = trail.filter((s) => now - s.t < 100)
    }

    const release = () => {
      this.rig.hold(false)
      if (!this.rig.holding) {
        // coast a little in the direction of the drag
        const now = performance.now()
        const recent = trail.filter((s) => now - s.t < 90)
        if (dragging && recent.length >= 2) {
          const a = recent[0]
          const b = recent[recent.length - 1]
          const dt = (b.t - a.t) / 1000
          if (dt > 0.008 && now - b.t < 50) this.rig.fling((b.x - a.x) / dt, (b.y - a.y) / dt)
        }
        trail = []
        const pf = this.pendingFollow
        if (pf) {
          this.pendingFollow = null
          this.rig.follow(pf.dx, pf.dy, NEW_BOARD_MS)
        }
      }
      this.requestRender()
    }

    const onDown = (ev: PointerEvent) => {
      if (!this.inputEnabled) return
      if (ev.pointerType === 'mouse' && ev.button !== 0 && ev.button !== 1 && ev.button !== 2) return
      canvas.setPointerCapture?.(ev.pointerId)
      const p = rel(ev)
      if (!pointers.has(ev.pointerId)) this.rig.hold(true)
      pointers.set(ev.pointerId, p)
      this.rig.stopAnimation()
      // a new click fast-forwards running move animations
      if (this.motions.length || [...this.entries.values()].some((e) => e.anim || e.leaving)) this.finishMotions()
      trail = []
      if (pointers.size === 1) {
        down = { ...p, time: performance.now(), id: ev.pointerId }
        dragging = false
      } else if (pointers.size === 2) {
        const [a, b] = [...pointers.values()]
        pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }
        down = null
        dragging = true
      }
      this.requestRender()
    }
    const onMove = (ev: PointerEvent) => {
      if (!this.inputEnabled) return
      const p = rel(ev)
      if (ev.pointerType === 'mouse') this.pointer = p
      const prev = pointers.get(ev.pointerId)
      if (!prev) {
        if (ev.pointerType === 'mouse') hover(p.x, p.y)
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
      } else if (ev.pointerType === 'mouse') hover(p.x, p.y)
    }
    const onUp = (ev: PointerEvent) => {
      const p = rel(ev)
      const had = pointers.delete(ev.pointerId)
      if (!had) return
      if (!this.inputEnabled) {
        release()
        down = null
        dragging = false
        return
      }
      if (pointers.size < 2) pinch = null
      if (down && down.id === ev.pointerId && !dragging && (ev.pointerType !== 'mouse' || ev.button === 0)) {
        const hit = this.hitTest(p.x, p.y)
        if (hit.pos) this.events.onSquareClick?.(hit.pos)
        else if (!hit.onBoard) this.events.onBackgroundClick?.()
      }
      release()
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
      if (pointers.delete(ev.pointerId)) this.rig.hold(false)
      this.requestRender()
      if (pointers.size < 2) pinch = null
      if (pointers.size === 0) {
        down = null
        dragging = false
        trail = []
      }
    }
    const onLeave = () => {
      this.pointer = null
      if (pointers.size === 0) {
        setHover(null)
        if (this.hoverBoard) {
          this.hoverBoard = ''
          this.requestRender()
        }
      }
    }
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault()
      if (!this.inputEnabled) return
      const p = rel(ev)
      let dy = ev.deltaY
      if (ev.deltaMode === 1) dy *= 16
      else if (ev.deltaMode === 2) dy *= this.rig.height
      const k = ev.ctrlKey ? 0.01 : 0.0018
      // trackpad pinch (ctrl) follows the fingers directly; mouse wheels ease towards the goal
      if (ev.ctrlKey) this.rig.zoomAt(Math.exp(-dy * k), p.x, p.y)
      else this.rig.zoomSmooth(Math.exp(-dy * k), p.x, p.y)
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

  /**
   * Debug/test hook: apply a pose (and optionally a camera) immediately, re-placing every
   * board synchronously so projectSquare() reflects it (used to fit the views to the
   * original's footage).
   */
  debugPose(pose: Partial<ViewPose>, cam?: { cx: number; cy: number; zoom: number }): void {
    this.rig.pose = { ...this.rig.pose, ...pose }
    if (cam) this.rig.state = { ...cam }
    this.rig.stopAnimation()
    this.rig.update()
    const l3 = light3D(this.rig.pose, SHADOW_3D)
    for (const e of this.entries.values()) {
      this.placeEntry(e, this.rig.pose, l3.x, l3.y)
      this.dirty.add(e)
    }
    this.poseKey = ''
    this.requestRender()
  }

  /** Debug/test hook: true while textures or animations are still settling. */
  get busy(): boolean {
    return this.frameRequested || this.texturesPending || this.rig.animating || !!this.flip
  }
}

// ---------------------------------------------------------------------------

/** The view a model asks for (viewMode, or the deprecated cameraMode). */
export function resolveView(m: RenderModel): ViewMode {
  if (m.viewMode) return m.viewMode
  return m.cameraMode === '3d' ? 'parallel' : '2d'
}

/** Everything but highlights: when this is unchanged, only square highlights / hover changed. */
function structureKey(m: RenderModel): string {
  return [
    snapId(m.snapshot),
    m.perspective,
    m.viewFilter,
    m.filterColor,
    m.pendingBoards.join(','),
    JSON.stringify(m.pendingBoardKinds ?? {}),
    m.requiredBoards.join(','),
    arrId(m.arrows),
    arrId(m.checks),
    m.background ?? '',
    resolveView(m),
    m.animations,
    m.motion?.id ?? '',
  ].join('|')
}

const ids = new WeakMap<object, number>()
let nextId = 1
function snapId(o: object): number {
  let v = ids.get(o)
  if (!v) ids.set(o, (v = nextId++))
  return v
}
function arrId(a: readonly unknown[]): string {
  return a.length ? `${snapId(a)}:${a.length}` : '0'
}

function pieceIn(m: RenderModel, pos: Pos): Piece | null {
  const tl = m.snapshot.timelines.find((t) => t.l === pos.l)
  const b = tl?.boards[pos.t - tl.startT]
  if (!b) return null
  return b.squares[pos.y * b.width + pos.x] ?? null
}

/** Thickness colour of a standing board: its frame, a little darker. */
function edgeColor(p: BoardPlacement): string {
  switch (p.frame) {
    case 'white':
      return '#c3c4ba'
    case 'black':
      return '#1f1f22'
    case 'pending':
      return '#6a62c0'
    case 'pending-move':
      return '#b5a53a'
    case 'check':
      return '#a9503b'
  }
}

/**
 * The arrow inside a present marker: shaft + head, centred on the circle by the
 * bounding box of the whole glyph (dir +1 points up on screen, -1 down).
 */
export function markerArrow(x: number, y: number, dir: 1 | -1, R: number): { shaft: Vec2[]; head: Vec2[] } {
  // glyph from tail (-1.0 R) to tip (+0.68 R): shift it so the box is centred on the circle
  const tail = -1.0
  const tip = 0.68
  const c = (tail + tip) / 2
  const Y = (v: number) => y + dir * (v - c) * R
  const shaft: Vec2[] = [
    { x: x - 0.33 * R, y: Y(tail) },
    { x: x + 0.33 * R, y: Y(tail) },
    { x: x + 0.33 * R, y: Y(-0.1) },
    { x: x - 0.33 * R, y: Y(-0.1) },
  ]
  const head: Vec2[] = [
    { x: x - 0.72 * R, y: Y(-0.16) },
    { x: x + 0.72 * R, y: Y(-0.16) },
    { x, y: Y(tip) },
  ]
  return { shaft, head }
}
