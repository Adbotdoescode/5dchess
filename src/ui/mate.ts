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
  w.onerror = (e: ErrorEvent | Event) => {
    // A script that fails to load (e.g. offline right after a deploy) gives a bare Event
    // without a message: describe what we can.
    const ee = e as Partial<ErrorEvent>
    const detail =
      ee.message ||
      (ee.error instanceof Error ? `${ee.error.name}: ${ee.error.message}` : '') ||
      (ee.filename ? `error in ${ee.filename}:${ee.lineno ?? 0}` : '') ||
      `worker failed to start or crashed (${e.type}${navigator.onLine === false ? ', browser offline' : ''})`
    console.error('[mate worker]', detail, e)
    e.preventDefault?.()
    fail(detail)
  }
  w.onmessageerror = (e) => {
    console.error('[mate worker] could not read a message', e)
    fail('message error')
  }
  return w
}

/** Resolve the running request as failed and drop the worker (a fresh one is spawned next time). */
function fail(error: string): void {
  if (busy) {
    const b = busy
    busy = null
    b.resolve({ id: b.id, inCheck: false, hasLegal: null, error })
  }
  worker?.terminate()
  worker = null
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
  const id = nextId++
  try {
    if (!worker) worker = spawn()
  } catch (err) {
    console.error('[mate worker] could not be created', err)
    worker = null
    return Promise.resolve({ id, inCheck: false, hasLegal: null, error: String(err) })
  }
  return new Promise((resolve) => {
    busy = { id, resolve }
    const req: MateRequest = { id, variantId, actions: actions.map((a) => ({ player: a.player, moves: a.moves.slice() })), budgetMs }
    try {
      worker!.postMessage(req)
    } catch (err) {
      console.error('[mate worker] postMessage failed', err)
      fail(String(err))
    }
  })
}
