// Menu backdrop approximating the original's blue-grey "time tunnel": twisted
// checkered rings receding to a pale centre, with chess-piece silhouettes
// flying out towards the viewer (docs/ui-spec.md §2.1). Plain canvas 2D.

import { useEffect, useRef } from 'react'
import type { Color, PieceType } from '../../engine'
import { pieceUrl } from '../util'

const EDGE = [0x7d, 0x8e, 0xac]
const CENTER = [0xb4, 0xba, 0xca]
const TYPES: PieceType[] = ['P', 'P', 'P', 'N', 'N', 'B', 'R', 'Q', 'K']

interface Flyer {
  img: HTMLImageElement
  angle: number
  z: number
  spin: number
  rot: number
  speed: number
}

function mix(a: number[], b: number[], k: number, shade: number): string {
  const c = a.map((v, i) => Math.round((v + (b[i] - v) * k) * shade))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export function Vortex() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current!
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const imgs = new Map<string, HTMLImageElement>()
    const getImg = (t: PieceType, c: Color) => {
      const k = t + c
      let img = imgs.get(k)
      if (!img) {
        img = new Image()
        img.src = pieceUrl(t, c)
        imgs.set(k, img)
      }
      return img
    }
    const spawn = (z = 0.02 + Math.random() * 0.05): Flyer => ({
      img: getImg(TYPES[Math.floor(Math.random() * TYPES.length)], Math.random() < 0.5 ? 'white' : 'black'),
      angle: Math.random() * Math.PI * 2,
      z,
      spin: (Math.random() - 0.5) * 1.6,
      rot: Math.random() * Math.PI * 2,
      speed: 0.11 + Math.random() * 0.08,
    })
    const flyers: Flyer[] = Array.from({ length: 16 }, () => spawn(Math.random() * 0.9))

    let w = 0
    let h = 0
    let dpr = 1
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      w = canvas.clientWidth
      h = canvas.clientHeight
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(canvas)

    const SEG = 14
    const RINGS = 22
    const RATIO = 0.8
    let raf = 0
    let last = performance.now()
    let time = 0
    const draw = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      time += dt
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const cx = w * 0.53
      const cy = h * 0.5
      const maxR = Math.hypot(w, h) * 0.75
      const phase = time * 0.22
      const shift = Math.floor(phase)
      const frac = phase - shift
      ctx.fillStyle = mix(EDGE, CENTER, 0, 1)
      ctx.fillRect(0, 0, w, h)
      for (let k = 0; k < RINGS; k++) {
        const j = k - frac
        const r = maxR * Math.pow(RATIO, j)
        if (r < 2) break
        const depth = Math.min(1, Math.max(0, j / (RINGS * 0.62)))
        const n = k + shift // stable ring identity as rings move outwards
        const twist = n * 0.23 + time * 0.05
        for (let s = 0; s < SEG; s++) {
          const a0 = twist + (s / SEG) * Math.PI * 2
          const a1 = twist + ((s + 1) / SEG) * Math.PI * 2
          const odd = (s + n) % 2 === 0
          ctx.fillStyle = mix(EDGE, CENTER, depth, odd ? 1 : 0.955)
          ctx.beginPath()
          ctx.moveTo(cx, cy)
          ctx.arc(cx, cy, r, a0, a1)
          ctx.closePath()
          ctx.fill()
        }
      }
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, maxR * 0.18)
      glow.addColorStop(0, 'rgba(205,210,222,0.85)')
      glow.addColorStop(1, 'rgba(205,210,222,0)')
      ctx.fillStyle = glow
      ctx.fillRect(0, 0, w, h)

      // flying pieces
      const base = Math.min(w, h)
      flyers.sort((a, b) => a.z - b.z)
      for (let i = 0; i < flyers.length; i++) {
        const f = flyers[i]
        f.z += f.speed * dt * (0.35 + f.z * 1.6)
        f.rot += f.spin * dt
        const dist = Math.pow(f.z, 2.2) * base * 1.25
        const size = (0.012 + Math.pow(f.z, 2.6) * 0.42) * base
        const x = cx + Math.cos(f.angle) * dist
        const y = cy + Math.sin(f.angle) * dist
        if (f.z > 1.15 || x < -size * 2 || x > w + size * 2 || y < -size * 2 || y > h + size * 2) {
          flyers[i] = spawn()
          continue
        }
        if (!f.img.complete || f.img.naturalWidth === 0) continue
        ctx.save()
        ctx.globalAlpha = Math.min(1, f.z * 6)
        ctx.translate(x, y)
        ctx.rotate(f.rot)
        ctx.drawImage(f.img, -size / 2, -size / 2, size, size)
        ctx.restore()
      }
      if (!reduce) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
    }
  }, [])
  return <canvas ref={ref} className="vortex" aria-hidden="true" />
}
