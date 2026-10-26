// Clock model shared with the server (see supabase/migrations/*_clock_timestamps.sql,
// function _clock_remaining_ms). Keep the two in sync.
//
//   remaining(c) = initial + increment * (completed turns of c)
//                  - sum over c's turns of (action.at - previous action.at, or startedAt)
//                  - (if c is to move and the game is ongoing) (now - last action.at, or startedAt)
//
// After the game ends the running clock is frozen at endedAt.

import type { Color, GameResult } from '../engine/types'
import type { ClockState } from './types'

export interface ClockInput {
  clock: null | { initial: number; increment: number }
  firstPlayer: Color
  startedAt: number | null
  endedAt: number | null
  result: GameResult
  actions: ReadonlyArray<{ player: Color }>
  actionTimes: ReadonlyArray<number | null>
}

export const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white')

/** Side to move next, from the action list (strict alternation from firstPlayer). */
export function sideToMove(actions: ReadonlyArray<{ player: Color }>, firstPlayer: Color): Color {
  return actions.length === 0 ? firstPlayer : opposite(actions[actions.length - 1].player)
}

/** Remaining time per side at server time `serverNow` (ms). null if untimed. */
export function computeClocks(g: ClockInput, serverNow: number): ClockState | null {
  if (!g.clock) return null
  const initial = g.clock.initial * 1000
  const inc = (g.clock.increment || 0) * 1000
  if (g.startedAt === null) {
    return { white: Math.floor(initial), black: Math.floor(initial), running: null, flagged: null }
  }
  const used = { white: 0, black: 0 }
  const turns = { white: 0, black: 0 }
  let prev = g.startedAt
  g.actions.forEach((a, i) => {
    const at = g.actionTimes[i] ?? prev
    used[a.player] += at - prev
    turns[a.player] += 1
    prev = at
  })
  const ongoing = g.result.kind === 'ongoing'
  const mover = sideToMove(g.actions, g.firstPlayer)
  const end = ongoing ? serverNow : (g.endedAt ?? serverNow)
  used[mover] += Math.max(end - prev, 0)
  const white = Math.floor(initial + inc * turns.white - used.white)
  const black = Math.floor(initial + inc * turns.black - used.black)
  const flagged: Color | null =
    g.result.kind === 'timeout' ? opposite(g.result.winner) : white <= 0 ? 'white' : black <= 0 ? 'black' : null
  return { white, black, running: ongoing ? mover : null, flagged }
}

/** Parse a Postgres/ISO timestamp (microsecond precision tolerated) to ms. */
export function parseServerTime(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string' || !v) return null
  const ms = Date.parse(v.replace(/(\.\d{3})\d+/, '$1').replace(' ', 'T'))
  return Number.isNaN(ms) ? null : ms
}

/**
 * Estimates serverTime - localTime from RPC round trips: each sample assumes
 * the server stamped `serverNow` halfway through the round trip; the sample
 * with the smallest RTT among the recent ones wins.
 */
export class ClockOffsetEstimator {
  private samples: { offset: number; rtt: number }[] = []
  private best = 0

  add(sentAt: number, receivedAt: number, serverNow: number): void {
    const rtt = Math.max(receivedAt - sentAt, 0)
    this.samples.push({ offset: serverNow - (sentAt + receivedAt) / 2, rtt })
    if (this.samples.length > 10) this.samples.shift()
    this.best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a)).offset
  }

  get offset(): number {
    return this.best
  }
}
