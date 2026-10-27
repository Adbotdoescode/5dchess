// Test helper: seeded random legal games that time-travel a lot (many
// timelines), for logic_test.ts and latency measurements. Not deployed.

import { Game } from '../_shared/engine.js'
import type { Action, Move } from '../_shared/engine.js'

function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** One random legal action for the player to move (prefers time travel), or null if none found. */
export function randomAction(g: Game, rand: () => number, travelBias = 0.6): Action | null {
  for (let attempt = 0; attempt < 40; attempt++) {
    while (g.undoMove());
    let guard = 0
    while (g.submitBlocker() === 'must-move-present' && guard++ < 60) {
      const required = g.requiredBoards()
      const b = required[Math.floor(rand() * required.length)]
      const pieces = g.movablePieces().filter((p) => p.l === b.l && p.t === b.t)
      if (pieces.length === 0) break
      const all: Move[] = pieces.flatMap((p) => g.movesFrom(p))
      if (all.length === 0) break
      const travel = all.filter((m) => g.moveKind(m) !== 'spatial')
      const pool = travel.length > 0 && rand() < travelBias ? travel : all
      g.makeMove(pool[Math.floor(rand() * pool.length)])
    }
    if (g.canSubmit()) {
      const action = { player: g.player, moves: g.pendingMoves.slice() }
      while (g.undoMove());
      return action
    }
  }
  while (g.undoMove());
  const moves = g.findLegalAction(2000)
  return moves ? { player: g.player, moves } : null
}

/** Play `n` random actions of `variantId` (stops early if the game ends). */
export function randomGame(variantId: string, n: number, seed = 1): { actions: Action[]; game: Game } {
  const rand = rng(seed)
  const g = Game.create(variantId, { skipMateDetection: true })
  const actions: Action[] = []
  for (let i = 0; i < n; i++) {
    const a = randomAction(g, rand)
    if (!a) break
    g.applyAction(a)
    actions.push(a)
  }
  return { actions, game: g }
}
