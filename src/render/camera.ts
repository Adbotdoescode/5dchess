// Camera rig: orthographic top-down (2D) or tilted perspective (3D), both
// parameterised by a ground target (cx, cy) and a zoom in CSS px per world unit.
//
// Limits (as in the original): a zoom range, and soft pan bounds around a
// world-space content box. Panning past the box (plus a margin) meets growing
// resistance (rubber band); once input stops, a critically damped spring pulls
// the target back inside.

import * as THREE from 'three'

export interface CameraState {
  cx: number
  cy: number
  zoom: number
}

/** Absolute zoom limits (CSS px per world unit); setLimits() narrows them per layout. */
export const MIN_ZOOM = 6
export const MAX_ZOOM = 4000

/** World-space axis-aligned box (y up). */
export interface WorldBox {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export interface CameraLimits {
  /** Content box the camera target should stay near (null = no pan bounds). */
  box: WorldBox | null
  /** How far (world units) the target may rest outside the box. */
  margin: number
  /** Zoom range (CSS px per world unit). */
  minZoom: number
  maxZoom: number
}

/** Rubber band: resistance grows with the overshoot; this many CSS px halves the pan speed. */
const RUBBER_PX = 120
/** Spring stiffness (rad/s) of the pull back inside the bounds (critically damped). */
const SPRING_W = 11
/** Input within this many ms counts as "still interacting" (no spring yet). */
const SETTLE_MS = 90

/** 3D camera: elevation above the ground and azimuth (camera sits to the lower right). */
const ELEVATION = THREE.MathUtils.degToRad(48)
const AZIMUTH = THREE.MathUtils.degToRad(22)
const FOV = 32

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)

export class CameraRig {
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100)
  readonly persp = new THREE.PerspectiveCamera(FOV, 1, 0.05, 2000)
  mode: '2d' | '3d' = '2d'
  state: CameraState = { cx: 0, cy: 0, zoom: 120 }
  width = 1
  height = 1
  limits: CameraLimits = { box: null, margin: 0, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }
  private anim: { from: CameraState; to: CameraState; start: number; dur: number } | null = null
  /** Pointers/keys currently holding the camera (no spring while > 0). */
  private holds = 0
  private lastInput = 0
  private lastTick = 0
  private vel = { x: 0, y: 0 }
  private readonly raycaster = new THREE.Raycaster()
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

  get camera(): THREE.Camera {
    return this.mode === '2d' ? this.ortho : this.persp
  }

  get minZoom(): number {
    return this.limits.minZoom
  }

  get maxZoom(): number {
    return this.limits.maxZoom
  }

  /** Set the zoom range and the soft pan bounds (call when the content or the view size changes). */
  setLimits(l: Partial<CameraLimits>) {
    const next = { ...this.limits, ...l }
    next.minZoom = THREE.MathUtils.clamp(next.minZoom, MIN_ZOOM, MAX_ZOOM)
    next.maxZoom = THREE.MathUtils.clamp(next.maxZoom, next.minZoom, MAX_ZOOM)
    this.limits = next
  }

  /** The region the camera target rests in: the content box grown by the margin. */
  private region(): WorldBox | null {
    const b = this.limits.box
    if (!b) return null
    const m = this.limits.margin
    return { minX: b.minX - m, maxX: b.maxX + m, minY: b.minY - m, maxY: b.maxY + m }
  }

  /** How far (world units, signed) a target lies outside the rest region on each axis. */
  private overshoot(x: number, y: number): { x: number; y: number } {
    const r = this.region()
    if (!r) return { x: 0, y: 0 }
    const o = (v: number, lo: number, hi: number) => (v < lo ? v - lo : v > hi ? v - hi : 0)
    return { x: o(x, r.minX, r.maxX), y: o(y, r.minY, r.maxY) }
  }

  /** A pointer (or held key) starts / stops steering the camera. */
  hold(on: boolean) {
    this.holds = Math.max(0, this.holds + (on ? 1 : -1))
    this.lastInput = performance.now()
    if (on) {
      this.anim = null
      this.vel = { x: 0, y: 0 }
    }
  }

  /** Release every hold (e.g. pointer capture lost). */
  releaseAll() {
    this.holds = 0
    this.lastInput = performance.now()
  }

  /** True while the target rests outside the bounds or still moves (the frame loop should keep ticking). */
  get settling(): boolean {
    const o = this.overshoot(this.state.cx, this.state.cy)
    return o.x !== 0 || o.y !== 0 || Math.abs(this.vel.x) + Math.abs(this.vel.y) > 1e-4
  }

  setSize(w: number, h: number) {
    this.width = Math.max(1, w)
    this.height = Math.max(1, h)
    this.update()
  }

  /** Distance from target for the perspective camera at the current zoom. */
  distance(zoom = this.state.zoom): number {
    return this.height / (2 * zoom * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))
  }

  update() {
    const { cx, cy, zoom } = this.state
    const hw = this.width / (2 * zoom)
    const hh = this.height / (2 * zoom)
    const o = this.ortho
    o.left = -hw
    o.right = hw
    o.top = hh
    o.bottom = -hh
    o.position.set(cx, cy, 50)
    o.up.set(0, 1, 0)
    o.lookAt(cx, cy, 0)
    o.updateProjectionMatrix()
    o.updateMatrixWorld()

    const p = this.persp
    const d = this.distance()
    p.aspect = this.width / this.height
    p.near = Math.max(0.01, d * 0.05)
    p.far = d * 40 + 50
    p.position.set(
      cx + d * Math.cos(ELEVATION) * Math.sin(AZIMUTH),
      cy - d * Math.cos(ELEVATION) * Math.cos(AZIMUTH),
      d * Math.sin(ELEVATION),
    )
    p.up.set(0, 0, 1)
    p.lookAt(cx, cy, 0)
    p.updateProjectionMatrix()
    p.updateMatrixWorld()
  }

  /** Ground point (z=0) under a CSS pixel position, or null. */
  screenToGround(px: number, py: number, out = new THREE.Vector3()): THREE.Vector3 | null {
    this.setRay(px, py)
    return this.raycaster.ray.intersectPlane(this.ground, out)
  }

  setRay(px: number, py: number): THREE.Raycaster {
    const ndc = new THREE.Vector2((px / this.width) * 2 - 1, -(py / this.height) * 2 + 1)
    this.raycaster.setFromCamera(ndc, this.camera)
    return this.raycaster
  }

  /** CSS pixel position of a world point. */
  project(v: THREE.Vector3): { x: number; y: number; visible: boolean } {
    const p = v.clone().project(this.camera)
    return { x: ((p.x + 1) / 2) * this.width, y: ((1 - p.y) / 2) * this.height, visible: p.z > -1 && p.z < 1 }
  }

  /** Pan by a world offset. Moving further out of the bounds meets rubber-band resistance. */
  panBy(dxWorld: number, dyWorld: number) {
    this.anim = null
    this.lastInput = performance.now()
    this.vel = { x: 0, y: 0 }
    const o = this.overshoot(this.state.cx, this.state.cy)
    const damp = (d: number, over: number) => {
      if (over === 0 || Math.sign(d) !== Math.sign(over)) return d
      const px = Math.abs(over) * this.state.zoom
      return d / Math.pow(1 + px / RUBBER_PX, 2)
    }
    this.state.cx += damp(dxWorld, o.x)
    this.state.cy += damp(dyWorld, o.y)
    this.update()
  }

  /** Zoom by `factor` keeping the ground point under (px, py) fixed. */
  zoomAt(factor: number, px: number, py: number) {
    this.anim = null
    this.lastInput = performance.now()
    const before = this.screenToGround(px, py)
    const z = this.state.zoom
    // hard limits; a view already outside them (content changed) may only move back towards them
    this.state.zoom = THREE.MathUtils.clamp(z * factor, Math.min(this.minZoom, z), Math.max(this.maxZoom, z))
    this.update()
    const after = this.screenToGround(px, py)
    if (before && after) {
      this.state.cx += before.x - after.x
      this.state.cy += before.y - after.y
      this.update()
    }
  }

  animateTo(to: Partial<CameraState>, dur = 450) {
    const target: CameraState = {
      cx: to.cx ?? this.state.cx,
      cy: to.cy ?? this.state.cy,
      zoom: THREE.MathUtils.clamp(to.zoom ?? this.state.zoom, this.minZoom, this.maxZoom),
    }
    if (dur <= 0) {
      this.anim = null
      this.state = target
      this.update()
      return
    }
    this.anim = { from: { ...this.state }, to: target, start: performance.now(), dur }
    this.vel = { x: 0, y: 0 }
  }

  stopAnimation() {
    this.anim = null
  }

  /** Advances an animation or the spring back into bounds. Returns true while still moving. */
  tick(now: number): boolean {
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastTick || now)) / 1000))
    this.lastTick = now
    const a = this.anim
    if (!a) return this.spring(now, dt)
    const k = Math.min(1, (now - a.start) / a.dur)
    const e = easeInOut(k)
    // interpolate zoom geometrically
    const z = a.from.zoom * Math.pow(a.to.zoom / a.from.zoom, e)
    this.state = {
      cx: a.from.cx + (a.to.cx - a.from.cx) * e,
      cy: a.from.cy + (a.to.cy - a.from.cy) * e,
      zoom: z,
    }
    this.update()
    if (k >= 1) this.anim = null
    return this.anim !== null
  }

  /** Critically damped pull of the target back inside the bounds once input has stopped. */
  private spring(now: number, dt: number): boolean {
    if (!this.settling) return false
    if (this.holds > 0 || now - this.lastInput < SETTLE_MS) return true // keep ticking until released
    if (dt <= 0) return true
    const w = SPRING_W
    const e = Math.exp(-w * dt)
    const step = (pos: number, over: number, v: number): [number, number] => {
      // displacement from the nearest point inside the region; exact critically damped step
      const x = over
      const nx = (x + (v + w * x) * dt) * e
      const nv = (v - (v + w * x) * w * dt) * e
      return [pos - x + nx, nv]
    }
    const o = this.overshoot(this.state.cx, this.state.cy)
    ;[this.state.cx, this.vel.x] = step(this.state.cx, o.x, this.vel.x)
    ;[this.state.cy, this.vel.y] = step(this.state.cy, o.y, this.vel.y)
    // settle: snap the last sub-pixel and stop
    const o2 = this.overshoot(this.state.cx, this.state.cy)
    const tiny = 0.25 / this.state.zoom
    if (Math.abs(o2.x) < tiny && Math.abs(this.vel.x) * this.state.zoom < 2) {
      this.state.cx -= o2.x
      this.vel.x = 0
    }
    if (Math.abs(o2.y) < tiny && Math.abs(this.vel.y) * this.state.zoom < 2) {
      this.state.cy -= o2.y
      this.vel.y = 0
    }
    this.update()
    return this.settling
  }

  get animating(): boolean {
    return this.anim !== null || this.settling
  }

  /** Approximate CSS px per world unit at a world point (perspective-aware). */
  pxPerUnitAt(v: THREE.Vector3): number {
    if (this.mode === '2d') return this.state.zoom
    const d = this.persp.position.distanceTo(v)
    return this.height / (2 * Math.max(0.01, d) * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))
  }
}
