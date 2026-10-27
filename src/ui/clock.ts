// Clocks for the HUD. Online games read session.clocks(); local games use the
// same model (src/net's pure computeClocks) fed with local timestamps:
//
//   main time used in a turn = max(0, turn length - delayPerTimeline x active timelines at turn start)
//
// i.e. the original's "20+5/L" time controls: a per-turn delay, no increment.

import type { Color, GameResult } from '../engine'
import { computeClocks } from '../net'
import type { ClockSettings, ClockState } from '../net'

/** What the clock widget shows. Times in ms. */
export interface ClockView {
  white: number
  black: number
  running: Color | null
  flagged: Color | null
  /** Remaining delay of the running side's current turn (ms). */
  delay: number
  /** Configured delay per active timeline (s), for the idle side's "+N". */
  delayPerTimeline: number
}

export function toClockView(c: ClockState, settings: ClockSettings | null): ClockView {
  return {
    white: c.white,
    black: c.black,
    running: c.running,
    flagged: c.flagged,
    delay: c.delayRemaining,
    delayPerTimeline: settings?.delayPerTimeline ?? 0,
  }
}

export interface LocalClockSave {
  startedAt: number
  actionTimes: number[]
  players: Color[]
  activeAtTurnStart: number[]
  endedAt: number | null
  savedAt: number
}

export class LocalClock {
  readonly settings: ClockSettings
  private firstPlayer: Color
  private startedAt: number
  private actionTimes: number[]
  private players: Color[]
  private activeAtTurnStart: number[]
  private endedAt: number | null

  constructor(settings: ClockSettings, firstPlayer: Color, activeTimelines: number, saved?: LocalClockSave | null, now = Date.now()) {
    this.settings = settings
    this.firstPlayer = firstPlayer
    if (saved) {
      // the clock was paused while the page was closed: shift every timestamp
      const shift = saved.endedAt === null ? now - saved.savedAt : 0
      this.startedAt = saved.startedAt + shift
      this.actionTimes = saved.actionTimes.map((t) => t + shift)
      this.players = saved.players.slice()
      this.activeAtTurnStart = saved.activeAtTurnStart.slice()
      this.endedAt = saved.endedAt
      this.firstPlayer = saved.players[0] ?? firstPlayer
    } else {
      this.startedAt = now
      this.actionTimes = []
      this.players = []
      this.activeAtTurnStart = [Math.max(1, activeTimelines)]
      this.endedAt = null
    }
  }

  private state(now: number, result: GameResult = { kind: 'ongoing' }): ClockState | null {
    return computeClocks(
      {
        clock: this.settings,
        firstPlayer: this.firstPlayer,
        startedAt: this.startedAt,
        endedAt: this.endedAt,
        result: this.endedAt !== null && result.kind === 'ongoing' ? { kind: 'draw-agreed' } : result,
        actions: this.players.map((player) => ({ player })),
        actionTimes: this.actionTimes,
        activeTimelinesAtTurnStart: this.activeAtTurnStart,
      },
      now,
    )
  }

  view(now = Date.now(), result?: GameResult): ClockView {
    return toClockView(this.state(now, result)!, this.settings)
  }

  /** `player` submitted; `nextActive` = active timelines at the start of the next turn. */
  submitted(player: Color, nextActive: number, now = Date.now()): void {
    if (this.endedAt !== null) return
    this.players.push(player)
    this.actionTimes.push(now)
    this.activeAtTurnStart.push(Math.max(1, nextActive))
  }

  stop(now = Date.now()): void {
    if (this.endedAt === null) this.endedAt = now
  }

  save(now = Date.now()): LocalClockSave {
    return {
      startedAt: this.startedAt,
      actionTimes: this.actionTimes.slice(),
      players: this.players.slice(),
      activeAtTurnStart: this.activeAtTurnStart.slice(),
      endedAt: this.endedAt,
      savedAt: now,
    }
  }
}

/** "20:00", "9:05", "0:07". Negative values clamp to 0. */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m)
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`
}
