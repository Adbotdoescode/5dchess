// Piece images: SVG sources -> HTMLImageElements -> cached raster sprites.

import type { Color, PieceType } from '../../engine/types'
import { CBURNETT } from './cburnett'
import { FAIRY } from './fairy'

const SOURCES: Record<string, string> = { ...CBURNETT, ...FAIRY }

export const pieceCode = (type: PieceType, color: Color) => `${color === 'white' ? 'w' : 'b'}${type}`

export function pieceSvg(type: PieceType, color: Color): string {
  return SOURCES[pieceCode(type, color)] ?? SOURCES[pieceCode('P', color)]
}

const images = new Map<string, HTMLImageElement>()
let loadPromise: Promise<void> | null = null

/** Loads all piece images once. Resolves when every image is decoded. */
export function loadPieceImages(): Promise<void> {
  if (loadPromise) return loadPromise
  const jobs: Promise<void>[] = []
  for (const [code, src] of Object.entries(SOURCES)) {
    const img = new Image()
    img.decoding = 'async'
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src)
    images.set(code, img)
    jobs.push(
      img.decode().catch(
        () =>
          new Promise<void>((res) => {
            if (img.complete) res()
            else img.onload = img.onerror = () => res()
          }),
      ),
    )
  }
  loadPromise = Promise.all(jobs).then(() => undefined)
  return loadPromise
}

let ready = false
export function piecesReady(): boolean {
  if (ready) return true
  for (const img of images.values()) if (!img.complete || img.naturalWidth === 0) return false
  ready = images.size > 0
  return ready
}

const sprites = new Map<string, HTMLCanvasElement>()

/** A square raster of the piece at `size` px (cached per size). */
export function pieceSprite(type: PieceType, color: Color, size: number): HTMLCanvasElement | null {
  const code = SOURCES[pieceCode(type, color)] ? pieceCode(type, color) : pieceCode('P', color)
  const px = Math.max(4, Math.round(size))
  const key = `${code}@${px}`
  let c = sprites.get(key)
  if (c) return c
  const img = images.get(code)
  if (!img || !img.complete || img.naturalWidth === 0) return null
  c = document.createElement('canvas')
  c.width = c.height = px
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, px, px)
  sprites.set(key, c)
  return c
}
