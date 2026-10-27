// Web Worker: end-of-game detection (checkmate / stalemate) off the main thread.
// The engine's exact search can take seconds with many timelines, so the UI's
// Game runs with `skipMateDetection` and asks this worker after every submit.

import { Game } from '../engine/game'
import type { MateRequest, MateResponse } from './mate'

const scope = self as unknown as {
  onmessage: ((e: MessageEvent<MateRequest>) => void) | null
  postMessage(msg: MateResponse): void
}

scope.onmessage = (e) => {
  const { id, variantId, actions, budgetMs } = e.data
  try {
    const g = Game.fromActions(variantId, actions, { skipMateDetection: true })
    const inCheck = g.isInCheck()
    const hasLegal = g.hasLegalAction(budgetMs)
    scope.postMessage({ id, inCheck, hasLegal })
  } catch (err) {
    scope.postMessage({ id, inCheck: false, hasLegal: null, error: String(err) })
  }
}
