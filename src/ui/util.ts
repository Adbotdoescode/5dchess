// Small non-component helpers shared by the UI.

import { useCallback, useState } from 'react'
import type { Color, PieceType } from '../engine'
// straight from the pieces module (not the renderer entry) so the menu bundle stays free of three.js
import { pieceSvg } from '../render/pieces'

const glyphCache = new Map<string, string>()

/** data: URL of a piece image (cburnett set) for <img> glyphs. */
export function pieceUrl(type: PieceType, color: Color): string {
  const k = `${color}${type}`
  let url = glyphCache.get(k)
  if (!url) {
    url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(pieceSvg(type, color))
    glyphCache.set(k, url)
  }
  return url
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.cssText = 'position:fixed;left:-1000px;top:0;opacity:0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      ta.remove()
      return ok
    } catch {
      return false
    }
  }
}

export interface Toast {
  id: number
  text: string
  tone: 'info' | 'error'
}

let toastId = 1

/** Toast list state with auto-expiry; `push` is stable. */
export function useToasts(): [Toast[], (text: string, tone?: 'info' | 'error') => void] {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: 'info' | 'error' = 'info') => {
    const id = toastId++
    setToasts((t) => [...t.filter((x) => x.text !== text), { id, text, tone }].slice(-4))
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 5000 : 2600)
  }, [])
  return [toasts, push]
}
