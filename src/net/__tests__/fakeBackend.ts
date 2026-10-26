// In-memory stand-in for the Supabase RPCs + Realtime broadcast/presence, for unit tests.
// Mirrors the semantics of supabase/migrations/* closely enough to exercise the sync logic.

import type { ChannelStatus, NetChannel, NetClient, NetEnv, PresenceState, RpcResponse } from '../online'

interface Row {
  code: string
  variant_id: string
  white: string | null
  black: string | null
  actions: Record<string, unknown>[]
  result: Record<string, unknown>
  clock: { initial: number; delayPerTimeline: number } | null
  first_player: 'white' | 'black'
  first_active_timelines: number
  started_at: number | null
  ended_at: number | null
}

export class FakeServer {
  games = new Map<string, Row>()
  now = 1_000_000
  private seq = 0
  /** Calls made, for assertions. */
  calls: { fn: string; args: Record<string, unknown> }[] = []

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
      serverNow: new Date(this.now).toISOString(),
      clockMs: null,
    }
  }

  private seat(g: Row, token: unknown) {
    return g.white === token ? 'white' : g.black === token ? 'black' : null
  }

  rpc(fn: string, a: Record<string, unknown>): RpcResponse {
    this.calls.push({ fn, args: a })
    try {
      return { data: this.exec(fn, a), error: null }
    } catch (e) {
      return { data: null, error: { message: (e as Error).message } }
    }
  }

  private exec(fn: string, a: Record<string, unknown>) {
    const get = () => {
      const g = this.games.get(String(a.p_code).toUpperCase())
      if (!g) throw new Error('game not found')
      return g
    }
    switch (fn) {
      case 'create_game': {
        let color = a.p_color as string
        if (color === 'random') color = 'white'
        const code = ['QWERTY', 'ASDFGH', 'ZXCVBN', 'PLMKNJ', 'HGFDSA'][this.seq++ % 5] + ''
        const g: Row = {
          code,
          variant_id: String(a.p_variant),
          white: color === 'white' ? String(a.p_token) : null,
          black: color === 'black' ? String(a.p_token) : null,
          actions: [],
          result: { kind: 'ongoing' },
          clock: (a.p_clock as Row['clock']) ?? null,
          first_player: (a.p_first as Row['first_player']) ?? 'white',
          first_active_timelines: (a.p_first_active_timelines as number) ?? 1,
          started_at: null,
          ended_at: null,
        }
        this.games.set(code, g)
        return this.json(g, color)
      }
      case 'join_game': {
        const g = get()
        let c = this.seat(g, a.p_token)
        if (!c) {
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
        const g = get()
        return this.json(g, this.seat(g, a.p_token) ?? 'spectator')
      }
      case 'submit_action': {
        const g = get()
        const c = this.seat(g, a.p_token)
        if (!c) throw new Error('not a player in this game')
        if (g.result.kind !== 'ongoing') throw new Error('game is over')
        if (!g.white || !g.black) throw new Error('waiting for opponent')
        const action = a.p_action as Record<string, unknown>
        if (action.player !== c) throw new Error('action player does not match your seat')
        const next = a.p_next_active_timelines as number | null
        if (next != null && (next < 1 || next > 1000)) throw new Error('invalid active timeline count')
        if (next == null && g.clock) throw new Error('missing active timeline count')
        const len = g.actions.length
        if (a.p_index !== len) throw new Error(`out of sync: expected index ${len}`)
        if ((len === 0 && c !== g.first_player) || (len > 0 && g.actions[len - 1].player === c))
          throw new Error('not your turn')
        g.actions.push({
          ...action,
          at: new Date(this.now).toISOString(),
          ...(next != null ? { nextActiveTimelines: next } : {}),
        })
        return this.json(g, c)
      }
      case 'set_result': {
        const g = get()
        const c = this.seat(g, a.p_token)
        if (!c) throw new Error('not a player in this game')
        const r = a.p_result as Record<string, unknown>
        if (r.kind === 'timeout' && this.timeoutRemaining !== null && this.timeoutRemaining > 0) {
          const ms = this.timeoutRemaining
          this.timeoutRemaining = null
          throw new Error(`clock not expired: ${ms} ms remaining`)
        }
        if (g.result.kind === 'ongoing' && r.kind !== 'ongoing') {
          g.result = r
          g.ended_at = this.now
        }
        return this.json(g, c)
      }
    }
    throw new Error(`unknown rpc ${fn}`)
  }

  /** If set, the next timeout claim is rejected with this many ms remaining. */
  timeoutRemaining: number | null = null
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
