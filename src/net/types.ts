// Contract for online play (Supabase Realtime + a small `games` table accessed
// only through RPC functions). No accounts: a seat is claimed with a random
// secret token kept in localStorage.

import type { Action, Color, GameResult } from '../engine/types'

/** Our relation to a game: a seat, or a read-only spectator. */
export type OnlineRole = Color | 'spectator'

/** Clock settings in seconds. */
export interface ClockSettings {
  initial: number
  /** Added to a player's clock after each of their submitted actions. */
  increment: number
}

/**
 * Remaining time per side in milliseconds (may go negative once a flag has
 * fallen; clamp for display). See computeClocks() for the model.
 */
export interface ClockState {
  white: number
  black: number
  /** Side whose clock is running (null before the game starts / after it ends). */
  running: Color | null
  /** Side whose time has run out, if any. */
  flagged: Color | null
}

export interface OnlineGameInfo {
  /** Short shareable join code, e.g. "K7QX2M". */
  code: string
  variantId: string
  /** Seat assigned to this client. */
  myColor: Color
  /** Submitted actions so far (authoritative, ordered). */
  actions: Action[]
  result: GameResult
  /** Optional clock settings in seconds (null = untimed). */
  clock: null | { initial: number; increment: number }

  // ---- Added for clocks / reconnects (all kept up to date by the session) ----

  /** Our seat, or 'spectator' (then myColor is just 'white' for perspective). */
  role: OnlineRole
  /** Side that submits action 0 ('white' unless the variant says otherwise). */
  firstPlayer: Color
  /** Both seats are taken. */
  opponentJoined: boolean
  /** Server time (ms since epoch) at which each action was accepted; parallel to `actions`. */
  actionTimes: (number | null)[]
  /** Server time (ms) the second seat was claimed; clocks start here. null while waiting. */
  startedAt: number | null
  /** Server time (ms) the result was recorded. */
  endedAt: number | null
  /** Estimated `serverTime - Date.now()` in ms (min-RTT sample over recent RPCs). */
  serverTimeOffset: number
  /** Server-computed remaining ms per side as of `clockMsAt` (null if untimed). */
  clockMs: null | { white: number; black: number }
  /** Server time (ms) at which `clockMs` was computed. */
  clockMsAt: number | null
}

export type OnlineEvent =
  | { type: 'opponent-joined' }
  | { type: 'opponent-presence'; online: boolean }
  /** An action submitted by the opponent; index is its position in the action list. */
  | { type: 'action'; index: number; action: Action; /** server accept time (ms) */ at?: number }
  | { type: 'result'; result: GameResult }
  | { type: 'draw-offer' }
  | { type: 'draw-declined' }
  | { type: 'rematch-offer' }
  /** Rematch accepted: a new game with swapped colors. */
  | { type: 'rematch-start'; code: string }
  | { type: 'error'; message: string }
  /**
   * Local history no longer matches the server in a way that can't be
   * expressed as opponent actions (e.g. our own action was stored by another
   * tab, or a submit whose response was lost). Rebuild from info.actions.
   */
  | { type: 'reset'; info: OnlineGameInfo }

export interface OnlineSession {
  /** Live view of the game, updated in place by the session (re-read fields; arrays may be replaced on 'reset'). */
  readonly info: OnlineGameInfo
  /** Send our submitted action (index must equal current action count). */
  submitAction(index: number, action: Action): Promise<void>
  setResult(result: GameResult): Promise<void>
  offerDraw(): void
  answerDraw(accept: boolean): void
  offerRematch(): void
  on(listener: (event: OnlineEvent) => void): () => void
  leave(): Promise<void>

  // ---- Added ----
  readonly role: OnlineRole
  /** Accept the opponent's rematch offer (same as offerRematch once they offered). */
  acceptRematch(): void
  /** Current clocks, using the estimated server time (null if untimed). */
  clocks(): ClockState | null
  /** Estimated current server time in ms. */
  serverNow(): number
  /** Fetch the authoritative state now and emit anything missed. */
  resync(): Promise<void>
}

/** A game this browser holds a seat token for (for "rejoin" lists). */
export interface RecentGame {
  code: string
  variantId: string
  color: OnlineRole
  /** ms since epoch. */
  lastSeen: number
  finished?: boolean
}

export interface OnlineApi {
  /** Create a game and claim a seat. `color: 'random'` picks one. */
  createGame(opts: {
    variantId: string
    color: Color | 'random'
    clock: null | { initial: number; increment: number }
    /** Side that submits the first action (default 'white'; set for turn-zero variants). */
    firstPlayer?: Color
  }): Promise<OnlineSession>
  /** Join by code (claims the free seat, or resumes our own seat on reconnect). */
  joinGame(code: string): Promise<OnlineSession>

  // ---- Added ----
  /** Watch a game without claiming a seat (resumes our seat if we hold one). */
  spectateGame(code: string): Promise<OnlineSession>
  /** Games we hold a seat token for, most recent first. */
  recentGames(): RecentGame[]
  /** Forget a game (drops its seat token; you can't resume that seat afterwards). */
  forgetGame(code: string): void
  /** Uppercase and strip spaces/dashes. */
  normalizeCode(code: string): string
  isValidCode(code: string): boolean
  /** `${location.origin}/?join=CODE` */
  shareUrl(code: string): string
  /** Extract a join code from a URL (`?join=`) or a bare code; defaults to location.href. */
  parseJoinCode(input?: string): string | null
}
