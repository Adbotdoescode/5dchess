// In-memory stand-in for the Supabase RPCs, the `game-action` Edge Function and
// Realtime broadcast/presence, for unit tests. Mirrors the semantics of
// supabase/migrations/* and supabase/functions/game-action closely enough to
// exercise the sync logic (it does not run the rules engine: a move with
// `illegal: true` stands for an action the engine rejects).

import type { ChannelStatus, NetChannel, NetClient, NetEnv, PresenceState, RpcResponse } from '../online'

type Color = 'white' | 'black'

interface Row {
  code: string
  variant_id: string
  white: string | null
  black: string | null
  actions: Record<string, unknown>[]
  result: Record<string, unknown>
  clock: { initial: number; delayPerTimeline: number } | null
  first_player: Color
  first_active_timelines: number
  started_at: number | null
  ended_at: number | null
  draw_offer: Color | null
  rematch_offer: Color | null
  rematch_code: string | null
  cancelled: boolean
}

class Rejection extends Error {
  code?: string
  status?: number
  constructor(message: string, code?: string, status?: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

const other = (c: Color): Color => (c === 'white' ? 'black' : 'white')

export class FakeServer {
  games = new Map<string, Row>()
  now = 1_000_000
  private seq = 0
  /** Calls made, for assertions (Edge Function calls are recorded as `fn:<op>`). */
  calls: { fn: string; args: Record<string, unknown> }[] = []
  /** If set, the next timeout claim is rejected with this many ms remaining. */
  timeoutRemaining: number | null = null
  /** Verdict of the server's mate search for checkmate/stalemate claims. */
  mateVerdict: 'mate' | 'stalemate' | 'not_over' | 'inconclusive' = 'not_over'
  /** Active-timeline count the "engine" computes for each stored action. */
  serverActiveTimelines = 1
  /** Fail this many upcoming Edge Function calls with a network error (before reaching the server). */
  offlineCalls = 0
  /** Fail this many upcoming Edge Function calls with a network error AFTER the server handled them. */
  lostResponses = 0

  private json(g: Row, color: string) {
    return {
      code: g.code,
      variantId: g.variant_id,
      myColor: color,
      actions: structuredClone(g.actions),
      result: structuredClone(g.result),
      clock: g.clock,
      opponentJoined: g.white !== null && g.black !== null,
      firstPlayer: g.first_player,
      firstActiveTimelines: g.first_active_timelines,
      startedAt: g.started_at === null ? null : new Date(g.started_at).toISOString(),
      endedAt: g.ended_at === null ? null : new Date(g.ended_at).toISOString(),
      drawOffer: g.draw_offer,
      rematchOffer: g.rematch_offer,
      rematchCode: g.rematch_code,
      cancelled: g.cancelled,
      serverNow: new Date(this.now).toISOString(),
      clockMs: null,
    }
  }

  private seat(g: Row, token: unknown): Color | null {
    return g.white === token ? 'white' : g.black === token ? 'black' : null
  }

  private newCode(): string {
    return ['QWERTY', 'ASDFGH', 'ZXCVBN', 'PLMKNJ', 'HGFDSA', 'WXCVBN', 'MNBVCX'][this.seq++ % 7]
  }

  rpc(fn: string, a: Record<string, unknown>): RpcResponse {
    this.calls.push({ fn, args: a })
    try {
      return { data: this.exec(fn, a), error: null }
    } catch (e) {
      const r = e as Rejection
      return { data: null, error: { message: r.message, code: r.code, status: r.status } }
    }
  }

  /** The Edge Function: create / submit / result. */
  invoke(fn: string, body: Record<string, unknown>): RpcResponse {
    if (fn !== 'game-action') return { data: null, error: { message: 'not found', status: 404 } }
    this.calls.push({ fn: `fn:${String(body.op)}`, args: body })
    try {
      return { data: this.execFn(body), error: null }
    } catch (e) {
      const r = e as Rejection
      return { data: null, error: { message: r.message, code: r.code, status: r.status ?? 400 } }
    }
  }

  private get(a: Record<string, unknown>, key = 'p_code'): Row {
    const g = this.games.get(String(a[key]).toUpperCase())
    if (!g) throw new Rejection('game not found', 'not_found', 404)
    return g
  }

  private requireSeat(g: Row, token: unknown): Color {
    const c = this.seat(g, token)
    if (!c) throw new Rejection('not a player in this game', 'not_player', 403)
    return c
  }

  private end(g: Row, result: Record<string, unknown>) {
    g.result = result
    g.ended_at = this.now
    g.draw_offer = null
  }

  private execFn(b: Record<string, unknown>) {
    switch (b.op) {
      case 'create': {
        let color = b.color as string
        if (color === 'random') color = 'white'
        const variant = String(b.variantId)
        const code = this.newCode()
        const g: Row = {
          code,
          variant_id: variant,
          white: color === 'white' ? String(b.token) : null,
          black: color === 'black' ? String(b.token) : null,
          actions: [],
          result: { kind: 'ongoing' },
          clock: (b.clock as Row['clock']) ?? null,
          // stands in for the engine: turn-zero variants start with black, two-timeline ones with 2
          first_player: /tz|turn.?zero/i.test(variant) ? 'black' : 'white',
          first_active_timelines: /two/i.test(variant) ? 2 : 1,
          started_at: null,
          ended_at: null,
          draw_offer: null,
          rematch_offer: null,
          rematch_code: null,
          cancelled: false,
        }
        this.games.set(code, g)
        return this.json(g, color)
      }
      case 'submit': {
        const g = this.get(b, 'code')
        const c = this.requireSeat(g, b.token)
        if (g.cancelled) throw new Rejection('game was cancelled', 'cancelled', 409)
        if (g.result.kind !== 'ongoing') throw new Rejection('game is over', 'game_over', 409)
        if (!g.white || !g.black) throw new Rejection('waiting for opponent', 'waiting', 409)
        const len = g.actions.length
        if (b.index !== len) throw new Rejection(`out of sync: expected index ${len}`, 'out_of_sync', 409)
        const action = b.action as { player: Color; moves: Record<string, unknown>[] }
        if (action.player !== c) throw new Rejection('action player does not match your seat', 'wrong_seat', 403)
        const toMove = len === 0 ? g.first_player : other(g.actions[len - 1].player as Color)
        if (toMove !== c) throw new Rejection('not your turn', 'not_your_turn', 409)
        if (action.moves.some((m) => m.illegal)) {
          throw new Rejection('illegal action: a move is not legal in this position', 'illegal', 422)
        }
        g.actions.push({
          ...action,
          at: new Date(this.now).toISOString(),
          nextActiveTimelines: this.serverActiveTimelines,
        })
        g.draw_offer = null
        return this.json(g, c)
      }
      case 'result': {
        const g = this.get(b, 'code')
        const c = this.requireSeat(g, b.token)
        const r = b.result as Record<string, unknown>
        if (g.result.kind !== 'ongoing') return this.json(g, c)
        if (r.kind === 'checkmate' || r.kind === 'stalemate') {
          if (this.mateVerdict === 'not_over') {
            throw new Rejection('no checkmate or stalemate: white still has a legal action', 'not_over', 409)
          }
          if (this.mateVerdict === 'inconclusive') {
            throw new Rejection('the server could not confirm the end of the game in time; play continues', 'inconclusive', 409)
          }
          const len = g.actions.length
          const toMove = len === 0 ? g.first_player : other(g.actions[len - 1].player as Color)
          this.end(g, this.mateVerdict === 'mate' ? { kind: 'checkmate', winner: other(toMove) } : { kind: 'stalemate' })
          return this.json(g, c)
        }
        return this.setResult(g, c, r)
      }
    }
    throw new Rejection('unknown op', 'bad_request', 400)
  }

  private setResult(g: Row, c: Color, r: Record<string, unknown>) {
    if (r.kind === 'resignation' && r.winner === c) throw new Rejection('you can only resign for yourself', 'forbidden', 403)
    if (r.kind === 'timeout' && this.timeoutRemaining !== null && this.timeoutRemaining > 0) {
      const ms = this.timeoutRemaining
      this.timeoutRemaining = null
      throw new Rejection(`clock not expired: ${ms} ms remaining`, 'clock_not_expired', 409)
    }
    if (r.kind === 'draw-agreed' && g.draw_offer !== other(c)) {
      throw new Rejection('no draw offer from your opponent', 'no_draw_offer', 409)
    }
    if (g.result.kind === 'ongoing' && r.kind !== 'ongoing') this.end(g, r)
    return this.json(g, c)
  }

  private exec(fn: string, a: Record<string, unknown>) {
    switch (fn) {
      case 'join_game': {
        const g = this.get(a)
        let c = this.seat(g, a.p_token)
        if (!c) {
          if (g.cancelled) throw new Error('game was cancelled')
          if (g.white === null) {
            g.white = String(a.p_token)
            c = 'white'
          } else if (g.black === null) {
            g.black = String(a.p_token)
            c = 'black'
          } else throw new Error('game is full')
          if (g.white && g.black) g.started_at ??= this.now
        }
        return this.json(g, c)
      }
      case 'get_game': {
        const g = this.get(a)
        return this.json(g, this.seat(g, a.p_token) ?? 'spectator')
      }
      case 'offer_draw': {
        const g = this.get(a)
        const c = this.requireSeat(g, a.p_token)
        if (g.result.kind !== 'ongoing') throw new Error('game is over')
        if (!g.white || !g.black) throw new Error('waiting for opponent')
        if (g.draw_offer === other(c)) this.end(g, { kind: 'draw-agreed' })
        else g.draw_offer = c
        return this.json(g, c)
      }
      case 'answer_draw': {
        const g = this.get(a)
        const c = this.requireSeat(g, a.p_token)
        if (g.result.kind !== 'ongoing') throw new Error('game is over')
        if (g.draw_offer !== other(c)) throw new Error('no draw offer from your opponent')
        if (a.p_accept) this.end(g, { kind: 'draw-agreed' })
        else g.draw_offer = null
        return this.json(g, c)
      }
      case 'cancel_game': {
        const g = this.get(a)
        const c = this.requireSeat(g, a.p_token)
        if (g.white && g.black) throw new Error('opponent already joined')
        g.cancelled = true
        g.ended_at ??= this.now
        return this.json(g, c)
      }
      case 'offer_rematch': {
        const g = this.get(a)
        const c = this.requireSeat(g, a.p_token)
        if (g.rematch_code) return this.json(g, c)
        if (g.result.kind === 'ongoing') throw new Error('game is not over')
        if (g.rematch_offer === other(c)) {
          const code = this.newCode()
          this.games.set(code, {
            ...structuredClone(g),
            code,
            white: g.black,
            black: g.white,
            actions: [],
            result: { kind: 'ongoing' },
            started_at: this.now,
            ended_at: null,
            draw_offer: null,
            rematch_offer: null,
            rematch_code: null,
          })
          g.rematch_code = code
          g.rematch_offer = null
        } else if (!g.rematch_offer) {
          g.rematch_offer = c
        }
        return this.json(g, c)
      }
    }
    throw new Error(`unknown rpc ${fn}`)
  }
}

class Bus {
  channels = new Set<FakeChannel>()
  /** When false, broadcasts are silently dropped. */
  deliver = true
}

export class FakeChannel implements NetChannel {
  private bus: Bus
  readonly name: string
  readonly key: string
  private bcast = new Map<string, ((p: unknown) => void)[]>()
  private presenceCbs: (() => void)[] = []
  presence: Record<string, unknown> | null = null
  subscribed = false
  sent: { event: string; payload: unknown }[] = []

  constructor(bus: Bus, name: string, key: string) {
    this.bus = bus
    this.name = name
    this.key = key
  }

  onBroadcast(event: string, cb: (p: unknown) => void) {
    this.bcast.set(event, [...(this.bcast.get(event) ?? []), cb])
  }
  onPresenceSync(cb: () => void) {
    this.presenceCbs.push(cb)
  }
  subscribe(cb: (status: ChannelStatus) => void) {
    this.bus.channels.add(this)
    this.subscribed = true
    setTimeout(() => cb('SUBSCRIBED'), 0)
  }
  /** Simulate an incoming broadcast (e.g. spoofed or re-ordered). */
  inject(event: string, payload: unknown) {
    for (const cb of this.bcast.get(event) ?? []) cb(structuredClone(payload))
  }
  async send(event: string, payload: unknown) {
    this.sent.push({ event, payload })
    if (!this.bus.deliver) return
    for (const ch of this.peers()) setTimeout(() => ch.inject(event, payload), 0)
  }
  async track(state: Record<string, unknown>) {
    this.presence = state
    this.syncPresence()
  }
  presenceState(): PresenceState {
    const out: PresenceState = {}
    for (const ch of this.bus.channels) {
      if (ch.name === this.name && ch.presence) out[ch.key] = [ch.presence]
    }
    return out
  }
  async unsubscribe() {
    this.bus.channels.delete(this)
    this.subscribed = false
    this.syncPresence()
  }
  private peers() {
    return [...this.bus.channels].filter((c) => c !== this && c.name === this.name)
  }
  private syncPresence() {
    for (const ch of this.bus.channels) {
      if (ch.name === this.name) setTimeout(() => ch.presenceCbs.forEach((cb) => cb()), 0)
    }
  }
}

export class FakeNetwork {
  server = new FakeServer()
  bus = new Bus()
  channels: FakeChannel[] = []

  client(): NetClient {
    return {
      rpc: async (fn, args) => {
        await Promise.resolve()
        return this.server.rpc(fn, structuredClone(args))
      },
      invoke: async (fn, body) => {
        await Promise.resolve()
        if (this.server.offlineCalls > 0) {
          this.server.offlineCalls--
          return { data: null, error: { message: 'Failed to fetch', network: true } }
        }
        const res = this.server.invoke(fn, structuredClone(body))
        if (this.server.lostResponses > 0) {
          this.server.lostResponses--
          return { data: null, error: { message: 'Failed to fetch', network: true } }
        }
        return res
      },
      channel: (name, key) => {
        const ch = new FakeChannel(this.bus, name, key)
        this.channels.push(ch)
        return ch
      },
    }
  }
}

export class FakeEnv implements NetEnv {
  private wakers = new Set<() => void>()
  private intervals = new Map<number, () => void>()
  private nextId = 1
  t = 1_000_000

  onWake(cb: () => void) {
    this.wakers.add(cb)
    return () => this.wakers.delete(cb)
  }
  wake() {
    for (const w of this.wakers) w()
  }
  setInterval(cb: () => void, _ms: number) {
    const id = this.nextId++
    this.intervals.set(id, cb)
    return id
  }
  clearInterval(h: unknown) {
    this.intervals.delete(h as number)
  }
  tick() {
    for (const cb of this.intervals.values()) cb()
  }
  setTimeout(cb: () => void, _ms: number) {
    return setTimeout(cb, 0)
  }
  now() {
    return this.t
  }
  get activeIntervals() {
    return this.intervals.size
  }
}

/** Let queued timers/microtasks run. */
export async function flush(rounds = 10) {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setTimeout(r, 0))
}
