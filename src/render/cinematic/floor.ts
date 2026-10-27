// The game's flat 2D scene, redrawn with Canvas 2D for the cinematic's tilting floor.
//
// The cinematic's camera is orthographic (fitting the footage: all edges of the Present
// bar stay parallel and every card has the same size), so the floor plane maps to the
// screen by an affine transform: we draw it per frame in world units through
// ctx.setTransform, with the same layout, colours and layering as renderer.ts (floor
// checker, labels, Present bar and its text, band shadows and bands, markers, board
// shadows, boards, arrows). Boards that stand up as cards are drawn as dark
// footprints instead (the shadow slab under a lifted card).

import * as THREE from 'three'
import type { Layout, BoardPlacement, Vec2 } from '../layout'
import { squareOffset } from '../layout'
import type { BoardArrow } from '../types'
import type { Check, Pos } from '../../engine/types'
import { drawBoard } from '../boardTexture'
import { arrowPositions, bezier3, offsetConvex, ribbonEdges } from '../geometry'
import {
  ARROW_HALF,
  ARROW_HEAD_HALF,
  ARROW_HEAD_LEN,
  ARROW_OUTLINE,
  BAND_HALF,
  BAND_RIM,
  BAND_SHADOW,
  BAR_SHADOW,
  BAR_TEXT_GAP,
  BAR_TEXT_SIZE,
  BAR_WIDTH,
  BAR_EDGE,
  BOARD_SHADOW,
  COLORS,
  CORNER_THICK,
  CORNER_THIN,
  HEAD_BASE,
  HEAD_TIP,
  LABEL_CAP,
  LABEL_MARGIN_BOARD,
  LABEL_MARGIN_MARKER,
  MARKER_RADIUS,
  MARKER_RIM,
} from '../constants'
import { markerArrow } from '../renderer'

export interface FloorScene {
  layout: Layout
  /** Boards drawn as standing cards elsewhere (only their shadows are painted, see CardShadow). */
  cards: Set<string>
  arrows: BoardArrow[]
  checks: Check[]
  background: 'default' | 'ended'
}

/** Shadow of a lifted card on the floor: the board rect at (x, y) shifted by its height along the 2D light. */
export interface CardShadow {
  x: number
  y: number
  w: number
  h: number
  r: number
}

/** 2D light (renderer.ts LIGHT): a point at height z is shadowed at (x, y) + z * CARD_LIGHT. */
export const CARD_LIGHT = { x: BOARD_SHADOW.x / 0.1, y: BOARD_SHADOW.y / 0.1 }

/** Affine world → screen (CSS px): X = a x + c y + e, Y = b x + d y + f. */
export interface Affine {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

const BAND_COLORS = {
  active: { body: COLORS.bandActive, rim: COLORS.bandActiveRim },
  white: { body: COLORS.bandWhite, rim: COLORS.bandWhiteRim },
  black: { body: COLORS.bandBlack, rim: COLORS.bandBlackRim },
} as const

const smooth = (t: number) => t * t * (3 - 2 * t)

function invert(m: Affine): Affine {
  const det = m.a * m.d - m.b * m.c
  const a = m.d / det
  const b = -m.b / det
  const c = -m.c / det
  const d = m.a / det
  return { a, b, c, d, e: -(a * m.e + c * m.f), f: -(b * m.e + d * m.f) }
}

function polygon(ctx: CanvasRenderingContext2D, pts: Vec2[]) {
  ctx.beginPath()
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
  ctx.closePath()
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y, x + w, y + r, r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x, y + h, x, y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

const cornerOf = (p: BoardPlacement) => (p.thick || p.frame === 'pending' || p.frame === 'pending-move' || p.frame === 'check' ? CORNER_THICK : CORNER_THIN)

/** Band centre line with the soft tail subdivided, per-point alphas and the head triangle (as renderer.ts bandShape). */
function bandShape(tl: Layout['timelines'][number]): { path: Vec2[]; alphas: number[]; head: Vec2[] } {
  const baseX = tl.endX + HEAD_BASE
  let path = tl.path.slice()
  const last = path[path.length - 1]
  path[path.length - 1] = { x: Math.max(baseX, path.length > 2 ? path[path.length - 2].x + 0.01 : -Infinity), y: last.y }
  if (path.length === 2 && path[0].x > path[1].x - 0.01) path[0] = { x: path[1].x - 0.01, y: path[0].y }
  let alphas = path.map(() => 1)
  if (tl.tail > 0 && path.length >= 3) {
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

/** A ribbon of half-width hw along path with per-point alpha, as quads (miter joins via ribbonEdges). */
function ribbon(ctx: CanvasRenderingContext2D, path: Vec2[], alphas: number[], hw: number, color: string, dx = 0, dy = 0) {
  const { left, right } = ribbonEdges(path, hw)
  ctx.fillStyle = color
  for (let i = 0; i + 1 < path.length; i++) {
    const a = (alphas[i] + alphas[i + 1]) / 2
    if (a <= 0.001) continue
    ctx.globalAlpha = a
    polygon(ctx, [
      { x: left[i].x + dx, y: left[i].y + dy },
      { x: left[i + 1].x + dx, y: left[i + 1].y + dy },
      { x: right[i + 1].x + dx, y: right[i + 1].y + dy },
      { x: right[i].x + dx, y: right[i].y + dy },
    ])
    ctx.fill()
    // hairline overlap so neighbouring quads never leave seams
    ctx.strokeStyle = color
    ctx.lineWidth = 0.002
    ctx.stroke()
  }
  ctx.globalAlpha = 1
}

export class FloorPainter {
  private readonly boardCanvases = new Map<string, { canvas: HTMLCanvasElement; tier: number }>()
  private barLabel: HTMLCanvasElement | null = null
  private barLabelLen = 2.6
  private labelSpans: [number, number][] = []
  private labelMetricsKey = ''

  private readonly scene: FloorScene
  private readonly flip: boolean

  constructor(scene: FloorScene, flip: boolean) {
    this.scene = scene
    this.flip = flip
  }

  /** Paints the floor for world→screen transform m into ctx (CSS px; dpr handled by the caller). */
  paint(ctx: CanvasRenderingContext2D, m: Affine, width: number, height: number, dpr: number, cardShadows: CardShadow[] = []) {
    const L = this.scene.layout
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const [cLight, cDark] = this.scene.background === 'ended' ? [COLORS.bgEndedLight, COLORS.bgEndedDark] : [COLORS.bgLight, COLORS.bgDark]
    ctx.fillStyle = cLight
    ctx.fillRect(0, 0, width, height)
    ctx.setTransform(m.a * dpr, m.b * dpr, m.c * dpr, m.d * dpr, m.e * dpr, m.f * dpr)

    // visible world bounds on the floor plane
    const inv = invert(m)
    const corners = [
      [0, 0],
      [width, 0],
      [0, height],
      [width, height],
    ].map(([X, Y]) => ({ x: inv.a * X + inv.c * Y + inv.e, y: inv.b * X + inv.d * Y + inv.f }))
    const minX = Math.min(...corners.map((p) => p.x)) - 1
    const maxX = Math.max(...corners.map((p) => p.x)) + 1
    const minY = Math.min(...corners.map((p) => p.y)) - 1
    const maxY = Math.max(...corners.map((p) => p.y)) + 1
    const pxPerUnit = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c))

    // 1. background checker (cells: one full turn wide, one row tall)
    ctx.fillStyle = cDark
    const cw = L.cellWidth
    const cx0 = Math.floor((minX - L.cellOrigin) / cw)
    const cx1 = Math.ceil((maxX - L.cellOrigin) / cw)
    const cy0 = Math.floor(minY + 0.5 + L.rowOffset)
    const cy1 = Math.ceil(maxY + 0.5 + L.rowOffset)
    if ((cx1 - cx0) * (cy1 - cy0) < 40000) {
      for (let i = cx0; i <= cx1; i++) {
        for (let j = cy0; j <= cy1; j++) {
          if ((((i + j) % 2) + 2) % 2 !== 1) continue
          ctx.fillRect(L.cellOrigin + i * cw, j - 0.5 - L.rowOffset, cw, 1)
        }
      }
    }

    // 2. floor labels ("0L", "T1"), drawn in the other checker colour of the cell under them
    const size = LABEL_CAP / 0.72
    ctx.font = `700 ${size * 100}px "Helvetica Neue", Helvetica, Arial, sans-serif`
    for (const lb of L.labels) {
      const odd = (((Math.floor((lb.x - L.cellOrigin) / cw) + Math.floor(lb.y + 0.5 + L.rowOffset)) % 2) + 2) % 2 === 1
      ctx.save()
      ctx.translate(lb.x, lb.y)
      ctx.scale(0.01, -0.01)
      ctx.fillStyle = odd ? cLight : cDark
      ctx.textAlign = lb.align === 'right' ? 'right' : 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(lb.text, lb.align === 'right' ? -size * 10 : 0, 0)
      ctx.restore()
    }

    // 3. the Present bar: shadow, body with edges, text, markers
    const light = L.presentColor === 'white'
    const bx = L.presentX
    ctx.fillStyle = COLORS.shadow
    ctx.fillRect(bx - BAR_WIDTH / 2 + BAR_SHADOW.x, minY, BAR_WIDTH, maxY - minY)
    // band shadows lie on the floor too (renderer RO.bandShadow < bar)
    for (const tl of L.timelines) {
      const { path, alphas, head } = bandShape(tl)
      ribbon(ctx, path, alphas, BAND_HALF + BAND_RIM, COLORS.shadow, BAND_SHADOW.x, BAND_SHADOW.y)
      ctx.fillStyle = COLORS.shadow
      polygon(ctx, offsetConvex(head, BAND_RIM).map((p) => ({ x: p.x + BAND_SHADOW.x, y: p.y + BAND_SHADOW.y })))
      ctx.fill()
    }
    ctx.fillStyle = light ? COLORS.barLightEdge : COLORS.barDarkEdge
    ctx.fillRect(bx - BAR_WIDTH / 2, minY, BAR_WIDTH, maxY - minY)
    ctx.fillStyle = light ? COLORS.barLight : COLORS.barDark
    ctx.fillRect(bx - BAR_WIDTH / 2 + BAR_EDGE, minY, BAR_WIDTH - 2 * BAR_EDGE, maxY - minY)
    this.paintBarText(ctx, light ? COLORS.barLightText : COLORS.barDarkText, minY, maxY)
    for (const mk of L.markers) {
      const white = mk.color === 'white'
      ctx.fillStyle = white ? COLORS.markerWhiteRim : COLORS.markerBlackRim
      ctx.beginPath()
      ctx.arc(bx, mk.y, MARKER_RADIUS + MARKER_RIM, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = white ? COLORS.markerWhiteFill : COLORS.markerBlackFill
      ctx.beginPath()
      ctx.arc(bx, mk.y, MARKER_RADIUS, 0, Math.PI * 2)
      ctx.fill()
      if (mk.arrow) {
        const { shaft, head } = markerArrow(bx, mk.y, mk.dir, MARKER_RADIUS)
        ctx.fillStyle = COLORS.bandActiveRim
        polygon(ctx, offsetConvex(shaft, 0.012))
        ctx.fill()
        polygon(ctx, offsetConvex(head, 0.012))
        ctx.fill()
        ctx.fillStyle = COLORS.bandActive
        polygon(ctx, shaft)
        ctx.fill()
        polygon(ctx, head)
        ctx.fill()
      }
    }

    // 4. bands (rims, then bodies) over the bar
    for (const tl of L.timelines) {
      const { path, alphas, head } = bandShape(tl)
      const col = BAND_COLORS[tl.style]
      ribbon(ctx, path, alphas, BAND_HALF + BAND_RIM, col.rim)
      ctx.fillStyle = col.rim
      polygon(ctx, offsetConvex(head, BAND_RIM))
      ctx.fill()
    }
    for (const tl of L.timelines) {
      const { path, alphas, head } = bandShape(tl)
      const col = BAND_COLORS[tl.style]
      ribbon(ctx, path, alphas, BAND_HALF, col.body)
      ctx.fillStyle = col.body
      polygon(ctx, head)
      ctx.fill()
    }

    // 5. board shadows, card footprints, boards
    const visible = (p: BoardPlacement) => p.x + p.w > minX && p.x - p.w < maxX && p.y + p.h > minY && p.y - p.h < maxY
    ctx.fillStyle = COLORS.shadow
    for (const p of L.boards) {
      if (!visible(p) || this.scene.cards.has(p.key)) continue
      roundRect(ctx, p.x - p.w / 2 + BOARD_SHADOW.x, p.y - p.h / 2 + BOARD_SHADOW.y, p.w, p.h, cornerOf(p))
      ctx.fill()
    }
    for (const s of cardShadows) {
      roundRect(ctx, s.x - s.w / 2, s.y - s.h / 2, s.w, s.h, s.r)
      ctx.fill()
    }
    const tier = Math.min(1024, Math.max(64, 2 ** Math.ceil(Math.log2(Math.max(1, pxPerUnit * dpr * 0.9)))))
    for (const p of L.boards) {
      if (this.scene.cards.has(p.key) || !visible(p)) continue
      const img = this.boardCanvas(p, tier)
      ctx.save()
      ctx.translate(p.x, p.y)
      ctx.scale(1, -1) // canvas rows grow downwards; world y is up
      ctx.drawImage(img, -p.w / 2, -p.h / 2, p.w, p.h)
      ctx.restore()
    }

    // 6. move arrows (last move, pending, checks), flat as in 2D
    this.paintArrows(ctx)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  private boardCanvas(p: BoardPlacement, tier: number): HTMLCanvasElement {
    let e = this.boardCanvases.get(p.key)
    if (!e || e.tier < tier) {
      const canvas = e?.canvas ?? document.createElement('canvas')
      drawBoard(canvas, p, this.flip, tier)
      e = { canvas, tier }
      this.boardCanvases.set(p.key, e)
    }
    return e.canvas
  }

  private paintBarText(ctx: CanvasRenderingContext2D, color: string, lo: number, hi: number) {
    const L = this.scene.layout
    const k = 320
    if (!this.barLabel) {
      const font = `italic 400 ${Math.round(BAR_TEXT_SIZE * k)}px "Crimson Text", "EB Garamond", Garamond, "Times New Roman", serif`
      const c = document.createElement('canvas')
      const ctx0 = c.getContext('2d')!
      ctx0.font = font
      const mt = ctx0.measureText('The Present')
      const left = mt.actualBoundingBoxLeft || 0
      const textW = (mt.actualBoundingBoxRight || mt.width) + left
      const pad = Math.round(0.04 * k)
      c.width = Math.round(BAR_WIDTH * k)
      c.height = Math.ceil(textW + 2 * pad)
      const cx = c.getContext('2d')!
      cx.translate(c.width / 2, pad + left)
      cx.rotate(Math.PI / 2)
      cx.fillStyle = '#ffffff'
      cx.font = font
      cx.textBaseline = 'middle'
      cx.textAlign = 'left'
      cx.fillText('The Present', 0, -BAR_TEXT_SIZE * k * 0.06)
      this.barLabel = c
      this.barLabelLen = c.height / k
    }
    const len = this.barLabelLen
    const key = `${lo.toFixed(1)}|${hi.toFixed(1)}`
    if (key !== this.labelMetricsKey) {
      this.labelMetricsKey = key
      this.labelSpans = presentLabelSpans(L, len, lo, hi)
    }
    // tint the white text: draw it into a scratch canvas once per colour
    const tinted = tintCanvas(this.barLabel, color)
    for (const [b, t] of this.labelSpans) {
      ctx.save()
      ctx.translate(L.presentX, (b + t) / 2)
      ctx.scale(1, -1)
      ctx.drawImage(tinted, -BAR_WIDTH / 2, -len / 2, BAR_WIDTH, len)
      ctx.restore()
    }
  }

  private paintArrows(ctx: CanvasRenderingContext2D) {
    const L = this.scene.layout
    const list: BoardArrow[] = [...this.scene.arrows, ...this.scene.checks.map((c) => ({ from: c.from, to: c.to, kind: 'check' as const }))]
    if (!list.length) return
    const view = new THREE.Vector3(0, 0, 1)
    const sq3 = (pos: Pos): THREE.Vector3 | null => {
      const p = L.boardsByKey.get(`${pos.l}:${pos.t}`)
      if (!p) return null
      const o = squareOffset(p, pos.x, pos.y, L.flip)
      return new THREE.Vector3(p.x + o.x, p.y + o.y, 0)
    }
    const colors: Record<string, string> = { 'last-move': COLORS.arrowMove, pending: COLORS.arrowPending, check: COLORS.arrowCheck }
    const tri = (pos: number[], color: string) => {
      ctx.fillStyle = color
      ctx.strokeStyle = color
      ctx.lineWidth = 0.002
      for (let i = 0; i + 8 < pos.length; i += 9) {
        ctx.beginPath()
        ctx.moveTo(pos[i], pos[i + 1])
        ctx.lineTo(pos[i + 3], pos[i + 4])
        ctx.lineTo(pos[i + 6], pos[i + 7])
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
    }
    for (const a of list) {
      const from = sq3(a.from)
      const to = sq3(a.to)
      if (!from || !to) continue
      const fp = L.boardsByKey.get(`${a.from.l}:${a.from.t}`)!
      const sq = fp.square
      const len = from.distanceTo(to)
      if (len < 1e-6) continue
      const same = a.from.l === a.to.l && a.from.t === a.to.t
      let pts: THREE.Vector3[]
      if (same) pts = [from, to]
      else {
        const mid = from.clone().add(to).multiplyScalar(0.5)
        const bow = Math.min(len * 0.07, 0.6)
        mid.x -= bow * 0.6
        mid.y -= bow * 0.8
        pts = bezier3(from, mid, to, 32)
      }
      const outline: number[] = []
      const core: number[] = []
      arrowPositions(pts, (ARROW_HALF + ARROW_OUTLINE) * sq, ARROW_HEAD_LEN * sq, (ARROW_HEAD_HALF + ARROW_OUTLINE * 1.6) * sq, view, outline, ARROW_OUTLINE * sq)
      arrowPositions(pts, ARROW_HALF * sq, ARROW_HEAD_LEN * sq, ARROW_HEAD_HALF * sq, view, core)
      tri(outline, COLORS.arrowOutline)
      tri(core, colors[a.kind] ?? COLORS.arrowMove)
    }
  }

  dispose() {
    for (const e of this.boardCanvases.values()) {
      e.canvas.width = 0
      e.canvas.height = 0
    }
    this.boardCanvases.clear()
    tintCache.clear()
    this.barLabel = null
  }
}

const tintCache = new Map<string, HTMLCanvasElement>()
function tintCanvas(src: HTMLCanvasElement, color: string): HTMLCanvasElement {
  let c = tintCache.get(color)
  if (c && c.width === src.width && c.height === src.height) return c
  c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = color
  ctx.fillRect(0, 0, c.width, c.height)
  tintCache.set(color, c)
  return c
}

/**
 * Where complete "The Present" labels go along the bar (as renderer.ts placeLabels):
 * beyond the markers and present-column boards, repeating outwards, centred in gaps.
 */
export function presentLabelSpans(L: Layout, len: number, lo: number, hi: number): [number, number][] {
  const period = len + BAR_TEXT_GAP
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
  const spans: [number, number][] = []
  const push = (bottom: number) => {
    if (bottom + len >= lo && bottom <= hi) spans.push([bottom, bottom + len])
  }
  if (!merged.length) {
    for (let k = Math.floor(lo / period) - 1; k * period <= hi; k++) push(k * period)
  } else {
    const top = merged[merged.length - 1][1]
    const bottom = merged[0][0]
    for (let k = Math.max(0, Math.floor((lo - top - len) / period)); top + k * period <= hi; k++) push(top + k * period)
    for (let k = Math.max(0, Math.floor((bottom - hi - len) / period)); bottom - len - k * period >= lo - len; k++) push(bottom - len - k * period)
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
  return spans
}
