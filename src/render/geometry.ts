// Geometry helpers: stroked polylines, polygons, rounded rectangles, arrows.

import * as THREE from 'three'
import type { Vec2 } from './layout'

/** Triangle-strip ribbon of half-width `hw` along a polyline (miter joins). */
export function ribbonPositions(pts: Vec2[], hw: number, z = 0, out: number[] = []): number[] {
  const n = pts.length
  if (n < 2) return out
  const left: Vec2[] = []
  const right: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const p = pts[i]
    const a = pts[Math.max(0, i - 1)]
    const b = pts[Math.min(n - 1, i + 1)]
    let tx: number
    let ty: number
    if (i === 0 || i === n - 1) {
      tx = b.x - a.x
      ty = b.y - a.y
      const l = Math.hypot(tx, ty) || 1
      tx /= l
      ty /= l
    } else {
      const ax = p.x - a.x
      const ay = p.y - a.y
      const bx = b.x - p.x
      const by = b.y - p.y
      const la = Math.hypot(ax, ay) || 1
      const lb = Math.hypot(bx, by) || 1
      tx = ax / la + bx / lb
      ty = ay / la + by / lb
      const l = Math.hypot(tx, ty) || 1
      tx /= l
      ty /= l
    }
    let nx = -ty
    let ny = tx
    let scale = hw
    if (i > 0 && i < n - 1) {
      const ax = p.x - a.x
      const ay = p.y - a.y
      const la = Math.hypot(ax, ay) || 1
      const dot = nx * (-ay / la) + ny * (ax / la)
      scale = hw / Math.max(0.3, dot)
    }
    nx *= scale
    ny *= scale
    left.push({ x: p.x + nx, y: p.y + ny })
    right.push({ x: p.x - nx, y: p.y - ny })
  }
  for (let i = 0; i < n - 1; i++) {
    const l0 = left[i]
    const r0 = right[i]
    const l1 = left[i + 1]
    const r1 = right[i + 1]
    out.push(l0.x, l0.y, z, r0.x, r0.y, z, l1.x, l1.y, z)
    out.push(r0.x, r0.y, z, r1.x, r1.y, z, l1.x, l1.y, z)
  }
  return out
}

/** Offsets a convex polygon outwards by d (counter-clockwise or clockwise input). */
export function offsetConvex(pts: Vec2[], d: number): Vec2[] {
  const n = pts.length
  // orientation
  let area = 0
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    area += a.x * b.y - b.x * a.y
  }
  const s = area > 0 ? 1 : -1
  const out: Vec2[] = []
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]
    const p = pts[i]
    const next = pts[(i + 1) % n]
    const e1x = p.x - prev.x
    const e1y = p.y - prev.y
    const e2x = next.x - p.x
    const e2y = next.y - p.y
    const l1 = Math.hypot(e1x, e1y) || 1
    const l2 = Math.hypot(e2x, e2y) || 1
    // outward normals
    const n1x = (s * e1y) / l1
    const n1y = (-s * e1x) / l1
    const n2x = (s * e2y) / l2
    const n2y = (-s * e2x) / l2
    let mx = n1x + n2x
    let my = n1y + n2y
    const ml = Math.hypot(mx, my) || 1
    mx /= ml
    my /= ml
    const cos = mx * n1x + my * n1y
    const len = d / Math.max(0.2, cos)
    out.push({ x: p.x + mx * len, y: p.y + my * len })
  }
  return out
}

export function polygonPositions(pts: Vec2[], z = 0, out: number[] = []): number[] {
  // fan triangulation (convex polygons only)
  for (let i = 1; i < pts.length - 1; i++) {
    out.push(pts[0].x, pts[0].y, z, pts[i].x, pts[i].y, z, pts[i + 1].x, pts[i + 1].y, z)
  }
  return out
}

export function circlePositions(cx: number, cy: number, r: number, z = 0, out: number[] = [], seg = 48): number[] {
  for (let i = 0; i < seg; i++) {
    const a0 = (i / seg) * Math.PI * 2
    const a1 = ((i + 1) / seg) * Math.PI * 2
    out.push(cx, cy, z, cx + r * Math.cos(a0), cy + r * Math.sin(a0), z, cx + r * Math.cos(a1), cy + r * Math.sin(a1), z)
  }
  return out
}

export function geometryFrom(positions: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  g.computeBoundingSphere()
  return g
}

const roundedCache = new Map<string, THREE.BufferGeometry>()

/** Unit-centred rounded rectangle geometry of size w x h, cached. */
export function roundedRectGeometry(w: number, h: number, r: number): THREE.BufferGeometry {
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${r.toFixed(4)}`
  let g = roundedCache.get(key)
  if (g) return g
  const s = new THREE.Shape()
  const x = -w / 2
  const y = -h / 2
  r = Math.min(r, w / 2, h / 2)
  s.moveTo(x + r, y)
  s.lineTo(x + w - r, y)
  s.quadraticCurveTo(x + w, y, x + w, y + r)
  s.lineTo(x + w, y + h - r)
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  s.lineTo(x + r, y + h)
  s.quadraticCurveTo(x, y + h, x, y + h - r)
  s.lineTo(x, y + r)
  s.quadraticCurveTo(x, y, x + r, y)
  g = new THREE.ShapeGeometry(s, 4)
  roundedCache.set(key, g)
  return g
}

export function disposeGeometryCache(): void {
  for (const g of roundedCache.values()) g.dispose()
  roundedCache.clear()
}

/** Quadratic Bezier sampled into `n` segments. */
export function bezier3(a: THREE.Vector3, c: THREE.Vector3, b: THREE.Vector3, n: number): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const u = 1 - t
    out.push(
      new THREE.Vector3(
        u * u * a.x + 2 * u * t * c.x + t * t * b.x,
        u * u * a.y + 2 * u * t * c.y + t * t * b.y,
        u * u * a.z + 2 * u * t * c.z + t * t * b.z,
      ),
    )
  }
  return out
}

/**
 * Arrow along a 3D polyline. The ribbon's width direction is perpendicular to
 * both the local tangent and `view` (the direction towards the camera), so the
 * arrow always faces the viewer. Pushes triangles for the body and the head.
 */
export function arrowPositions(
  pts: THREE.Vector3[],
  hw: number,
  headLen: number,
  headHalf: number,
  view: THREE.Vector3,
  out: number[] = [],
  /** extra length added at both ends (for outlines) */
  extend = 0,
): number[] {
  if (pts.length < 2) return out
  // trim the body so it ends where the head begins
  const total = pts.reduce((acc, p, i) => (i ? acc + p.distanceTo(pts[i - 1]) : 0), 0)
  if (total < 1e-6) return out
  const hl = Math.min(headLen, total * 0.6)
  const bodyEnd = total - hl
  const body: THREE.Vector3[] = []
  let acc = 0
  body.push(pts[0].clone())
  let headBase = pts[pts.length - 1].clone()
  let headDir = new THREE.Vector3().subVectors(pts[pts.length - 1], pts[pts.length - 2]).normalize()
  for (let i = 1; i < pts.length; i++) {
    const seg = pts[i].distanceTo(pts[i - 1])
    if (acc + seg >= bodyEnd) {
      const f = (bodyEnd - acc) / (seg || 1)
      headBase = new THREE.Vector3().lerpVectors(pts[i - 1], pts[i], f)
      body.push(headBase.clone())
      break
    }
    acc += seg
    body.push(pts[i].clone())
  }
  const tip = pts[pts.length - 1].clone()
  headDir = new THREE.Vector3().subVectors(tip, headBase).normalize()
  if (extend > 0) {
    const d0 = new THREE.Vector3().subVectors(body[0], body[1]).normalize()
    body[0].addScaledVector(d0, extend)
    tip.addScaledVector(headDir, extend * 1.8)
  }
  const side = (i: number) => {
    const a = body[Math.max(0, i - 1)]
    const b = body[Math.min(body.length - 1, i + 1)]
    const t = new THREE.Vector3().subVectors(b, a).normalize()
    return new THREE.Vector3().crossVectors(t, view).normalize()
  }
  for (let i = 0; i < body.length - 1; i++) {
    const s0 = side(i).multiplyScalar(hw)
    const s1 = side(i + 1).multiplyScalar(hw)
    const l0 = body[i].clone().add(s0)
    const r0 = body[i].clone().sub(s0)
    const l1 = body[i + 1].clone().add(s1)
    const r1 = body[i + 1].clone().sub(s1)
    out.push(l0.x, l0.y, l0.z, r0.x, r0.y, r0.z, l1.x, l1.y, l1.z)
    out.push(r0.x, r0.y, r0.z, r1.x, r1.y, r1.z, l1.x, l1.y, l1.z)
  }
  const hs = new THREE.Vector3().crossVectors(headDir, view).normalize().multiplyScalar(headHalf)
  const base = headBase.clone()
  if (extend > 0) base.addScaledVector(headDir, -extend)
  const hl1 = base.clone().add(hs)
  const hr1 = base.clone().sub(hs)
  out.push(hl1.x, hl1.y, hl1.z, hr1.x, hr1.y, hr1.z, tip.x, tip.y, tip.z)
  return out
}
