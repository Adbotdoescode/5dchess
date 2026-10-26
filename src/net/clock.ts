// Clock model shared with the server (see supabase/migrations/*_clock_delay.sql,
// function _clock_remaining_ms). Keep the two in sync.
//
// Original-game time controls ("20+5/L"): main time plus, at the start of each
// turn, a delay of delayPerTimeline x (active timelines at the start of that
// turn) during which the main clock doesn't run. Unused delay is lost.
//
//   L(0) = firstActiveTimelines, L(k) = nextActiveTimelines reported with action k-1
//   turn k runs from (actionTimes[k-1] or startedAt) to actionTimes[k] (or now)
//   main time used in turn k = max(0, duration - delayPerTimeline * L(k))
//   remaining(c) = initial - sum of main time used over c's turns
//
// After the game ends the running clock is frozen at endedAt.

import type { Color, GameResult } from '../engine/types'
import type { ClockSettings, ClockState } from './types'

export interface ClockInput {
  clock: null | ClockSettings
  firstPlayer: Color
  startedAt: number | null
  endedAt: number | null
  result: GameResult
  actions: ReadonlyArray<{ player: Color }>
  actionTimes: ReadonlyArray<number | null>
  /** Active timelines at the start of each turn (length actions.length + 1; missing entries count as 1). */
  activeTimelinesAtTurnStart: ReadonlyArray<number | null>
}

export const opposite = (c: Color): Color => (c === 'white' ? 'black' : 'white')

/** Side to move next, from the action list (strict alternation from firstPlayer). */
export function sideToMove(actions: ReadonlyArray<{ player: Color }>, firstPlayer: Color): Color {
  return actions.length === 0 ? firstPlayer : opposite(actions[actions.length - 1].player)
}

/** Remaining main time + delay per side at server time `serverNow` (ms). null if untimed. */
export function computeClocks(g: ClockInput, serverNow: number): ClockState | null {
  if (!g.clock) return null
  const initial = g.clock.initial * 1000
  const perLine = (g.clock.delayPerTimeline || 0) * 1000
  const delayFor = (turn: number) => perLine * (g.activeTimelinesAtTurnStart[turn] ?? 1)
  const mover = sideToMove(g.actions, g.firstPlayer)
  if (g.startedAt === null) {
    const delayMs = { white: 0, black: 0 }
    delayMs[mover] = delayFor(g.actions.length)
    return { white: Math.floor(initial), black: Math.floor(initial), running: null, flagged: null, delayRemaining: 0, delayMs }
  }
  const used = { white: 0, black: 0 }
  let prev = g.startedAt
  g.actions.forEach((a, i) => {
    const at = g.actionTimes[i] ?? prev
    used[a.player] += Math.max(at - prev - delayFor(i), 0)
    prev = at
  })
  const ongoing = g.result.kind === 'ongoing'
  const end = ongoing ? serverNow : (g.endedAt ?? serverNow)
  const elapsed = Math.max(end - prev, 0)
  const turnDelay = delayFor(g.actions.length)
  used[mover] += Math.max(elapsed - turnDelay, 0)
  const white = Math.floor(initial - used.white)
  const black = Math.floor(initial - used.black)
  const delayRemaining = ongoing ? Math.max(turnDelay - elapsed, 0) : 0
  const delayMs = { white: 0, black: 0 }
  delayMs[mover] = delayRemaining
  const flagged: Color | null =
    g.result.kind === 'timeout' ? opposite(g.result.winner) : white <= 0 ? 'white' : black <= 0 ? 'black' : null
  return { white, black, running: ongoing ? mover : null, flagged, delayRemaining, delayMs }
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
