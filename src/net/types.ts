// Contract for online play (Supabase Realtime + a small `games` table accessed
// only through RPC functions). No accounts: a seat is claimed with a random
// secret token kept in localStorage.

import type { Action, Color, GameResult } from '../engine/types'

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
}

export type OnlineEvent =
  | { type: 'opponent-joined' }
  | { type: 'opponent-presence'; online: boolean }
  /** An action submitted by the opponent; index is its position in the action list. */
  | { type: 'action'; index: number; action: Action }
  | { type: 'result'; result: GameResult }
  | { type: 'draw-offer' }
  | { type: 'draw-declined' }
  | { type: 'rematch-offer' }
  /** Rematch accepted: a new game with swapped colors. */
  | { type: 'rematch-start'; code: string }
  | { type: 'error'; message: string }

export interface OnlineSession {
  readonly info: OnlineGameInfo
  /** Send our submitted action (index must equal current action count). */
  submitAction(index: number, action: Action): Promise<void>
  setResult(result: GameResult): Promise<void>
  offerDraw(): void
  answerDraw(accept: boolean): void
  offerRematch(): void
  on(listener: (event: OnlineEvent) => void): () => void
  leave(): Promise<void>
}

export interface OnlineApi {
  /** Create a game and claim a seat. `color: 'random'` picks one. */
  createGame(opts: {
    variantId: string
    color: Color | 'random'
    clock: null | { initial: number; increment: number }
  }): Promise<OnlineSession>
  /** Join by code (claims the free seat, or resumes our own seat on reconnect). */
  joinGame(code: string): Promise<OnlineSession>
}
