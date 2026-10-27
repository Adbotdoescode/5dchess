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

// ---------------------------------------------------------------------------
// Slabs: ribbons with per-vertex alpha (the fading tail) and their side walls.

/** Triangles + alphas + outline of a ribbon along `pts` (miter joins). */
export interface RibbonOut {
  pos: number[]
  alpha: number[]
}

/** Left/right edge points (and alphas) of a ribbon of half-width `hw` along `pts`. */
export function ribbonEdges(pts: Vec2[], hw: number): { left: Vec2[]; right: Vec2[] } {
  const n = pts.length
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
    } else {
      const la = Math.hypot(p.x - a.x, p.y - a.y) || 1
      const lb = Math.hypot(b.x - p.x, b.y - p.y) || 1
      tx = (p.x - a.x) / la + (b.x - p.x) / lb
      ty = (p.y - a.y) / la + (b.y - p.y) / lb
    }
    const l = Math.hypot(tx, ty) || 1
    tx /= l
    ty /= l
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
  return { left, right }
}

/** Ribbon triangles at height z with per-point alphas. */
export function ribbonAlpha(pts: Vec2[], alphas: number[], hw: number, z: number, out: RibbonOut): void {
  if (pts.length < 2) return
  const { left, right } = ribbonEdges(pts, hw)
  for (let i = 0; i < pts.length - 1; i++) {
    const l0 = left[i]
    const r0 = right[i]
    const l1 = left[i + 1]
    const r1 = right[i + 1]
    const a0 = alphas[i]
    const a1 = alphas[i + 1]
    out.pos.push(l0.x, l0.y, z, r0.x, r0.y, z, l1.x, l1.y, z, r0.x, r0.y, z, r1.x, r1.y, z, l1.x, l1.y, z)
    out.alpha.push(a0, a0, a1, a0, a1, a1)
  }
}

/** Convex polygon (fan) at height z, opaque. */
export function polygonAlpha(pts: Vec2[], z: number, out: RibbonOut, alpha = 1): void {
  for (let i = 1; i < pts.length - 1; i++) {
    out.pos.push(pts[0].x, pts[0].y, z, pts[i].x, pts[i].y, z, pts[i + 1].x, pts[i + 1].y, z)
    out.alpha.push(alpha, alpha, alpha)
  }
}

/** Vertical walls from z0 to z1 along a polyline (one quad per segment). */
export function wallsAlpha(pts: Vec2[], alphas: number[], z0: number, z1: number, out: RibbonOut, closed = false): void {
  const n = pts.length
  const m = closed ? n : n - 1
  for (let i = 0; i < m; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    const aa = alphas[i]
    const ab = alphas[(i + 1) % n]
    out.pos.push(a.x, a.y, z0, b.x, b.y, z0, b.x, b.y, z1, a.x, a.y, z0, b.x, b.y, z1, a.x, a.y, z1)
    out.alpha.push(aa, ab, ab, aa, ab, aa)
  }
}

/** BufferGeometry with positions and an RGBA vertex colour (white, alpha per vertex). */
export function alphaGeometry(out: RibbonOut): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(out.pos, 3))
  const col = new Float32Array(out.alpha.length * 4)
  for (let i = 0; i < out.alpha.length; i++) {
    col[i * 4] = 1
    col[i * 4 + 1] = 1
    col[i * 4 + 2] = 1
    col[i * 4 + 3] = out.alpha[i]
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4))
  g.computeBoundingSphere()
  return g
}

const extrudeCache = new Map<string, THREE.BufferGeometry>()

/** Rounded-rectangle prism from z = 0 to z = 1 (board thickness), cached. */
export function roundedPrismGeometry(w: number, h: number, r: number): THREE.BufferGeometry {
  const key = `${w.toFixed(4)}|${h.toFixed(4)}|${r.toFixed(4)}`
  let g = extrudeCache.get(key)
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
  g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 4 })
  extrudeCache.set(key, g)
  return g
}

export function disposeExtrudeCache(): void {
  for (const g of extrudeCache.values()) g.dispose()
  extrudeCache.clear()
}
