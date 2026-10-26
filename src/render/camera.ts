// Camera rig: orthographic top-down (2D) or tilted perspective (3D), both
// parameterised by a ground target (cx, cy) and a zoom in CSS px per world unit.

import * as THREE from 'three'

export interface CameraState {
  cx: number
  cy: number
  zoom: number
}

export const MIN_ZOOM = 6
export const MAX_ZOOM = 4000

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
  private anim: { from: CameraState; to: CameraState; start: number; dur: number } | null = null
  private readonly raycaster = new THREE.Raycaster()
  private readonly ground = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0)

  get camera(): THREE.Camera {
    return this.mode === '2d' ? this.ortho : this.persp
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

  panBy(dxWorld: number, dyWorld: number) {
    this.anim = null
    this.state.cx += dxWorld
    this.state.cy += dyWorld
    this.update()
  }

  /** Zoom by `factor` keeping the ground point under (px, py) fixed. */
  zoomAt(factor: number, px: number, py: number) {
    this.anim = null
    const before = this.screenToGround(px, py)
    this.state.zoom = THREE.MathUtils.clamp(this.state.zoom * factor, MIN_ZOOM, MAX_ZOOM)
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
      zoom: THREE.MathUtils.clamp(to.zoom ?? this.state.zoom, MIN_ZOOM, MAX_ZOOM),
    }
    if (dur <= 0) {
      this.anim = null
      this.state = target
      this.update()
      return
    }
    this.anim = { from: { ...this.state }, to: target, start: performance.now(), dur }
  }

  stopAnimation() {
    this.anim = null
  }

  /** Advances an active animation. Returns true while still animating. */
  tick(now: number): boolean {
    const a = this.anim
    if (!a) return false
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

  get animating(): boolean {
    return this.anim !== null
  }

  /** Approximate CSS px per world unit at a world point (perspective-aware). */
  pxPerUnitAt(v: THREE.Vector3): number {
    if (this.mode === '2d') return this.state.zoom
    const d = this.persp.position.distanceTo(v)
    return this.height / (2 * Math.max(0.01, d) * Math.tan(THREE.MathUtils.degToRad(FOV / 2)))
  }
}
