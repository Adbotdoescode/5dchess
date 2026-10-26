// Draws one board (frame, squares, highlights, coordinates, pieces) to a canvas.

import type { SquareHighlight } from './types'
import type { BoardPlacement, FrameStyle } from './layout'
import { COLORS, CORNER_THICK, CORNER_THIN, FADE_FRAME, FADE_PIECES, FADE_SQUARES, FRAME_RIM } from './constants'
import { pieceSprite } from './pieces'

/** Highlights drawn into the texture (hover is drawn as a cheap overlay instead). */
const TEXTURE_KINDS: SquareHighlight[] = ['moved', 'travel', 'check', 'destination', 'capture', 'selected']
const PRIORITY: Record<SquareHighlight, number> = {
  moved: 1,
  travel: 2,
  check: 3,
  destination: 4,
  capture: 5,
  selected: 6,
  hover: 0,
}

export function textureKey(p: BoardPlacement, flip: boolean, tier: number, piecesReady: boolean): string {
  let hk = ''
  if (p.highlights.length) {
    const parts: string[] = []
    for (const h of p.highlights) if (h.kind !== 'hover') parts.push(`${h.pos.x},${h.pos.y},${h.kind}`)
    parts.sort()
    hk = parts.join(';')
  }
  return `${tier}|${p.frame}|${p.thick ? 1 : 0}|${p.faded ? 1 : 0}|${flip ? 1 : 0}|${piecesReady ? 1 : 0}|${hk}`
}

function frameColors(frame: FrameStyle, thick: boolean): { body: string; rim: string } {
  switch (frame) {
    case 'white':
      return thick
        ? { body: COLORS.frameWhiteBody, rim: COLORS.frameWhiteRim }
        : { body: COLORS.frameWhiteThin, rim: COLORS.frameWhiteThin }
    case 'black':
      return thick
        ? { body: COLORS.frameBlackBody, rim: COLORS.frameBlackRim }
        : { body: COLORS.frameBlackThin, rim: COLORS.frameBlackThin }
    case 'pending':
      return { body: COLORS.framePendingBody, rim: COLORS.framePendingRim }
    case 'check':
      return { body: COLORS.frameCheckBody, rim: COLORS.frameCheckRim }
  }
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

/** Canvas pixel size for a board at the given resolution tier (px for the longer side). */
export function canvasSize(p: BoardPlacement, tier: number): { cw: number; ch: number } {
  const longer = Math.max(p.w, p.h)
  return { cw: Math.max(8, Math.round((tier * p.w) / longer)), ch: Math.max(8, Math.round((tier * p.h) / longer)) }
}

export function drawBoard(canvas: HTMLCanvasElement, p: BoardPlacement, flip: boolean, tier: number): void {
  const { cw, ch } = canvasSize(p, tier)
  if (canvas.width !== cw) canvas.width = cw
  if (canvas.height !== ch) canvas.height = ch
  const ctx = canvas.getContext('2d')!
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, cw, ch)
  const k = cw / p.w // px per world unit

  // Frame
  const fc = frameColors(p.frame, p.thick)
  const corner = (p.thick || p.frame === 'pending' || p.frame === 'check' ? CORNER_THICK : CORNER_THIN) * k
  roundRect(ctx, 0, 0, cw, ch, corner)
  ctx.fillStyle = fc.rim
  ctx.fill()
  if (fc.rim !== fc.body) {
    const rim = Math.max(1, FRAME_RIM * k)
    roundRect(ctx, rim, rim, cw - 2 * rim, ch - 2 * rim, Math.max(0, corner - rim))
    ctx.fillStyle = fc.body
    ctx.fill()
  }

  if (p.faded) veil(ctx, 0, 0, cw, ch, FADE_FRAME)

  // Squares
  const b = p.board
  const fw = p.frameWidth * k
  const sq = p.square * k
  const hl = new Map<number, SquareHighlight>()
  for (const h of p.highlights) {
    if (!TEXTURE_KINDS.includes(h.kind)) continue
    const idx = h.pos.y * b.width + h.pos.x
    const prev = hl.get(idx)
    if (!prev || PRIORITY[h.kind] > PRIORITY[prev]) hl.set(idx, h.kind)
  }
  // Snap square edges to whole pixels so neighbouring squares never leave seams.
  const edgeX = (i: number) => Math.round(fw + i * sq)
  const edgeY = (i: number) => Math.round(fw + i * sq)
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const sc = flip ? b.width - 1 - x : x
      const sr = flip ? y : b.height - 1 - y // canvas rows grow downwards
      const light = (x + y) % 2 === 1
      const kind = hl.get(y * b.width + x)
      let color: string = light ? COLORS.squareLight : COLORS.squareDark
      if (kind) {
        const pair = COLORS[kind as Exclude<SquareHighlight, 'hover'>]
        color = light ? pair[0] : pair[1]
      }
      ctx.fillStyle = color
      const x0 = edgeX(sc)
      const y0 = edgeY(sr)
      ctx.fillRect(x0, y0, edgeX(sc + 1) - x0, edgeY(sr + 1) - y0)
    }
  }

  // Coordinates (only when large enough to read)
  if (sq >= 22) {
    const fs = Math.max(6, sq * 0.17)
    ctx.font = `600 ${fs}px "Helvetica Neue", Arial, sans-serif`
    for (let sr = 0; sr < b.height; sr++) {
      // rank label at the right edge
      const y = flip ? sr : b.height - 1 - sr
      const sc = b.width - 1
      const x = flip ? b.width - 1 - sc : sc
      const light = (x + y) % 2 === 1
      ctx.fillStyle = light ? COLORS.squareDark : COLORS.squareLight
      ctx.textAlign = 'right'
      ctx.textBaseline = 'top'
      ctx.fillText(String(y + 1), edgeX(sc + 1) - sq * 0.06, edgeY(sr) + sq * 0.05)
    }
    for (let sc = 0; sc < b.width; sc++) {
      const x = flip ? b.width - 1 - sc : sc
      const sr = b.height - 1
      const y = flip ? sr : b.height - 1 - sr
      const light = (x + y) % 2 === 1
      ctx.fillStyle = light ? COLORS.squareDark : COLORS.squareLight
      ctx.textAlign = 'left'
      ctx.textBaseline = 'bottom'
      ctx.fillText(String.fromCharCode(97 + x), edgeX(sc) + sq * 0.06, edgeY(sr + 1) - sq * 0.02)
    }
  }

  if (p.faded) veil(ctx, fw, fw, cw - 2 * fw, ch - 2 * fw, FADE_SQUARES)

  // Pieces
  ctx.globalAlpha = p.faded ? FADE_PIECES : 1
  const spriteSize = Math.round(sq)
  for (let y = 0; y < b.height; y++) {
    for (let x = 0; x < b.width; x++) {
      const pc = b.squares[y * b.width + x]
      if (!pc) continue
      const sprite = pieceSprite(pc.type, pc.color, spriteSize)
      if (!sprite) continue
      const sc = flip ? b.width - 1 - x : x
      const sr = flip ? y : b.height - 1 - y
      const x0 = edgeX(sc)
      const y0 = edgeY(sr)
      ctx.drawImage(sprite, x0 + (edgeX(sc + 1) - x0 - spriteSize) / 2, y0 + (edgeY(sr + 1) - y0 - spriteSize) / 2)
    }
  }

  ctx.globalAlpha = 1
}

/** History View fade: a white veil that keeps transparent corners clear. */
function veil(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, alpha: number) {
  ctx.globalCompositeOperation = 'source-atop'
  ctx.fillStyle = `rgba(255,255,255,${alpha})`
  ctx.fillRect(x, y, w, h)
  ctx.globalCompositeOperation = 'source-over'
}
