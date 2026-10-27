// Camera rig for every view: the 2D top-down view, History View and Parallel View
// (all orthographic, as in the original) and smooth transitions between them. A view is a
// pose (see ./views.ts); the camera itself is parameterised by a target (cx, cy)
// on the floor and a zoom in CSS px per world unit at that target, so panning,
// zooming and the bounds behave the same in every view.
//
// Smoothness: wheel zoom eases towards a goal (keeping the point under the cursor
// fixed), released drags coast with light inertia, programmatic moves are eased
// tweens, and a critically damped spring pulls the target back inside soft bounds
// (rubber band) around the multiverse.

import * as THREE from 'three'
import { POSES, VIEW_MS, blendPose, isFlat, placeCamera, viewEase, type ViewMode, type ViewPose } from './views'

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
/** Wheel zoom: rate (1/s) at which the zoom approaches its goal (~70 ms time constant). */
const ZOOM_RATE = 15
/** Released drags coast with this time constant (s): light inertia. */
const INERTIA_TAU = 0.11
/** Below this speed (CSS px/s) a coasting pan stops. */
const MIN_COAST_PX = 12
/** Drag pans follow the pointer with this rate (1/s): ~28 ms lag, but motion on every frame. */
const DRAG_RATE = 36

export type Ease = (t: number) => number
export const easeInOut: Ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
export const easeOut: Ease = (t) => 1 - Math.pow(1 - t, 3)

export class CameraRig {
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -100, 100)
  /** Current (possibly blended) pose; `mode` is the view it rests in or moves to. */
  pose: ViewPose = { ...POSES['2d'] }
  mode: ViewMode = '2d'
  state: CameraState = { cx: 0, cy: 0, zoom: 120 }
  width = 1
  height = 1
  /** 2D flip: vertical squash of the view (1 = none, 0 = edge-on). */
  squash = 1
  limits: CameraLimits = { box: null, margin: 0, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM }
  private viewAnim: { from: ViewPose; to: ViewPose; start: number; dur: number } | null = null
  private anim: { from: CameraState; to: CameraState; start: number; dur: number; ease: Ease } | null = null
  private zoomGoal: { z: number; px: number; py: number } | null = null
  /** Where a drag wants the target (the camera eases towards it every frame). */
  private dragGoal: { x: number; y: number } | null = null
  /** Pointers/keys currently holding the camera (no spring or inertia while > 0). */
  private holds = 0
  private lastInput = 0
  private lastTick = 0
  /** Target velocity (world units / s): inertia inside the bounds, spring outside. */
  private vel = { x: 0, y: 0 }
  private readonly raycaster = new THREE.Raycaster()
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

  /** True when rendering with the plain orthographic top-down camera. */
  get flat(): boolean {
    return !this.viewAnim && isFlat(this.pose)
  }

  get camera(): THREE.OrthographicCamera {
    return this.ortho
  }

  get minZoom(): number {
    return this.limits.minZoom
  }

  get maxZoom(): number {
    return this.limits.maxZoom
  }

  /** A pointer is dragging / a key is held. */
  get holding(): boolean {
    return this.holds > 0
  }

  /** True while the view is moving between modes. */
  get transitioning(): boolean {
    return this.viewAnim !== null
  }

  /** Set the zoom range and the soft pan bounds (call when the content or the view size changes). */
  setLimits(l: Partial<CameraLimits>) {
    const next = { ...this.limits, ...l }
    next.minZoom = THREE.MathUtils.clamp(next.minZoom, MIN_ZOOM, MAX_ZOOM)
    next.maxZoom = THREE.MathUtils.clamp(next.maxZoom, next.minZoom, MAX_ZOOM)
    this.limits = next
    if (this.zoomGoal) this.zoomGoal.z = THREE.MathUtils.clamp(this.zoomGoal.z, next.minZoom, next.maxZoom)
  }

  /** Animate into a view mode (dur 0 = jump). */
  setView(mode: ViewMode, dur = VIEW_MS) {
    this.mode = mode
    const to = POSES[mode]
    if (dur <= 0) {
      this.viewAnim = null
      this.pose = { ...to }
      this.update()
      return
    }
    this.viewAnim = { from: { ...this.pose }, to, start: performance.now(), dur }
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

  /** A drag ended with this target velocity (world units / s): coast with light inertia. */
  fling(vx: number, vy: number) {
    const sp = Math.hypot(vx, vy) * this.state.zoom
    if (sp < MIN_COAST_PX * 4) return
    const max = 4000 / this.state.zoom
    const k = Math.min(1, max / Math.hypot(vx, vy))
    this.vel = { x: vx * k, y: vy * k }
  }

  /** True while the target rests outside the bounds or still moves (the frame loop should keep ticking). */
  get settling(): boolean {
    const o = this.overshoot(this.state.cx, this.state.cy)
    return o.x !== 0 || o.y !== 0 || Math.abs(this.vel.x) + Math.abs(this.vel.y) > 1e-6
  }

  setSize(w: number, h: number) {
    this.width = Math.max(1, w)
    this.height = Math.max(1, h)
    this.update()
  }

  /** Half the larger view dimension in world units (for sizing the floor and the bar). */
  viewRadius(): number {
    return Math.max(this.width, this.height) / (2 * this.state.zoom) / Math.max(0.15, Math.sin(this.pose.elev))
  }

  update() {
    const { cx, cy, zoom } = this.state
    placeCamera(this.ortho, this.pose, cx, cy, zoom, this.width, this.height, this.squash)
  }

  /** Point on the plane z = `z` under a CSS pixel position, or null. */
  screenToGround(px: number, py: number, out = new THREE.Vector3(), z = 0): THREE.Vector3 | null {
    this.setRay(px, py)
    this.plane.constant = -z
    return this.raycaster.ray.intersectPlane(this.plane, out)
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

  /** Pan by a world offset now. Moving further out of the bounds meets rubber-band resistance. */
  panBy(dxWorld: number, dyWorld: number) {
    this.anim = null
    this.lastInput = performance.now()
    this.vel = { x: 0, y: 0 }
    const base = this.dragGoal ?? { x: this.state.cx, y: this.state.cy }
    const next = this.rubber(base, dxWorld, dyWorld)
    this.dragGoal = null
    this.state.cx = next.x
    this.state.cy = next.y
    this.update()
  }

  /** Drag pan: move the drag goal by a world offset; the camera follows it smoothly each frame. */
  dragBy(dxWorld: number, dyWorld: number) {
    this.anim = null
    this.lastInput = performance.now()
    this.vel = { x: 0, y: 0 }
    this.dragGoal = this.rubber(this.dragGoal ?? { x: this.state.cx, y: this.state.cy }, dxWorld, dyWorld)
  }

  /** Where the drag is taking the target (or the target itself). */
  get dragTarget(): { x: number; y: number } {
    return this.dragGoal ?? { x: this.state.cx, y: this.state.cy }
  }

  private rubber(from: { x: number; y: number }, dx: number, dy: number): { x: number; y: number } {
    const o = this.overshoot(from.x, from.y)
    const damp = (d: number, over: number) => {
      if (over === 0 || Math.sign(d) !== Math.sign(over)) return d
      const px = Math.abs(over) * this.state.zoom
      return d / Math.pow(1 + px / RUBBER_PX, 2)
    }
    return { x: from.x + damp(dx, o.x), y: from.y + damp(dy, o.y) }
  }

  /** Zoom by `factor` now, keeping the floor point under (px, py) fixed (pinch, keys). */
  zoomAt(factor: number, px: number, py: number) {
    this.anim = null
    this.zoomGoal = null
    this.lastInput = performance.now()
    this.applyZoom(this.state.zoom * factor, px, py)
  }

  /** Wheel zoom: ease towards `factor` times the current goal around (px, py). */
  zoomSmooth(factor: number, px: number, py: number) {
    this.anim = null
    this.lastInput = performance.now()
    const base = this.zoomGoal ? this.zoomGoal.z : this.state.zoom
    const z = this.state.zoom
    const lo = Math.min(this.minZoom, z)
    const hi = Math.max(this.maxZoom, z)
    this.zoomGoal = { z: THREE.MathUtils.clamp(base * factor, lo, hi), px, py }
  }

  private applyZoom(target: number, px: number, py: number) {
    const before = this.screenToGround(px, py)
    const z = this.state.zoom
    // hard limits; a view already outside them (content changed) may only move back towards them
    this.state.zoom = THREE.MathUtils.clamp(target, Math.min(this.minZoom, z), Math.max(this.maxZoom, z))
    this.update()
    const after = this.screenToGround(px, py)
    if (before && after) {
      const dx = before.x - after.x
      const dy = before.y - after.y
      this.state.cx += dx
      this.state.cy += dy
      // a drag in progress (pinch) keeps the same anchor
      if (this.dragGoal) this.dragGoal = { x: this.dragGoal.x + dx, y: this.dragGoal.y + dy }
      this.update()
    }
  }

  /** Eased move of the target/zoom (dur 0 = jump). */
  animateTo(to: Partial<CameraState>, dur = 450, ease: Ease = easeInOut) {
    const target: CameraState = {
      cx: to.cx ?? this.state.cx,
      cy: to.cy ?? this.state.cy,
      zoom: THREE.MathUtils.clamp(to.zoom ?? this.state.zoom, this.minZoom, this.maxZoom),
    }
    this.zoomGoal = null
    this.vel = { x: 0, y: 0 }
    if (dur <= 0) {
      this.anim = null
      this.state = target
      this.update()
      return
    }
    this.anim = { from: { ...this.state }, to: target, start: performance.now(), dur, ease }
  }

  /** Shift the target (and any running tween's end) by a world offset, eased over `dur`. */
  follow(dx: number, dy: number, dur: number, ease: Ease = easeOut) {
    const end = this.anim ? this.anim.to : this.state
    this.animateTo({ cx: end.cx + dx, cy: end.cy + dy, zoom: end.zoom }, dur, ease)
  }

  /** Where the target is heading (end of a running tween, else now). */
  get goal(): CameraState {
    return this.anim ? { ...this.anim.to } : { ...this.state, zoom: this.zoomGoal?.z ?? this.state.zoom }
  }

  stopAnimation() {
    this.anim = null
    this.zoomGoal = null
    this.dragGoal = null
  }

  /** Advances view transitions, tweens, smooth zoom, inertia and the bounds spring. Returns true while moving. */
  tick(now: number): boolean {
    const dt = Math.min(0.05, Math.max(0, (now - (this.lastTick || now)) / 1000))
    this.lastTick = now
    let moving = false
    let dirty = false
    const v = this.viewAnim
    if (v) {
      const k = Math.min(1, (now - v.start) / v.dur)
      this.pose = blendPose(v.from, v.to, viewEase(k))
      if (k >= 1) {
        this.pose = { ...v.to }
        this.viewAnim = null
      } else moving = true
      dirty = true
    }
    const a = this.anim
    if (a) {
      const k = Math.min(1, (now - a.start) / a.dur)
      const e = a.ease(k)
      this.state = {
        cx: a.from.cx + (a.to.cx - a.from.cx) * e,
        cy: a.from.cy + (a.to.cy - a.from.cy) * e,
        zoom: a.from.zoom * Math.pow(a.to.zoom / a.from.zoom, e),
      }
      if (k >= 1) this.anim = null
      else moving = true
      dirty = true
    } else {
      const g = this.zoomGoal
      if (g) {
        const lz = Math.log(this.state.zoom)
        const lg = Math.log(g.z)
        const next = Math.abs(lg - lz) < 0.0015 ? lg : lz + (lg - lz) * (1 - Math.exp(-dt * ZOOM_RATE))
        this.applyZoom(Math.exp(next), g.px, g.py)
        if (next === lg) this.zoomGoal = null
        else moving = true
        dirty = false
      }
      const d = this.dragGoal
      if (d) {
        const k = 1 - Math.exp(-dt * DRAG_RATE)
        const ex = d.x - this.state.cx
        const ey = d.y - this.state.cy
        if (Math.hypot(ex, ey) * this.state.zoom < 0.05) {
          this.state.cx = d.x
          this.state.cy = d.y
          this.dragGoal = null
        } else {
          this.state.cx += ex * k
          this.state.cy += ey * k
          moving = true
        }
        this.lastInput = now
        dirty = true
      } else if (this.coast(now, dt)) moving = true
    }
    if (dirty) this.update()
    return moving
  }

  /** Inertia inside the bounds; outside, a critically damped pull back once input has stopped. */
  private coast(now: number, dt: number): boolean {
    if (!this.settling) return false
    if (this.holds > 0 || now - this.lastInput < SETTLE_MS) {
      // still interacting: no spring yet; a fling started on release keeps coasting
      if (this.holds > 0) return true
      if (Math.abs(this.vel.x) + Math.abs(this.vel.y) < 1e-6) return true
    }
    if (dt <= 0) return true
    const o = this.overshoot(this.state.cx, this.state.cy)
    const w = SPRING_W
    const e = Math.exp(-w * dt)
    const decay = Math.exp(-dt / INERTIA_TAU)
    const step = (pos: number, over: number, v: number): [number, number] => {
      if (over === 0) {
        // inside: coast with friction
        return [pos + v * INERTIA_TAU * (1 - decay), v * decay]
      }
      // displacement from the nearest point inside the region; exact critically damped step
      const x = over
      const nx = (x + (v + w * x) * dt) * e
      const nv = (v - (v + w * x) * w * dt) * e
      return [pos - x + nx, nv]
    }
    ;[this.state.cx, this.vel.x] = step(this.state.cx, o.x, this.vel.x)
    ;[this.state.cy, this.vel.y] = step(this.state.cy, o.y, this.vel.y)
    // settle: snap the last sub-pixel and stop
    const o2 = this.overshoot(this.state.cx, this.state.cy)
    const tiny = 0.25 / this.state.zoom
    const slow = MIN_COAST_PX / this.state.zoom
    if (Math.abs(o2.x) < tiny && Math.abs(this.vel.x) < slow) {
      this.state.cx -= o2.x
      this.vel.x = 0
    }
    if (Math.abs(o2.y) < tiny && Math.abs(this.vel.y) < slow) {
      this.state.cy -= o2.y
      this.vel.y = 0
    }
    this.update()
    return this.settling
  }

  get animating(): boolean {
    return this.anim !== null || this.viewAnim !== null || this.zoomGoal !== null || this.dragGoal !== null || this.settling
  }

  /** CSS px per world unit (orthographic: the same everywhere). */
  pxPerUnitAt(v: THREE.Vector3): number {
    void v
    return this.state.zoom
  }
}
