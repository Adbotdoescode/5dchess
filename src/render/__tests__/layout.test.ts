import { describe, expect, it } from 'vitest'
import { computeLayout, squareAt, squareOffset } from '../layout'
import { fixtures } from '../demo/fixtures'

const byId = (id: string) => fixtures().find((f) => f.id === id)!.model

describe('computeLayout', () => {
  it('places white timelines below the main line for white, above for black', () => {
    const m = byId('multi')
    const w = computeLayout(m)
    expect(w.boardsByKey.get('0:2')!.y).toBe(0)
    expect(w.boardsByKey.get('1:3')!.y).toBe(-1)
    expect(w.boardsByKey.get('2:5')!.y).toBe(-2)
    const b = computeLayout({ ...m, perspective: 'black' })
    expect(b.boardsByKey.get('1:3')!.y).toBe(1)
    expect(b.flip).toBe(true)
  })

  it('uses half-turn columns, thick frames on end boards, pending/check frames', () => {
    const L = computeLayout(byId('multi'))
    const end = L.boardsByKey.get('1:9')!
    expect(end.x).toBe(9)
    expect(end.thick).toBe(true)
    expect(end.frame).toBe('pending')
    expect(L.boardsByKey.get('1:8')!.thick).toBe(false)
    expect(L.boardsByKey.get('0:3')!.frame).toBe('black')
    const C = computeLayout(byId('checks'))
    expect(C.boardsByKey.get('0:3')!.frame).toBe('check')
  })

  it('pending boards are yellow for ordinary moves and blue-violet for travel', () => {
    const m = byId('multi')
    const Y = computeLayout({ ...m, pendingBoardKinds: { '1:9': 'move' } })
    expect(Y.boardsByKey.get('1:9')!.frame).toBe('pending-move')
    const B = computeLayout({ ...m, pendingBoardKinds: { '1:9': 'travel' } })
    expect(B.boardsByKey.get('1:9')!.frame).toBe('pending')
  })

  it('bar colour follows the colour to move at the present; markers sit beyond the last active timeline', () => {
    const L = computeLayout(byId('branch'))
    expect(L.presentX).toBe(3)
    expect(L.presentColor).toBe('black')
    const M = computeLayout(byId('multi'))
    const white = M.markers.find((m) => m.color === 'white')!
    const black = M.markers.find((m) => m.color === 'black')!
    expect(white.y).toBe(-2) // +2 is inactive, so the marker shares its row
    expect(white.arrow).toBe(false)
    expect(black.y).toBe(1)
    expect(black.arrow).toBe(true)
  })

  it('branch bands turn in the gap before the first column', () => {
    const L = computeLayout(byId('branch'))
    const tl = L.timelines.find((t) => t.l === 1)!
    const xs = tl.path.map((p) => p.x)
    expect(Math.min(...xs)).toBeLessThanOrEqual(2)
    expect(tl.path.some((p) => Math.abs(p.x - 2.5) < 1e-9)).toBe(true)
    expect(tl.path[tl.path.length - 1].y).toBe(-1)
  })

  it('parallel view hides the other parity and packs columns', () => {
    const L = computeLayout({ ...byId('multi'), viewFilter: 'parallel', filterColor: 'white' })
    expect(L.boardsByKey.has('0:3')).toBe(false)
    expect(L.boardsByKey.get('0:8')!.x).toBe(4)
    expect(L.cellWidth).toBe(1)
  })

  it('square hit testing round-trips with square offsets, in both perspectives', () => {
    for (const persp of ['white', 'black'] as const) {
      const L = computeLayout({ ...byId('start'), perspective: persp })
      const p = L.boardsByKey.get('0:2')!
      for (const [x, y] of [[0, 0], [7, 7], [3, 5]]) {
        const o = squareOffset(p, x, y, L.flip)
        const sq = squareAt(p, o.x / p.w + 0.5, o.y / p.h + 0.5, L.flip)
        expect(sq).toEqual({ x, y })
      }
    }
  })
})
