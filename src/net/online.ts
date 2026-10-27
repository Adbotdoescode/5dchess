// Online sessions: Supabase RPCs + the `game-action` Edge Function (source of
// truth) + a Realtime broadcast channel `game:<CODE>` (hints + presence).
// See AGENTS.md "Online play".
//
// Server authority: creating games, submitting actions and claiming results go
// through the Edge Function, which replays the game with the rules engine and
// rejects illegal actions; checkmate/stalemate are only recorded by the server.
// Draw offers, rematches and cancelling are token-checked RPCs whose state is
// persisted (info.drawOffer / rematchOffer / rematchCode / cancelled).
//
// Sync rules:
// * Broadcasts are untrusted hints (anyone with the code can send on the
//   channel). An 'action' or 'result' broadcast triggers get_game and the
//   events are emitted from the database snapshot, in order, de-duplicated.
// * We also resync on channel (re)subscribe, window focus / visibility /
//   online, and on a slow interval while waiting for the opponent.
// * The action list is append-only on the server, so a shorter snapshot is
//   stale and ignored. Our own actions are never emitted as 'action' events.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Action, Color, GameResult } from '../engine/types'
import { ClockOffsetEstimator, computeClocks, opposite, parseServerTime, sideToMove } from './clock'
import {
  defaultStorage,
  generateToken,
  isValidCode,
  normalizeCode,
  parseJoinCode,
  SeatStore,
  shareUrl,
  type KeyValueStorage,
} from './codes'
import type {
  ClockSettings,
  ClockState,
  OnlineApi,
  OnlineEvent,
  OnlineGameInfo,
  OnlineRole,
  OnlineSession,
  RecentGame,
} from './types'

// ---------------------------------------------------------------------------
// Minimal client surface (satisfied by SupabaseClient via fromSupabase, and by
// test mocks).

export interface RpcError {
  message: string
  /** Machine-readable reason from the Edge Function (e.g. 'illegal', 'out_of_sync'). */
  code?: string
  /** HTTP status (Edge Function calls). */
  status?: number
  /** The request never reached the server (offline, DNS, CORS, ...). */
  network?: boolean
}
export interface RpcResponse {
  data: unknown
  error: RpcError | null
}
export type ChannelStatus = 'SUBSCRIBED' | 'TIMED_OUT' | 'CLOSED' | 'CHANNEL_ERROR' | string
export type PresenceState = Record<string, Array<Record<string, unknown>>>

export interface NetChannel {
  onBroadcast(event: string, cb: (payload: unknown) => void): void
  onPresenceSync(cb: () => void): void
  subscribe(cb: (status: ChannelStatus, err?: Error) => void): void
  send(event: string, payload: unknown): Promise<unknown>
  track(state: Record<string, unknown>): Promise<unknown>
  presenceState(): PresenceState
  unsubscribe(): Promise<unknown>
}

export interface NetClient {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<RpcResponse>
  /** Call an Edge Function with a JSON body. */
  invoke(fn: string, body: Record<string, unknown>): PromiseLike<RpcResponse>
  channel(name: string, presenceKey: string): NetChannel
}

/** Name of the Edge Function that validates actions and results. */
export const GAME_FUNCTION = 'game-action'

/** Minimal shape of SupabaseClient we rely on (kept loose to avoid generic noise). */
interface SupabaseLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
  functions: {
    invoke(fn: string, opts: { body: unknown }): Promise<{ data: unknown; error: unknown }>
  }
  channel(name: string, opts?: unknown): unknown
  removeChannel(ch: never): Promise<unknown>
}

const NETWORK_RE = /failed to fetch|fetch failed|networkerror|network request failed|load failed|err_internet|offline/i

async function invokeFunction(client: SupabaseLike, fn: string, body: unknown): Promise<RpcResponse> {
  let res: { data: unknown; error: unknown }
  try {
    res = await client.functions.invoke(fn, { body })
  } catch (e) {
    return { data: null, error: { message: errorMessage(e), network: true } }
  }
  if (!res.error) return { data: res.data, error: null }
  const err = res.error as { name?: string; message?: string; context?: unknown }
  if (err.name === 'FunctionsHttpError' && err.context && typeof (err.context as Response).json === 'function') {
    const ctx = err.context as Response
    try {
      const j = (await ctx.clone().json()) as { error?: string; code?: string }
      return { data: null, error: { message: j.error ?? `${fn} failed (${ctx.status})`, code: j.code, status: ctx.status } }
    } catch {
      return { data: null, error: { message: `${fn} failed (${ctx.status})`, status: ctx.status } }
    }
  }
  if (err.name === 'FunctionsFetchError') return { data: null, error: { message: err.message ?? 'network error', network: true } }
  return { data: null, error: { message: err.message ?? `${fn} failed` } }
}

interface RealtimeChannelLike {
  on(type: string, filter: Record<string, unknown>, cb: (msg: unknown) => void): RealtimeChannelLike
  subscribe(cb: (status: string, err?: Error) => void): unknown
  send(msg: { type: 'broadcast'; event: string; payload: unknown }): Promise<unknown>
  track(state: Record<string, unknown>): Promise<unknown>
  presenceState(): PresenceState
}

// supabase-js keeps one RealtimeChannel per topic per client and refuses new
// listeners after subscribe(), so several sessions for the same game on one
// client (e.g. resuming without leaving first) share one channel, ref-counted.
interface ChannelMember {
  bcast: Map<string, ((p: unknown) => void)[]>
  presence: (() => void)[]
  status: ((s: ChannelStatus, err?: Error) => void) | null
}
interface SharedChannel {
  ch: RealtimeChannelLike
  members: Set<ChannelMember>
  status: ChannelStatus | null
}
interface ChannelRegistry {
  shared: Map<string, SharedChannel>
  removing: Map<string, Promise<unknown>>
}
const registries = new WeakMap<object, ChannelRegistry>()

export function fromSupabase(supabase: SupabaseClient): NetClient {
  const client = supabase as unknown as SupabaseLike
  let reg = registries.get(supabase)
  if (!reg) registries.set(supabase, (reg = { shared: new Map(), removing: new Map() }))
  const { shared, removing } = reg

  const open = (name: string, presenceKey: string, first: ChannelMember): SharedChannel => {
    const ch = client.channel(name, {
      config: { broadcast: { self: false, ack: false }, presence: { key: presenceKey } },
    }) as RealtimeChannelLike
    const sh: SharedChannel = { ch, members: new Set(), status: null }
    for (const event of first.bcast.keys()) {
      ch.on('broadcast', { event }, (msg) => {
        const payload = (msg as { payload?: unknown }).payload
        for (const m of sh.members) for (const cb of m.bcast.get(event) ?? []) cb(payload)
      })
    }
    ch.on('presence', { event: 'sync' }, () => {
      for (const m of sh.members) for (const cb of m.presence) cb()
    })
    ch.subscribe((status, err) => {
      sh.status = status
      for (const m of sh.members) m.status?.(status, err)
    })
    shared.set(name, sh)
    return sh
  }

  return {
    rpc: async (fn, args) => {
      try {
        const { data, error } = await client.rpc(fn, args)
        if (error && NETWORK_RE.test(error.message)) return { data, error: { message: error.message, network: true } }
        return { data, error }
      } catch (e) {
        return { data: null, error: { message: errorMessage(e), network: true } }
      }
    },
    invoke: (fn, body) => invokeFunction(client, fn, body),
    channel(name, presenceKey) {
      const member: ChannelMember = { bcast: new Map(), presence: [], status: null }
      let sh: SharedChannel | null = null
      let closed = false
      return {
        onBroadcast: (event, cb) => void member.bcast.set(event, [...(member.bcast.get(event) ?? []), cb]),
        onPresenceSync: (cb) => void member.presence.push(cb),
        subscribe(cb) {
          member.status = cb
          void (async () => {
            await removing.get(name)
            if (closed) return
            sh = shared.get(name) ?? open(name, presenceKey, member)
            sh.members.add(member)
            if (sh.status === 'SUBSCRIBED') cb('SUBSCRIBED')
          })()
        },
        send: async (event, payload) => {
          if (!sh) throw new Error('channel not subscribed yet')
          return sh.ch.send({ type: 'broadcast', event, payload })
        },
        track: async (state) => sh?.ch.track(state),
        presenceState: () => sh?.ch.presenceState() ?? {},
        async unsubscribe() {
          closed = true
          const s = sh
          sh = null
          if (!s) return
          s.members.delete(member)
          if (s.members.size > 0 || shared.get(name) !== s) return
          shared.delete(name)
          const p = client.removeChannel(s.ch as never).finally(() => {
            if (removing.get(name) === p) removing.delete(name)
          })
          removing.set(name, p)
          await p
        },
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Environment hooks (window events, timers) – injectable for tests.

export interface NetEnv {
  /** Subscribe to "you may have missed something" signals (focus, visible, online). */
  onWake(cb: () => void): () => void
  setInterval(cb: () => void, ms: number): unknown
  clearInterval(handle: unknown): void
  setTimeout(cb: () => void, ms: number): unknown
  now(): number
}

export function browserEnv(): NetEnv {
  return {
    onWake(cb) {
      if (typeof window === 'undefined') return () => {}
      const onVis = () => {
        if (typeof document === 'undefined' || document.visibilityState === 'visible') cb()
      }
      window.addEventListener('focus', cb)
      window.addEventListener('online', cb)
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVis)
      return () => {
        window.removeEventListener('focus', cb)
        window.removeEventListener('online', cb)
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis)
      }
    },
    setInterval: (cb, ms) => globalThis.setInterval(cb, ms),
    clearInterval: (h) => globalThis.clearInterval(h as ReturnType<typeof setInterval>),
    setTimeout: (cb, ms) => globalThis.setTimeout(cb, ms),
    now: () => Date.now(),
  }
}

// ---------------------------------------------------------------------------
// Server snapshot parsing.

interface Snapshot {
  code: string
  variantId: string
  role: OnlineRole
  actions: Action[]
  actionTimes: (number | null)[]
  /** Per action: active-timeline count at the start of the next turn (server-computed). */
  nextActiveTimelines: (number | null)[]
  firstActiveTimelines: number
  result: GameResult
  clock: null | ClockSettings
  opponentJoined: boolean
  firstPlayer: Color
  startedAt: number | null
  endedAt: number | null
  serverNow: number | null
  clockMs: null | { white: number; black: number }
  drawOffer: Color | null
  rematchOffer: Color | null
  rematchCode: string | null
  cancelled: boolean
}

function isColor(v: unknown): v is Color {
  return v === 'white' || v === 'black'
}

export function parseSnapshot(data: unknown): Snapshot {
  if (!data || typeof data !== 'object') throw new Error('Unexpected server response')
  const d = data as Record<string, unknown>
  if (typeof d.code !== 'string' || !Array.isArray(d.actions)) throw new Error('Unexpected server response')
  const actions: Action[] = []
  const actionTimes: (number | null)[] = []
  const nextActiveTimelines: (number | null)[] = []
  for (const raw of d.actions as unknown[]) {
    const { at, nextActiveTimelines: next, ...rest } = (raw ?? {}) as Record<string, unknown>
    actions.push(rest as unknown as Action)
    actionTimes.push(parseServerTime(at))
    nextActiveTimelines.push(positiveInt(next))
  }
  const role: OnlineRole = isColor(d.myColor) ? d.myColor : 'spectator'
  const result = (d.result && typeof d.result === 'object' ? d.result : { kind: 'ongoing' }) as GameResult
  const clock =
    d.clock && typeof d.clock === 'object'
      ? {
          initial: Number((d.clock as Record<string, unknown>).initial) || 0,
          delayPerTimeline: Number((d.clock as Record<string, unknown>).delayPerTimeline) || 0,
        }
      : null
  const cm = d.clockMs as Record<string, unknown> | null | undefined
  const rematchCode = typeof d.rematchCode === 'string' && isValidCode(d.rematchCode) ? normalizeCode(d.rematchCode) : null
  return {
    code: d.code,
    variantId: String(d.variantId ?? ''),
    role,
    actions,
    actionTimes,
    nextActiveTimelines,
    firstActiveTimelines: positiveInt(d.firstActiveTimelines) ?? 1,
    result,
    clock,
    opponentJoined: d.opponentJoined === true,
    firstPlayer: isColor(d.firstPlayer) ? d.firstPlayer : 'white',
    startedAt: parseServerTime(d.startedAt),
    endedAt: parseServerTime(d.endedAt),
    serverNow: parseServerTime(d.serverNow),
    clockMs: cm && typeof cm === 'object' ? { white: Number(cm.white), black: Number(cm.black) } : null,
    drawOffer: isColor(d.drawOffer) ? d.drawOffer : null,
    rematchOffer: isColor(d.rematchOffer) ? d.rematchOffer : null,
    rematchCode,
    cancelled: d.cancelled === true,
  }
}

function positiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null
}

const turnStarts = (first: number, nexts: ReadonlyArray<number | null>) => [first, ...nexts]

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------
// Errors: server reasons -> messages fit for the UI.

/** An online call failed. `message` is user-facing; `reason` is the raw server text. */
export class NetError extends Error {
  /** Raw server/database message, for logs and tests. */
  readonly reason: string
  /** Machine-readable code ('illegal', 'out_of_sync', 'network', ...) when known. */
  readonly code: string
  readonly network: boolean
  constructor(message: string, reason: string, code: string, network = false) {
    super(message)
    this.name = 'NetError'
    this.reason = reason
    this.code = code
    this.network = network
  }
}

export const OFFLINE_RETRYING = "You're offline — retrying…"
export const OFFLINE_GAVE_UP = "Couldn't reach the server. Check your connection and try again."

const FRIENDLY: [RegExp, string, string][] = [
  [/out of sync/i, 'out_of_sync', 'Out of sync with the server — reloaded the latest position.'],
  [/not your turn/i, 'not_your_turn', "It's not your turn."],
  [/does not match your seat/i, 'wrong_seat', "That move isn't for your side."],
  [/game is over/i, 'game_over', 'The game is already over.'],
  [/game is not over/i, 'not_finished', "The game isn't over yet."],
  [/waiting for opponent/i, 'waiting', 'Waiting for your opponent to join.'],
  [/game was cancelled/i, 'cancelled', 'This game was cancelled.'],
  [/game not found/i, 'not_found', 'Game not found. Check the code.'],
  [/game is full/i, 'full', 'That game already has two players (game is full).'],
  [/not a player/i, 'not_player', "You don't have a seat in this game."],
  [/opponent already joined/i, 'joined', 'Your opponent has already joined, so the game can no longer be cancelled.'],
  [/no draw offer/i, 'no_draw_offer', "There's no draw offer from your opponent to answer."],
  [/only resign for yourself/i, 'forbidden', 'You can only resign for yourself.'],
  [/clock not expired/i, 'clock_not_expired', "The clock hasn't run out yet."],
  [/game is not timed/i, 'untimed', 'This game has no clock.'],
  [/no checkmate or stalemate/i, 'not_over', 'The server found a legal move, so the game goes on.'],
  [/could not confirm the end/i, 'inconclusive', "The server couldn't confirm the end of the game yet, so play continues."],
  [/history is invalid/i, 'corrupt_history', "This game's history is invalid on the server, so it can't continue."],
  [/unknown variant/i, 'unknown_variant', "The server doesn't know this variant."],
  [/game too long/i, 'too_long', 'This game has reached the maximum length.'],
]

/** Turn a raw server error into a NetError with a user-facing message. */
export function toNetError(err: RpcError): NetError {
  const raw = err.message || 'request failed'
  if (err.network) return new NetError(OFFLINE_GAVE_UP, raw, 'network', true)
  if (err.code === 'illegal' || /illegal action|malformed (move|action)/i.test(raw)) {
    const detail = raw.replace(/^illegal action:\s*/i, '')
    return new NetError(`That move was rejected by the server: ${detail}.`, raw, 'illegal')
  }
  for (const [re, code, message] of FRIENDLY) if (re.test(raw)) return new NetError(message, raw, err.code ?? code)
  if (err.status !== undefined && err.status >= 500) {
    return new NetError('The server had a problem. Please try again.', raw, err.code ?? 'server')
  }
  return new NetError(`The server rejected that (${raw}).`, raw, err.code ?? 'rejected')
}

/** Worth retrying automatically (the request may not have reached the server). */
const retryable = (e: unknown) =>
  e instanceof NetError && (e.network || e.code === 'server' || e.code === 'internal' || e.code === 'WORKER_LIMIT')

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000, 10000, 15000]

// ---------------------------------------------------------------------------

interface Ctx {
  client: NetClient
  seats: SeatStore
  env: NetEnv
  offset: ClockOffsetEstimator
  /** Calls an RPC, records a clock-offset sample, returns the parsed snapshot. Throws NetError. */
  call(fn: string, args: Record<string, unknown>): Promise<Snapshot>
  /** Same through the game-action Edge Function (body.op selects the operation). */
  callFn(body: Record<string, unknown>): Promise<Snapshot>
  createRaw(opts: {
    variantId: string
    color: Color | 'random'
    clock: null | ClockSettings
    firstPlayer?: Color
    firstActiveTimelines?: number
  }): Promise<{ token: string; snap: Snapshot }>
}

/** Broadcast hints. Every one of them only triggers a database read. */
type BroadcastMsg =
  | { t: 'action'; index: number; at?: number | null }
  | { t: 'result' }
  | { t: 'joined' }
  | { t: 'draw' }
  | { t: 'rematch' }
  | { t: 'cancelled' }

const BROADCAST_EVENT = 'msg'
const WAITING_POLL_MS = 4000
const OPPONENT_TURN_POLL_MS = 15000

export class GameSession implements OnlineSession {
  private ctx: Ctx
  private token: string
  private state: OnlineGameInfo
  private listeners = new Set<(e: OnlineEvent) => void>()
  private channel: NetChannel | null = null
  private presenceKey = generateToken().slice(0, 12)
  private opponentOnline: boolean | null = null
  private pendingIndex: number | null = null
  private syncing: Promise<void> | null = null
  private syncAgain = false
  private lastSync = 0
  private pollHandle: unknown = null
  private offWake: (() => void) | null = null
  private left = false

  constructor(ctx: Ctx, token: string, snap: Snapshot) {
    this.ctx = ctx
    this.token = token
    this.state = {
      code: snap.code,
      variantId: snap.variantId,
      myColor: snap.role === 'spectator' ? 'white' : snap.role,
      role: snap.role,
      actions: snap.actions,
      actionTimes: snap.actionTimes,
      result: snap.result,
      clock: snap.clock,
      firstPlayer: snap.firstPlayer,
      opponentJoined: snap.opponentJoined,
      startedAt: snap.startedAt,
      endedAt: snap.endedAt,
      serverTimeOffset: ctx.offset.offset,
      clockMs: snap.clockMs,
      clockMsAt: snap.serverNow,
      firstActiveTimelines: snap.firstActiveTimelines,
      activeTimelinesAtTurnStart: turnStarts(snap.firstActiveTimelines, snap.nextActiveTimelines),
      drawOffer: snap.drawOffer,
      rematchOffer: snap.rematchOffer,
      rematchCode: snap.rematchCode,
      cancelled: snap.cancelled,
    }
    if (snap.rematchCode) this.adoptRematchSeat(snap.rematchCode)
    this.lastSync = ctx.env.now()
  }

  get info(): OnlineGameInfo {
    return this.state
  }

  get role(): OnlineRole {
    return this.state.role
  }

  /** Subscribe to the channel, window events and polling. */
  start(): void {
    const ch = this.ctx.client.channel(`game:${this.state.code}`, this.presenceKey)
    this.channel = ch
    ch.onBroadcast(BROADCAST_EVENT, (payload) => this.onBroadcast(payload))
    ch.onPresenceSync(() => this.onPresence())
    ch.subscribe((status) => {
      if (this.left || status !== 'SUBSCRIBED') return
      void ch.track({ color: this.state.role }).catch(() => {})
      if (this.state.role !== 'spectator') this.broadcast({ t: 'joined' })
      this.backgroundSync()
    })
    this.offWake = this.ctx.env.onWake(() => this.backgroundSync())
    this.pollHandle = this.ctx.env.setInterval(() => this.poll(), WAITING_POLL_MS)
  }

  on(listener: (event: OnlineEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  serverNow(): number {
    return this.ctx.env.now() + this.ctx.offset.offset
  }

  clocks(): ClockState | null {
    return computeClocks(this.state, this.serverNow())
  }

  async submitAction(index: number, action: Action, opts?: { nextActiveTimelines?: number }): Promise<void> {
    if (this.state.role === 'spectator') throw this.fail('Spectators cannot move')
    this.pendingIndex = index
    let snap: Snapshot | undefined
    let retried = false
    try {
      for (let attempt = 0; ; attempt++) {
        try {
          snap = await this.ctx.callFn({
            op: 'submit',
            code: this.state.code,
            token: this.token,
            index,
            action,
            nextActiveTimelines: opts?.nextActiveTimelines ?? null,
          })
          break
        } catch (e) {
          if (retryable(e) && attempt < RETRY_DELAYS_MS.length && !this.left) {
            if (!retried) this.emit({ type: 'error', message: OFFLINE_RETRYING })
            retried = true
            await this.sleep(RETRY_DELAYS_MS[attempt])
            continue
          }
          if (retried && e instanceof NetError && e.code === 'out_of_sync') {
            // An earlier attempt may have been stored before its response was lost.
            await this.resync().catch(() => {})
            const stored = this.state.actions[index]
            if (stored && stored.player === action.player && this.state.actions.length === index + 1) {
              this.broadcast({ t: 'action', index, at: this.state.actionTimes[index] })
              return
            }
          }
          throw e
        }
      }
    } catch (e) {
      const err = this.asNetError(e)
      if (/out_of_sync|not_your_turn|game_over|cancelled/.test(err.code)) await this.resync().catch(() => {})
      throw this.fail(err)
    } finally {
      this.pendingIndex = null
    }
    if (!snap) throw this.fail('The server sent an unexpected response. Please try again.')
    this.pendingIndex = index
    this.apply(snap)
    this.pendingIndex = null
    if (snap.actions.length <= index) {
      // Not stored: our flag fell before the move reached the server.
      throw this.fail('Time expired')
    }
    this.broadcast({ t: 'action', index, at: snap.actionTimes[index] })
  }

  async setResult(result: GameResult): Promise<void> {
    if (this.state.role === 'spectator') throw this.fail('Spectators cannot set a result')
    for (let attempt = 0; ; attempt++) {
      try {
        const snap =
          result.kind === 'draw-agreed'
            ? await this.ctx.call('answer_draw', { p_code: this.state.code, p_token: this.token, p_accept: true })
            : await this.ctx.callFn({ op: 'result', code: this.state.code, token: this.token, result })
        // Our own result is not echoed as an event; a different one (an earlier
        // result, or the server's own verdict for a mate claim) is.
        if (sameJson(snap.result, result) && this.state.result.kind === 'ongoing') {
          this.state.result = snap.result
          this.touchRecent()
        }
        this.apply(snap)
        this.broadcast({ t: 'result' })
        return
      } catch (e) {
        const err = this.asNetError(e)
        const m = /clock not expired: (-?\d+) ms/i.exec(err.reason)
        if (m && attempt < 3) {
          // Our clock estimate ran slightly ahead of the server; retry when it agrees.
          await this.sleep(Math.min(Number(m[1]), 5000) + 100)
          continue
        }
        if (retryable(err) && attempt < 3) {
          await this.sleep(RETRY_DELAYS_MS[attempt])
          continue
        }
        if (err.code === 'no_draw_offer' || err.code === 'not_over' || err.code === 'inconclusive') {
          await this.resync().catch(() => {})
        }
        throw this.fail(err)
      }
    }
  }

  offerDraw(): void {
    if (this.state.role === 'spectator') return
    void this.rpcAction('offer_draw', {}, { t: 'draw' })
  }

  answerDraw(accept: boolean): void {
    if (this.state.role === 'spectator') return
    if (accept) {
      this.setResult({ kind: 'draw-agreed' }).catch(() => {})
    } else {
      void this.rpcAction('answer_draw', { p_accept: false }, { t: 'draw' })
    }
  }

  offerRematch(): void {
    if (this.state.role === 'spectator' || this.state.rematchCode) return
    void this.rpcAction('offer_rematch', {}, { t: 'rematch' })
  }

  acceptRematch(): void {
    this.offerRematch()
  }

  async cancel(): Promise<void> {
    if (this.state.role === 'spectator') throw this.fail('Spectators cannot cancel a game')
    let snap: Snapshot
    try {
      snap = await this.ctx.call('cancel_game', { p_code: this.state.code, p_token: this.token })
    } catch (e) {
      throw this.fail(this.asNetError(e))
    }
    this.apply(snap)
    this.broadcast({ t: 'cancelled' })
    this.ctx.seats.forget(this.state.code)
    await this.leave(false)
  }

  resync(): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true
      return this.syncing
    }
    const run = async () => {
      try {
        do {
          this.syncAgain = false
          const snap = await this.ctx.call('get_game', { p_code: this.state.code, p_token: this.token })
          this.lastSync = this.ctx.env.now()
          if (!this.left) this.apply(snap)
        } while (this.syncAgain && !this.left)
      } finally {
        this.syncing = null
      }
    }
    this.syncing = run()
    return this.syncing
  }

  async leave(remember = true): Promise<void> {
    if (this.left) return
    this.left = true
    if (this.pollHandle !== null) this.ctx.env.clearInterval(this.pollHandle)
    this.offWake?.()
    this.listeners.clear()
    if (remember) this.touchRecent()
    const ch = this.channel
    this.channel = null
    if (ch) await ch.unsubscribe().catch(() => {})
  }

  // ---- internals ----

  private emit(e: OnlineEvent): void {
    for (const l of [...this.listeners]) {
      try {
        l(e)
      } catch (err) {
        console.error('online listener failed', err)
      }
    }
  }

  private fail(e: string | NetError): Error {
    const err = typeof e === 'string' ? new NetError(e, e, 'client') : e
    this.emit({ type: 'error', message: err.message })
    return err
  }

  private asNetError(e: unknown): NetError {
    return e instanceof NetError ? e : new NetError(errorMessage(e), errorMessage(e), 'client')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise<void>((r) => this.ctx.env.setTimeout(r, ms))
  }

  /** A token-checked RPC returning the game; merges the snapshot and hints the opponent. */
  private async rpcAction(fn: string, args: Record<string, unknown>, hint: BroadcastMsg): Promise<void> {
    try {
      const snap = await this.ctx.call(fn, { p_code: this.state.code, p_token: this.token, ...args })
      this.apply(snap)
      this.broadcast(hint)
    } catch (e) {
      const err = this.asNetError(e)
      this.fail(err)
      await this.resync().catch(() => {})
    }
  }

  private backgroundSync(): void {
    if (this.left) return
    this.resync().catch((e) => console.warn('[net] resync failed:', errorMessage(e)))
  }

  private poll(): void {
    const s = this.state
    if (this.left || s.cancelled) return
    if (!s.opponentJoined) return this.backgroundSync()
    const sinceSync = this.ctx.env.now() - this.lastSync
    if (s.result.kind !== 'ongoing') {
      // Waiting for the opponent to answer our rematch offer.
      if (s.role !== 'spectator' && s.rematchOffer === s.role && !s.rematchCode) this.backgroundSync()
      return
    }
    const waitingOnOther = s.role === 'spectator' || sideToMove(s.actions, s.firstPlayer) !== s.role
    const offerOut = s.role !== 'spectator' && s.drawOffer === s.role
    if ((waitingOnOther || offerOut) && sinceSync >= OPPONENT_TURN_POLL_MS) this.backgroundSync()
  }

  /** The rematch reuses both seat token hashes, so our token also owns our seat there. */
  private adoptRematchSeat(code: string): void {
    if (this.state.role === 'spectator') return
    if (!this.ctx.seats.getToken(code)) this.ctx.seats.setToken(code, this.token)
  }

  /** Merge an authoritative snapshot, emitting events for anything new. */
  private apply(snap: Snapshot): void {
    const s = this.state
    s.serverTimeOffset = this.ctx.offset.offset
    const localLen = s.actions.length
    const stale = snap.actions.length < localLen
    let reset = false

    if (!stale) {
      // Check the overlap still agrees (cheap: last shared element).
      if (localLen > 0 && !sameJson(snap.actions[localLen - 1], s.actions[localLen - 1])) {
        reset = true
      }
      if (reset) {
        s.actions = snap.actions
        s.actionTimes = snap.actionTimes
        s.activeTimelinesAtTurnStart = turnStarts(snap.firstActiveTimelines, snap.nextActiveTimelines)
      } else {
        for (let i = 0; i < localLen; i++) {
          if (s.actionTimes[i] == null) s.actionTimes[i] = snap.actionTimes[i] ?? null
          if (s.activeTimelinesAtTurnStart[i + 1] == null) {
            s.activeTimelinesAtTurnStart[i + 1] = snap.nextActiveTimelines[i] ?? null
          }
        }
        for (let i = localLen; i < snap.actions.length; i++) {
          const action = snap.actions[i]
          const at = snap.actionTimes[i]
          const next = snap.nextActiveTimelines[i]
          s.actions.push(action)
          s.actionTimes.push(at)
          s.activeTimelinesAtTurnStart[i + 1] = next
          const mine = s.role !== 'spectator' && action.player === s.role
          if (reset) continue // already diverged: the 'reset' event carries the rest
          if (!mine) {
            const e: Extract<OnlineEvent, { type: 'action' }> = { type: 'action', index: i, action }
            if (at != null) e.at = at
            if (next != null) e.nextActiveTimelines = next
            this.emit(e)
          } else if (i !== this.pendingIndex) {
            reset = true // our action that this client didn't know about
          }
        }
      }
    }
    // else: stale snapshot (server list is append-only) – ignore its actions.

    if (snap.clockMs && snap.serverNow !== null && !stale) {
      s.clockMs = snap.clockMs
      s.clockMsAt = snap.serverNow
    }
    if (snap.startedAt !== null) s.startedAt = snap.startedAt
    if (snap.endedAt !== null) s.endedAt = snap.endedAt
    s.firstPlayer = snap.firstPlayer
    if (!s.clock && snap.clock) s.clock = snap.clock
    if (snap.cancelled) s.cancelled = true

    if (reset) this.emit({ type: 'reset', info: s })

    if (snap.opponentJoined && !s.opponentJoined) {
      s.opponentJoined = true
      this.emit({ type: 'opponent-joined' })
      this.touchRecent()
    }

    const ended = snap.result.kind !== 'ongoing' || s.result.kind !== 'ongoing'
    if (!stale) this.applyDrawOffer(snap.drawOffer, snap.actions.length > localLen, ended)

    if (snap.result.kind !== 'ongoing' && !sameJson(snap.result, s.result)) {
      s.result = snap.result
      this.emit({ type: 'result', result: snap.result })
      this.touchRecent()
    }

    this.applyRematch(snap)
  }

  private applyDrawOffer(next: Color | null, actionsGrew: boolean, ended: boolean): void {
    const s = this.state
    const prev = s.drawOffer
    s.drawOffer = next
    if (prev === next || s.role === 'spectator' || ended) return
    const opp = opposite(s.role)
    if (next === opp) this.emit({ type: 'draw-offer' })
    else if (prev === s.role) this.emit({ type: 'draw-declined', reason: actionsGrew ? 'expired' : 'declined' })
    else if (prev === opp) this.emit({ type: 'draw-offer-withdrawn' })
  }

  private applyRematch(snap: Snapshot): void {
    const s = this.state
    const player = s.role !== 'spectator'
    if (snap.rematchCode && !s.rematchCode) {
      s.rematchCode = snap.rematchCode
      s.rematchOffer = null
      this.adoptRematchSeat(snap.rematchCode)
      if (player) this.emit({ type: 'rematch-start', code: snap.rematchCode })
      return
    }
    if (s.rematchCode) return
    const prev = s.rematchOffer
    s.rematchOffer = snap.rematchOffer
    if (player && snap.rematchOffer && snap.rematchOffer !== prev && snap.rematchOffer !== s.role) {
      this.emit({ type: 'rematch-offer' })
    }
  }

  private onBroadcast(payload: unknown): void {
    if (this.left || !payload || typeof payload !== 'object') return
    const msg = payload as { t?: unknown; index?: unknown }
    const s = this.state
    switch (msg.t) {
      case 'action':
        // De-dup; otherwise verify against the database (also covers gaps).
        if (typeof msg.index === 'number' && msg.index < s.actions.length) return
        this.backgroundSync()
        return
      case 'result':
        if (s.result.kind === 'ongoing') this.backgroundSync()
        return
      case 'joined':
        if (!s.opponentJoined) this.backgroundSync()
        return
      case 'draw':
      case 'draw-offer':
      case 'draw-declined':
        if (s.result.kind === 'ongoing') this.backgroundSync()
        return
      case 'rematch':
      case 'rematch-offer':
      case 'rematch-start':
        if (!s.rematchCode) this.backgroundSync()
        return
      case 'cancelled':
        this.backgroundSync()
        return
    }
  }

  private onPresence(): void {
    const ch = this.channel
    const s = this.state
    if (!ch || this.left || s.role === 'spectator') return
    const opp = opposite(s.role)
    const metas = Object.values(ch.presenceState()).flat()
    const online = metas.some((m) => m.color === opp)
    if (online !== this.opponentOnline) {
      this.opponentOnline = online
      this.emit({ type: 'opponent-presence', online })
    }
    if (online && !s.opponentJoined) this.backgroundSync()
  }

  private broadcast(msg: BroadcastMsg): void {
    const ch = this.channel
    if (!ch || this.left) return
    ch.send(BROADCAST_EVENT, msg).catch((e) => console.warn('[net] broadcast failed:', errorMessage(e)))
  }

  private touchRecent(): void {
    if (this.state.role === 'spectator') return
    this.ctx.seats.touch({
      code: this.state.code,
      variantId: this.state.variantId,
      color: this.state.role,
      finished: this.state.result.kind !== 'ongoing' || this.state.cancelled,
    })
  }
}

function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'message' in e) return String((e as { message: unknown }).message)
  return String(e)
}

// ---------------------------------------------------------------------------

export interface OnlineApiOptions {
  /** Defaults to the shared Supabase client from env vars (created lazily). */
  client?: NetClient | (() => NetClient)
  /** Defaults to localStorage (in-memory fallback). */
  storage?: KeyValueStorage
  env?: NetEnv
  /** Start channel/polling automatically (default true). */
  autoStart?: boolean
}

export function createOnlineApi(opts: OnlineApiOptions = {}): OnlineApi {
  let client: NetClient | null = typeof opts.client === 'object' ? opts.client : null
  const getClient = (): NetClient => {
    if (client) return client
    if (typeof opts.client === 'function') client = opts.client()
    else throw new Error('No Supabase client configured')
    return client
  }
  let seats: SeatStore | null = null
  const getSeats = () => (seats ??= new SeatStore(opts.storage ?? defaultStorage()))
  const env = opts.env ?? browserEnv()
  const offset = new ClockOffsetEstimator()

  const finish = (label: string, sent: number, res: RpcResponse): Snapshot => {
    const received = env.now()
    if (res.error) throw toNetError({ ...res.error, message: res.error.message || `${label} failed` })
    let snap: Snapshot
    try {
      snap = parseSnapshot(res.data)
    } catch (e) {
      throw new NetError('The server sent an unexpected response. Please try again.', errorMessage(e), 'server')
    }
    if (snap.serverNow !== null) offset.add(sent, received, snap.serverNow)
    return snap
  }

  const ctx: Ctx = {
    get client() {
      return getClient()
    },
    get seats() {
      return getSeats()
    },
    env,
    offset,
    async call(fn, args) {
      const sent = env.now()
      return finish(fn, sent, await getClient().rpc(fn, args))
    },
    async callFn(body) {
      const sent = env.now()
      return finish(GAME_FUNCTION, sent, await getClient().invoke(GAME_FUNCTION, body))
    },
    async createRaw(o) {
      const token = generateToken()
      // The server derives the first player and starting active timelines from
      // the variant; firstPlayer / firstActiveTimelines are not sent.
      const snap = await ctx.callFn({
        op: 'create',
        variantId: o.variantId,
        color: o.color,
        token,
        clock: o.clock,
      })
      getSeats().setToken(snap.code, token)
      if (snap.role !== 'spectator') getSeats().touch({ code: snap.code, variantId: snap.variantId, color: snap.role })
      return { token, snap }
    },
  }

  const open = (token: string, snap: Snapshot): GameSession => {
    const session = new GameSession(ctx, token, snap)
    if (opts.autoStart !== false) session.start()
    return session
  }

  return {
    async createGame(o) {
      const { token, snap } = await ctx.createRaw(o)
      return open(token, snap)
    },

    async joinGame(rawCode) {
      const code = normalizeCode(rawCode)
      if (!isValidCode(code)) throw new NetError('Invalid game code', 'invalid code', 'invalid_code')
      const existing = getSeats().getToken(code)
      const token = existing ?? generateToken()
      // Persist before calling so a lost response can still be resumed.
      if (!existing) getSeats().setToken(code, token)
      let snap: Snapshot
      try {
        snap = await ctx.call('join_game', { p_code: code, p_token: token })
      } catch (e) {
        if (!existing) getSeats().forget(code)
        throw e
      }
      if (snap.role !== 'spectator') {
        getSeats().touch({
          code: snap.code,
          variantId: snap.variantId,
          color: snap.role,
          finished: snap.result.kind !== 'ongoing',
        })
      }
      return open(token, snap)
    },

    async spectateGame(rawCode) {
      const code = normalizeCode(rawCode)
      if (!isValidCode(code)) throw new NetError('Invalid game code', 'invalid code', 'invalid_code')
      const token = getSeats().getToken(code) ?? generateToken()
      const snap = await ctx.call('get_game', { p_code: code, p_token: token })
      return open(token, snap)
    },

    recentGames: (): RecentGame[] => getSeats().list(),
    forgetGame: (code) => getSeats().forget(code),
    normalizeCode,
    isValidCode,
    shareUrl: (code) => shareUrl(code),
    parseJoinCode: (input) => parseJoinCode(input),
  }
}
