// Online sessions: Supabase RPCs (source of truth) + a Realtime broadcast
// channel `game:<CODE>` (hints + presence). See AGENTS.md "Online play".
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
  channel(name: string, presenceKey: string): NetChannel
}

/** Minimal shape of SupabaseClient we rely on (kept loose to avoid generic noise). */
interface SupabaseLike {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: { message: string } | null }>
  channel(name: string, opts?: unknown): unknown
  removeChannel(ch: never): Promise<unknown>
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
    rpc: (fn, args) => client.rpc(fn, args),
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
  /** Per action: submitter's active-timeline count for the start of the next turn. */
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
  }
}

function positiveInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 ? v : null
}

const turnStarts = (first: number, nexts: ReadonlyArray<number | null>) => [first, ...nexts]

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------

interface Ctx {
  client: NetClient
  seats: SeatStore
  env: NetEnv
  offset: ClockOffsetEstimator
  /** Calls an RPC, records a clock-offset sample, returns the parsed snapshot. */
  call(fn: string, args: Record<string, unknown>): Promise<Snapshot>
  createRaw(opts: {
    variantId: string
    color: Color | 'random'
    clock: null | ClockSettings
    firstPlayer?: Color
    firstActiveTimelines?: number
  }): Promise<{ token: string; snap: Snapshot }>
}

type BroadcastMsg =
  | { t: 'action'; index: number; at?: number | null }
  | { t: 'result' }
  | { t: 'joined' }
  | { t: 'draw-offer' }
  | { t: 'draw-declined' }
  | { t: 'rematch-offer' }
  | { t: 'rematch-start'; code: string }

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
  private ownRematchOffer = false
  private opponentRematchOffer = false
  private rematchStarted = false
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
    }
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
    let snap: Snapshot
    try {
      snap = await this.ctx.call('submit_action', {
        p_code: this.state.code,
        p_token: this.token,
        p_index: index,
        p_action: action,
        p_next_active_timelines: opts?.nextActiveTimelines ?? null,
      })
    } catch (e) {
      this.pendingIndex = null
      const message = errorMessage(e)
      if (/out of sync|not your turn|game is over/i.test(message)) {
        await this.resync().catch(() => {})
      }
      throw this.fail(message)
    }
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
        const snap = await this.ctx.call('set_result', {
          p_code: this.state.code,
          p_token: this.token,
          p_result: result,
        })
        // Our own result is not echoed as an event; a different (earlier) one is.
        if (sameJson(snap.result, result) && this.state.result.kind === 'ongoing') {
          this.state.result = snap.result
        }
        this.apply(snap)
        this.broadcast({ t: 'result' })
        return
      } catch (e) {
        const message = errorMessage(e)
        const m = /clock not expired: (-?\d+) ms/i.exec(message)
        if (m && attempt < 3) {
          // Our clock estimate ran slightly ahead of the server; retry when it agrees.
          await new Promise<void>((r) => this.ctx.env.setTimeout(r, Math.min(Number(m[1]), 5000) + 100))
          continue
        }
        throw this.fail(message)
      }
    }
  }

  offerDraw(): void {
    if (this.state.role === 'spectator') return
    this.broadcast({ t: 'draw-offer' })
  }

  answerDraw(accept: boolean): void {
    if (this.state.role === 'spectator') return
    if (accept) {
      this.setResult({ kind: 'draw-agreed' }).catch(() => {})
    } else {
      this.broadcast({ t: 'draw-declined' })
    }
  }

  offerRematch(): void {
    if (this.state.role === 'spectator' || this.rematchStarted) return
    if (this.opponentRematchOffer) {
      void this.startRematch()
      return
    }
    this.ownRematchOffer = true
    this.broadcast({ t: 'rematch-offer' })
  }

  acceptRematch(): void {
    this.offerRematch()
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

  async leave(): Promise<void> {
    if (this.left) return
    this.left = true
    if (this.pollHandle !== null) this.ctx.env.clearInterval(this.pollHandle)
    this.offWake?.()
    this.listeners.clear()
    this.touchRecent()
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

  private fail(message: string): Error {
    this.emit({ type: 'error', message })
    return new Error(message)
  }

  private backgroundSync(): void {
    if (this.left) return
    this.resync().catch((e) => console.warn('[net] resync failed:', errorMessage(e)))
  }

  private poll(): void {
    const s = this.state
    if (this.left) return
    if (!s.opponentJoined) return this.backgroundSync()
    if (s.result.kind !== 'ongoing') return
    const waitingOnOther = s.role === 'spectator' || sideToMove(s.actions, s.firstPlayer) !== s.role
    if (waitingOnOther && this.ctx.env.now() - this.lastSync >= OPPONENT_TURN_POLL_MS) this.backgroundSync()
  }

  /** Merge an authoritative snapshot, emitting events for anything new. */
  private apply(snap: Snapshot): void {
    const s = this.state
    s.serverTimeOffset = this.ctx.offset.offset
    const localLen = s.actions.length
    let reset = false

    if (snap.actions.length >= localLen) {
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

    if (snap.clockMs && snap.serverNow !== null && snap.actions.length >= localLen) {
      s.clockMs = snap.clockMs
      s.clockMsAt = snap.serverNow
    }
    if (snap.startedAt !== null) s.startedAt = snap.startedAt
    if (snap.endedAt !== null) s.endedAt = snap.endedAt
    s.firstPlayer = snap.firstPlayer
    if (!s.clock && snap.clock) s.clock = snap.clock

    if (reset) this.emit({ type: 'reset', info: s })

    if (snap.opponentJoined && !s.opponentJoined) {
      s.opponentJoined = true
      this.emit({ type: 'opponent-joined' })
      this.touchRecent()
    }

    if (snap.result.kind !== 'ongoing' && !sameJson(snap.result, s.result)) {
      s.result = snap.result
      this.emit({ type: 'result', result: snap.result })
      this.touchRecent()
    }
  }

  private onBroadcast(payload: unknown): void {
    if (this.left || !payload || typeof payload !== 'object') return
    const msg = payload as BroadcastMsg
    const s = this.state
    const player = s.role !== 'spectator'
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
      case 'draw-offer':
        if (player && s.result.kind === 'ongoing') this.emit({ type: 'draw-offer' })
        return
      case 'draw-declined':
        if (player) this.emit({ type: 'draw-declined' })
        return
      case 'rematch-offer':
        if (!player || this.rematchStarted) return
        this.opponentRematchOffer = true
        if (this.ownRematchOffer) {
          // Both offered at once: the old game's white creates the new game.
          if (s.role === 'white') void this.startRematch()
        } else {
          this.emit({ type: 'rematch-offer' })
        }
        return
      case 'rematch-start': {
        if (!player || typeof msg.code !== 'string') return
        const code = normalizeCode(msg.code)
        if (!isValidCode(code) || code === s.code) return
        this.rematchStarted = true
        this.emit({ type: 'rematch-start', code })
        return
      }
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

  private async startRematch(): Promise<void> {
    if (this.rematchStarted || this.state.role === 'spectator') return
    this.rematchStarted = true
    try {
      const { snap } = await this.ctx.createRaw({
        variantId: this.state.variantId,
        color: opposite(this.state.role),
        clock: this.state.clock,
        firstPlayer: this.state.firstPlayer,
        firstActiveTimelines: this.state.firstActiveTimelines,
      })
      this.broadcast({ t: 'rematch-start', code: snap.code })
      this.emit({ type: 'rematch-start', code: snap.code })
    } catch (e) {
      this.rematchStarted = false
      this.fail(errorMessage(e))
    }
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
      finished: this.state.result.kind !== 'ongoing',
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
      const { data, error } = await getClient().rpc(fn, args)
      const received = env.now()
      if (error) throw new Error(error.message || `${fn} failed`)
      const snap = parseSnapshot(data)
      if (snap.serverNow !== null) offset.add(sent, received, snap.serverNow)
      return snap
    },
    async createRaw(o) {
      const token = generateToken()
      const snap = await ctx.call('create_game', {
        p_variant: o.variantId,
        p_color: o.color,
        p_token: token,
        p_clock: o.clock,
        p_first: o.firstPlayer ?? 'white',
        p_first_active_timelines: o.firstActiveTimelines ?? 1,
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
      if (!isValidCode(code)) throw new Error('Invalid game code')
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
      if (!isValidCode(code)) throw new Error('Invalid game code')
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
