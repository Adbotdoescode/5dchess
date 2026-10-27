// View modes (2D, History View, Parallel View) as camera + board poses, and the
// pure math that places boards and the camera for any blend between them.
//
// Measured from the original game:
//  - History View: the camera looks back along time from the future side, a little
//    towards white's timelines (camera azimuth ~ -30 deg from +x, ~38 deg above the
//    floor). Boards stand up facing the future (+x), files running along +y.
//  - Parallel View: the camera looks across the timelines from white's side
//    (azimuth ~ -70 deg, ~34 deg up). Boards stand up facing -y, files along +x.
//  - Both are orthographic ("isometric"): fitting the camera to square positions in the
//    footage gives 1-2 px RMS error with an orthographic camera and 8-13 px with a
//    14 deg perspective. Elevation ~37 deg in both; boards stand fully upright.
// World: x = time (right = future), y = rows (up on the 2D screen), z = up from the floor.

import * as THREE from 'three'
import type { ViewMode } from './types'

export type { ViewMode }

export interface ViewPose {
  /** Camera elevation above the floor (rad); PI/2 = straight down. */
  elev: number
  /** Horizontal direction the camera looks along (rad, from +x counter-clockwise). */
  azim: number
  /** Board yaw about z (rad): 0 = files along +x, PI/2 = files along +y. */
  yaw: number
  /** Board tilt up from the floor (rad) about its bottom edge. */
  tilt: number
  /** "3D-ness" 0..1: slab heights, board pivot and thickness. */
  s: number
  /** 3D shadows fall behind the boards (away from the camera), offset sideways by this (screen right +). */
  lat: number
}

const deg = THREE.MathUtils.degToRad

export const POSES: Record<ViewMode, ViewPose> = {
  '2d': { elev: deg(90), azim: deg(90), yaw: 0, tilt: 0, s: 0, lat: 0 },
  history: { elev: deg(37.5), azim: deg(153), yaw: deg(90), tilt: deg(90), s: 1, lat: -0.42 },
  parallel: { elev: deg(37.5), azim: deg(111), yaw: 0, tilt: deg(90), s: 1, lat: 0.14 },
}

/** View transition length (ms): the original takes ~0.4-0.5 s, ease-out with a soft settle. */
export const VIEW_MS = 460

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Pose between two poses at blend t (0..1). */
export function blendPose(a: ViewPose, b: ViewPose, t: number): ViewPose {
  return {
    elev: lerp(a.elev, b.elev, t),
    azim: lerp(a.azim, b.azim, t),
    yaw: lerp(a.yaw, b.yaw, t),
    tilt: lerp(a.tilt, b.tilt, t),
    s: lerp(a.s, b.s, t),
    lat: lerp(a.lat, b.lat, t),
  }
}

/** True when the pose is the plain top-down view (render with the orthographic camera). */
export function isFlat(p: ViewPose): boolean {
  return p.s <= 1e-4 && Math.abs(p.elev - Math.PI / 2) < 1e-4
}

/** Cubic-bezier easing (CSS semantics), used for view transitions. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const bx = (t: number) => 3 * x1 * t * (1 - t) ** 2 + 3 * x2 * t * t * (1 - t) + t ** 3
  const by = (t: number) => 3 * y1 * t * (1 - t) ** 2 + 3 * y2 * t * t * (1 - t) + t ** 3
  const dbx = (t: number) => 3 * x1 * (1 - t) ** 2 + 6 * (x2 - x1) * t * (1 - t) + 3 * (1 - x2) * t * t
  return (x: number) => {
    if (x <= 0) return 0
    if (x >= 1) return 1
    let t = x
    for (let i = 0; i < 6; i++) {
      const d = dbx(t)
      if (Math.abs(d) < 1e-6) break
      t -= (bx(t) - x) / d
      t = Math.min(1, Math.max(0, t))
    }
    return by(t)
  }
}

/** The original's view transition: a quick start, most of the motion early, soft settle. */
export const viewEase = cubicBezier(0.3, 0.05, 0.15, 1)

/** Height of the camera target above the floor: the middle of the standing boards. */
export function targetHeight(p: ViewPose): number {
  return 0.68 * p.s
}

/**
 * Camera basis for a pose: forward (towards the target), right and up vectors.
 * At elev = 90 deg, "up" on screen is the horizontal look direction (azim).
 */
export function cameraBasis(p: ViewPose): { forward: THREE.Vector3; right: THREE.Vector3; up: THREE.Vector3 } {
  const ce = Math.cos(p.elev)
  const forward = new THREE.Vector3(ce * Math.cos(p.azim), ce * Math.sin(p.azim), -Math.sin(p.elev)).normalize()
  const right = new THREE.Vector3(Math.sin(p.azim), -Math.cos(p.azim), 0)
  const up = new THREE.Vector3().crossVectors(right, forward).normalize()
  return { forward, right, up }
}

/**
 * Places the orthographic camera for a pose: `zoom` CSS px per world unit, looking at
 * (cx, cy) on the floor (the target itself sits targetHeight() above it). `squash`
 * scales the view vertically (2D Flip Persp. animation).
 */
export function placeCamera(cam: THREE.OrthographicCamera, p: ViewPose, cx: number, cy: number, zoom: number, width: number, height: number, squash = 1) {
  const hw = width / (2 * zoom)
  const hh = height / (2 * zoom) / Math.max(0.015, squash)
  const { forward, right, up } = cameraBasis(p)
  const tz = targetHeight(p)
  // far enough back to see everything in front of the floor's visible part
  const d = Math.max(100, 4 * Math.max(hw, hh) / Math.max(0.2, Math.sin(p.elev)))
  cam.left = -hw
  cam.right = hw
  cam.top = hh
  cam.bottom = -hh
  cam.near = 0.01
  cam.far = d * 2
  cam.position.set(cx - forward.x * d, cy - forward.y * d, tz - forward.z * d)
  const m = new THREE.Matrix4().makeBasis(right, up, forward.clone().negate())
  cam.quaternion.setFromRotationMatrix(m)
  cam.up.copy(up)
  cam.updateProjectionMatrix()
  cam.updateMatrixWorld(true)
}

/**
 * 3D floor shadow offset per unit of height. In the original's 3D views long shadows
 * fall behind the standing boards (away from the camera), slightly to the left in
 * History View and to the right in Parallel View (as in the original).
 */
export function light3D(p: ViewPose, length = 1.4, out = { x: 0, y: 0 }) {
  const fx = Math.cos(p.azim)
  const fy = Math.sin(p.azim)
  const rx = Math.sin(p.azim)
  const ry = -Math.cos(p.azim)
  out.x = (fx + rx * p.lat) * length
  out.y = (fy + ry * p.lat) * length
  return out
}

/** Height of the standing boards' bottom edge in 3D, and of the slabs (world units). */
export const BOARD_Z_2D = 0.1
export const BOARD_LIFT_3D = 0.215
export const BAND_HEIGHT = 0.17
/** Just under the bands, so bands crossing the bar lie flush on it (no visible step). */
export const BAR_HEIGHT = 0.168
export const BOARD_THICKNESS = 0.035

/**
 * World matrix of a board: centred on (x, y) when flat; in 3D, standing on its bottom
 * edge through (x, y), rotated by the pose's yaw and tilted up by its tilt.
 */
export function boardMatrix(p: ViewPose, x: number, y: number, h: number, out = new THREE.Matrix4()): THREE.Matrix4 {
  const z = lerp(BOARD_Z_2D, BOARD_LIFT_3D, p.s)
  const t = new THREE.Matrix4().makeTranslation(x, y, z)
  const rz = new THREE.Matrix4().makeRotationZ(p.yaw)
  const rx = new THREE.Matrix4().makeRotationX(p.tilt)
  const lift = new THREE.Matrix4().makeTranslation(0, (h / 2) * p.s, 0)
  return out.copy(t).multiply(rz).multiply(rx).multiply(lift)
}
