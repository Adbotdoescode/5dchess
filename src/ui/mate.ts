// Main-thread client for the mate-detection worker.

import type { Action } from '../engine'

export interface MateRequest {
  id: number
  variantId: string
  actions: Action[]
  budgetMs: number
}

export interface MateResponse {
  id: number
  inCheck: boolean
  /** false = no legal action (mate or stalemate); null = search timed out / failed. */
  hasLegal: boolean | null
  error?: string
}

let worker: Worker | null = null
let busy: { id: number; resolve: (r: MateResponse) => void } | null = null
let nextId = 1

function spawn(): Worker {
  const w = new Worker(new URL('./mateWorker.ts', import.meta.url), { type: 'module' })
  w.onmessage = (e: MessageEvent<MateResponse>) => {
    if (busy && busy.id === e.data.id) {
      const b = busy
      busy = null
      b.resolve(e.data)
    }
  }
  w.onerror = (e) => {
    console.error('[mate worker]', e.message)
    if (busy) {
      const b = busy
      busy = null
      b.resolve({ id: b.id, inCheck: false, hasLegal: null, error: e.message })
    }
    worker?.terminate()
    worker = null
  }
  return w
}

/**
 * Is the player to move after `actions` checkmated / stalemated? A newer request
 * cancels an older one still running (its promise resolves with hasLegal: null).
 */
export function detectEnd(variantId: string, actions: readonly Action[], budgetMs = 20000): Promise<MateResponse> {
  if (busy) {
    // the worker is single-threaded: restart it rather than queueing behind a long search
    worker?.terminate()
    worker = null
    const b = busy
    busy = null
    b.resolve({ id: b.id, inCheck: false, hasLegal: null, error: 'cancelled' })
  }
  if (!worker) worker = spawn()
  const id = nextId++
  return new Promise((resolve) => {
    busy = { id, resolve }
    const req: MateRequest = { id, variantId, actions: actions.map((a) => ({ player: a.player, moves: a.moves.slice() })), budgetMs }
    worker!.postMessage(req)
  })
}
