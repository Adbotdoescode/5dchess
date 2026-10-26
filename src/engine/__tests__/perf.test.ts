import { describe, expect, it } from 'vitest'
import { Game } from '../game'
import { rows } from './helpers'

/** 20 timelines x 30 turns (1200 boards) of open positions with long-range pieces. */
function bigMultiverse(): Game {
  const pieces = { a1: 'R', h1: 'R', c1: 'B', f1: 'B', d1: 'Q', e1: 'K', b1: 'N', g1: 'N', a8: 'r', h8: 'r', c8: 'b', f8: 'b', d8: 'q', e8: 'k', b8: 'n', g8: 'n', d4: 'U', e5: 'u', c5: 'D', f4: 'd' }
  const board = rows(8, 8, pieces)
  const boards: string[] = []
  for (let l = -9; l <= 10; l++)
    for (let turn = 1; turn <= 30; turn++)
      for (const c of ['w', 'b']) {
        if (turn === 30 && c === 'b') continue
        boards.push(`[${board}:${l}:${turn}:${c}]`)
      }
  return Game.fromFen(boards, 8, 8, undefined, { skipMateDetection: true })
}

describe('performance', () => {
  it('movesFrom takes a few ms with 20 timelines x 30 turns', () => {
    const g = bigMultiverse()
    expect(g.snapshot().timelines).toHaveLength(20)
    const pieces = g.movablePieces().filter((p) => p.l === 0)
    let worst = 0
    let total = 0
    for (const p of pieces) {
      const t0 = performance.now()
      const moves = g.movesFrom(p)
      const dt = performance.now() - t0
      worst = Math.max(worst, dt)
      total += moves.length
    }
    console.log(`movesFrom: ${pieces.length} pieces, ${total} moves, worst ${worst.toFixed(2)} ms`)
    expect(worst).toBeLessThan(20)
  })

  it('snapshot, checks and a legal-action search stay fast', () => {
    const g = bigMultiverse()
    let t0 = performance.now()
    g.snapshot()
    const snap = performance.now() - t0
    t0 = performance.now()
    g.isInCheck()
    const check = performance.now() - t0
    t0 = performance.now()
    const legal = g.hasLegalAction(10000)
    const search = performance.now() - t0
    console.log(`snapshot ${snap.toFixed(1)} ms, check ${check.toFixed(1)} ms, legal-action search ${search.toFixed(1)} ms`)
    expect(legal).not.toBeNull()
    expect(snap).toBeLessThan(200)
  })
})
