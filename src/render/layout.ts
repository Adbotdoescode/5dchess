// Pure layout: turns a RenderModel into world-space placements. No three.js.
//
// Conventions (world units, y axis pointing UP on screen):
//  - column x = t (half-turn) normally, or floor(t/2) in Parallel View;
//  - row y = -l when viewing as white (white's timelines, l > 0, below the
//    main line) and y = +l when viewing as black.

import type { Board, Color, Timeline } from '../engine/types'
import type { HighlightedSquare, RenderModel } from './types'
import {
  BAND_LEAD,
  BOARD_INNER,
  BRANCH_RADIUS,
  FRAME_THICK,
  FRAME_THIN,
  HEAD_BASE,
  HEAD_HALF,
  HEAD_TIP,
  LABEL_RIGHT,
  TAIL_FADE,
  TURN_LABEL_DROP,
} from './constants'

export type FrameStyle = 'white' | 'black' | 'pending' | 'pending-move' | 'check'
export type BandStyle = 'active' | 'white' | 'black'

export interface BoardPlacement {
  key: string
  l: number
  t: number
  board: Board
  x: number
  y: number
  /** Outer size including the frame. */
  w: number
  h: number
  /** Size of one square. */
  square: number
  frameWidth: number
  frame: FrameStyle
  thick: boolean
  faded: boolean
  required: boolean
  highlights: HighlightedSquare[]
}

export interface Vec2 {
  x: number
  y: number
}

export interface TimelinePlacement {
  l: number
  style: BandStyle
  /** Centre line of the band, ending at the arrowhead base. */
  path: Vec2[]
  /** Arrowhead triangle [base top, tip, base bottom]. */
  head: [Vec2, Vec2, Vec2]
  y: number
  endX: number
  /** Starting timelines fade in over this length at the start of the band (0 = none). */
  tail: number
}

/** Faint world-anchored labels on the floor: timeline names ("0L") and turns ("T1"). */
export interface FloorLabel {
  text: string
  /** Anchor point: right edge (timeline labels) or centre (turn labels), vertically centred. */
  x: number
  y: number
  align: 'right' | 'center'
}

export interface MarkerPlacement {
  color: Color
  x: number
  y: number
  arrow: boolean
  /** +1 arrow points up on screen, -1 down. */
  dir: 1 | -1
}

export interface Layout {
  boards: BoardPlacement[]
  boardsByKey: Map<string, BoardPlacement>
  timelines: TimelinePlacement[]
  presentX: number
  presentColor: Color
  markers: MarkerPlacement[]
  /** Width of one background checker cell (one full turn). */
  cellWidth: number
  /** World x of the left edge of the cell of turn 0. */
  cellOrigin: number
  /** Vertical offset of row boundaries (0.5 for even-timeline variants). */
  rowOffset: number
  /** Board-content flip (black perspective). */
  flip: boolean
  bounds: { minX: number; maxX: number; minY: number; maxY: number }
  /** Bounds of the present column over active timelines. */
  presentBounds: { minX: number; maxX: number; minY: number; maxY: number }
  /** Timeline labels along the right of the multiverse and turn labels below it. */
  labels: FloorLabel[]
}

/** Notation name of a timeline row that may not exist yet (5D PGN; even variants use +0/-0). */
export function timelineName(l: number): string {
  if (Number.isInteger(l)) return `${l > 0 ? '+' : l < 0 ? '-' : ''}${Math.abs(l)}L`
  return `${l > 0 ? '+' : '-'}${Math.abs(l) - 0.5}L`
}

export const boardKey = (l: number, t: number): string => `${l}:${t}`
export const colorAt = (t: number): Color => (((t % 2) + 2) % 2 === 0 ? 'white' : 'black')

export function rowY(l: number, perspective: Color): number {
  return perspective === 'white' ? 0 - l : l // (0 - l avoids -0)
}

export function columnX(t: number, parallel: boolean): number {
  return parallel ? Math.floor(t / 2) : t
}

/** Outer board size for a w x h board. */
export function boardSize(width: number, height: number, thick: boolean) {
  const square = BOARD_INNER / Math.max(width, height, 1)
  const frameWidth = thick ? FRAME_THICK : FRAME_THIN
  return {
    square,
    frameWidth,
    w: square * width + 2 * frameWidth,
    h: square * height + 2 * frameWidth,
  }
}

function arcPoints(cx: number, cy: number, r: number, a0: number, a1: number, out: Vec2[]) {
  const steps = Math.max(6, Math.ceil((Math.abs(a1 - a0) / (Math.PI / 2)) * 12))
  for (let i = 1; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps
    out.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) })
  }
}

/**
 * Centre line of a timeline band. Starting timelines run in from the left;
 * branched ones leave their source board horizontally, turn through a rounded
 * corner into the gap before their first column, run vertically, and turn
 * again into their own row.
 */
function timelinePath(
  y: number,
  firstX: number,
  headBaseX: number,
  src: { x: number; y: number } | null,
): Vec2[] {
  if (!src || Math.abs(src.y - y) < 1e-6) {
    const startX = src ? src.x : firstX - BAND_LEAD
    if (!src) {
      // starting timelines fade in from the left (the original's soft tail)
      return [
        { x: startX, y },
        { x: startX + TAIL_FADE, y },
        { x: Math.max(headBaseX, startX + TAIL_FADE + 0.01), y },
      ]
    }
    return [
      { x: startX, y },
      { x: headBaseX, y },
    ]
  }
  const vx = firstX - 0.5
  const dy = y - src.y
  const sign = dy > 0 ? 1 : -1
  const r = Math.min(BRANCH_RADIUS, Math.abs(dy) / 2, Math.max(0.05, vx - src.x))
  const pts: Vec2[] = [{ x: Math.min(src.x, vx - r - 0.01), y: src.y }, { x: vx - r, y: src.y }]
  // first corner: centre (vx - r, src.y + sign*r), from angle -sign*90deg to 0
  arcPoints(vx - r, src.y + sign * r, r, -sign * (Math.PI / 2), 0, pts)
  pts.push({ x: vx, y: y - sign * r })
  // second corner: centre (vx + r, y - sign*r), from 180deg towards +x
  arcPoints(vx + r, y - sign * r, r, Math.PI, Math.PI - sign * (Math.PI / 2), pts)
  pts.push({ x: Math.max(headBaseX, vx + r + 0.01), y })
  return pts
}

export function computeLayout(model: RenderModel): Layout {
  const snap = model.snapshot
  const persp = model.perspective
  const parallel = model.viewFilter === 'parallel'
  const flip = persp === 'black'
  const pending = new Set(model.pendingBoards)
  const required = new Set(model.requiredBoards)

  const checkBoards = new Set<string>()
  for (const c of model.checks) checkBoards.add(boardKey(c.to.l, c.to.t))
  for (const a of model.arrows) if (a.kind === 'check') checkBoards.add(boardKey(a.to.l, a.to.t))

  const hl = new Map<string, HighlightedSquare[]>()
  for (const h of model.highlights) {
    const k = boardKey(h.pos.l, h.pos.t)
    let list = hl.get(k)
    if (!list) hl.set(k, (list = []))
    list.push(h)
  }

  const boards: BoardPlacement[] = []
  const boardsByKey = new Map<string, BoardPlacement>()
  const timelines: TimelinePlacement[] = []
  const tlByL = new Map<number, Timeline>()
  for (const tl of snap.timelines) tlByL.set(tl.l, tl)

  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let hasHalf = false

  const visible = (t: number) => !parallel || colorAt(t) === model.filterColor

  for (const tl of snap.timelines) {
    if (!Number.isInteger(tl.l)) hasHalf = true
    const y = rowY(tl.l, persp)
    const n = tl.boards.length
    let lastVisibleX = columnX(tl.startT, parallel)
    let firstVisibleX: number | null = null
    for (let i = 0; i < n; i++) {
      const board = tl.boards[i]
      const t = tl.startT + i
      if (!visible(t)) continue
      const thick = i === n - 1
      const key = boardKey(tl.l, t)
      const size = boardSize(board.width, board.height, thick)
      const x = columnX(t, parallel)
      lastVisibleX = x
      if (firstVisibleX === null) firstVisibleX = x
      const frame: FrameStyle = checkBoards.has(key)
        ? 'check'
        : pending.has(key)
          ? model.pendingBoardKinds?.[key] === 'move'
            ? 'pending-move'
            : 'pending'
          : colorAt(t)
      const p: BoardPlacement = {
        key,
        l: tl.l,
        t,
        board,
        x,
        y,
        w: size.w,
        h: size.h,
        square: size.square,
        frameWidth: size.frameWidth,
        frame,
        thick,
        faded: model.viewFilter === 'history' && colorAt(t) !== model.filterColor,
        required: required.has(key),
        highlights: hl.get(key) ?? [],
      }
      boards.push(p)
      boardsByKey.set(key, p)
      minX = Math.min(minX, x - size.w / 2)
      maxX = Math.max(maxX, x + size.w / 2)
      minY = Math.min(minY, y - size.h / 2)
      maxY = Math.max(maxY, y + size.h / 2)
    }

    const endT = tl.startT + n - 1
    const endX = parallel ? Math.max(lastVisibleX, columnX(endT, parallel)) : columnX(endT, parallel)
    const firstX = firstVisibleX ?? columnX(tl.startT + 1, parallel)
    let src: { x: number; y: number } | null = null
    if (tl.branchedFrom) {
      src = { x: columnX(tl.branchedFrom.t, parallel), y: rowY(tl.branchedFrom.l, persp) }
    }
    const headBaseX = endX + HEAD_BASE
    const path = timelinePath(y, firstX, headBaseX, src)
    const style: BandStyle = tl.active || !tl.createdBy ? 'active' : tl.createdBy
    timelines.push({
      l: tl.l,
      style,
      path,
      head: [
        { x: headBaseX, y: y + HEAD_HALF },
        { x: endX + HEAD_TIP, y },
        { x: headBaseX, y: y - HEAD_HALF },
      ],
      y,
      endX,
      tail: src ? 0 : TAIL_FADE,
    })
    maxX = Math.max(maxX, endX + HEAD_TIP)
    minX = Math.min(minX, path[0].x)
  }
  // draw order: parents before children (by |l|), so branch curves sit on top
  timelines.sort((a, b) => Math.abs(a.l) - Math.abs(b.l))

  const presentX = columnX(snap.present, parallel)

  // Markers on the present bar: where each colour's next timeline will appear.
  // The game puts each marker one row beyond that colour's last ACTIVE timeline
  // (in the original, white's marker sits on the row of its inactive timeline).
  let maxL = 0
  let minL = 0
  for (const tl of snap.timelines) {
    if (!tl.active && tl.createdBy) continue
    maxL = Math.max(maxL, tl.l)
    minL = Math.min(minL, tl.l)
  }
  const nextWhite = maxL + 1
  const nextBlack = minL - 1
  const markers: MarkerPlacement[] = (['white', 'black'] as const).map((color) => {
    const l = color === 'white' ? nextWhite : nextBlack
    const y = rowY(l, persp)
    return {
      color,
      x: presentX,
      y,
      arrow: snap.canCreateActiveTimeline[color],
      dir: y >= 0 ? 1 : -1,
    }
  })

  // Present column bounds over active timelines
  let pMinY = Infinity
  let pMaxY = -Infinity
  let pMaxX = presentX
  for (const tl of snap.timelines) {
    if (!tl.active) continue
    const y = rowY(tl.l, persp)
    pMinY = Math.min(pMinY, y)
    pMaxY = Math.max(pMaxY, y)
    const endT = tl.startT + tl.boards.length - 1
    pMaxX = Math.max(pMaxX, columnX(endT, parallel))
  }
  if (!Number.isFinite(pMinY)) {
    pMinY = 0
    pMaxY = 0
  }

  if (!Number.isFinite(minX)) {
    minX = -1
    maxX = 1
    minY = -1
    maxY = 1
  }

  const cellWidth = parallel ? 1 : 2

  // Floor labels (world-anchored, as in the original): timeline names right of the
  // furthest arrow tip, one row beyond the outermost timeline on each side; turn labels
  // below the lowest timeline row.
  const labels: FloorLabel[] = []
  if (snap.timelines.length) {
    let lMin = Infinity
    let lMax = -Infinity
    let rowMin = Infinity
    let endMax = -Infinity
    let tMin = Infinity
    let tMax = -Infinity
    const names = new Map<number, string>()
    for (const tl of snap.timelines) {
      lMin = Math.min(lMin, tl.l)
      lMax = Math.max(lMax, tl.l)
      rowMin = Math.min(rowMin, rowY(tl.l, persp))
      const endT = tl.startT + tl.boards.length - 1
      endMax = Math.max(endMax, columnX(endT, parallel))
      tMin = Math.min(tMin, tl.startT)
      tMax = Math.max(tMax, endT)
      names.set(tl.l, `${tl.label}L`)
    }
    const lx = endMax + LABEL_RIGHT
    for (let l = lMin - 1; l <= lMax + 1 + 1e-9; l++) labels.push({ text: names.get(l) ?? timelineName(l), x: lx, y: rowY(l, persp), align: 'right' })
    const ty = rowMin - TURN_LABEL_DROP
    const t0 = Math.floor(tMin / 2)
    const t1 = Math.floor(tMax / 2) + 1
    for (let T = Math.max(0, t0); T <= t1 && T - t0 < 2000; T++) labels.push({ text: `T${T}`, x: -0.5 + (T + 0.5) * cellWidth, y: ty, align: 'center' })
  }

  return {
    boards,
    boardsByKey,
    timelines,
    presentX,
    // The bar shows whose move it is AT the present: after a player has moved on every
    // present board (tentatively), the present shifts to the opponent's column and the
    // bar turns to that colour, as in the original.
    presentColor: colorAt(snap.present),
    markers,
    cellWidth,
    cellOrigin: -0.5,
    rowOffset: hasHalf ? 0.5 : 0,
    flip,
    bounds: { minX, maxX, minY, maxY },
    presentBounds: { minX: presentX - 0.5, maxX: pMaxX + 0.5, minY: pMinY - 0.5, maxY: pMaxY + 0.5 },
    labels,
  }
}

/** Board-local square from a point in board-local normalized coords (0..1, y up). */
export function squareAt(
  p: BoardPlacement,
  u: number,
  v: number,
  flip: boolean,
): { x: number; y: number } | null {
  const bw = p.board.width
  const bh = p.board.height
  const lx = u * p.w - p.frameWidth
  const ly = v * p.h - p.frameWidth
  const sc = Math.floor(lx / p.square)
  const sr = Math.floor(ly / p.square)
  if (sc < 0 || sr < 0 || sc >= bw || sr >= bh) return null
  // screen column/row -> board coords
  const x = flip ? bw - 1 - sc : sc
  const y = flip ? bh - 1 - sr : sr
  return { x, y }
}

/** Centre of square (x,y) in board-local offsets from the board centre (world units, y up). */
export function squareOffset(p: BoardPlacement, x: number, y: number, flip: boolean): Vec2 {
  const bw = p.board.width
  const bh = p.board.height
  const sc = flip ? bw - 1 - x : x
  const sr = flip ? bh - 1 - y : y
  return {
    x: (sc + 0.5 - bw / 2) * p.square,
    y: (sr + 0.5 - bh / 2) * p.square,
  }
}
