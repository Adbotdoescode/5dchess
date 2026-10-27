import { describe, expect, it } from 'vitest'
import type { Action, Color } from '../engine/types'
import { FakeEnv, FakeNetwork, flush } from './__tests__/fakeBackend'
import { memoryStorage } from './codes'
import { createOnlineApi, NetError, OFFLINE_RETRYING } from './online'
import type { OnlineEvent, OnlineSession } from './types'

const act = (player: Color, n = 0): Action => ({ player, moves: [{ n } as never] })

function setup() {
  const net = new FakeNetwork()
  const envA = new FakeEnv()
  const envB = new FakeEnv()
  const storageA = memoryStorage()
  const storageB = memoryStorage()
  const apiA = createOnlineApi({ client: net.client(), storage: storageA, env: envA })
  const apiB = createOnlineApi({ client: net.client(), storage: storageB, env: envB })
  return { net, envA, envB, storageA, storageB, apiA, apiB }
}

function record(s: OnlineSession) {
  const events: OnlineEvent[] = []
  s.on((e) => events.push(e))
  return events
}

const ofType = <T extends OnlineEvent['type']>(events: OnlineEvent[], t: T) =>
  events.filter((e): e is Extract<OnlineEvent, { type: T }> => e.type === t)

async function startGame() {
  const ctx = setup()
  const a = await ctx.apiA.createGame({ variantId: 'standard', color: 'white', clock: null })
  const evA = record(a)
  await flush()
  const b = await ctx.apiB.joinGame(a.info.code.toLowerCase().replace(/(...)/, '$1-'))
  const evB = record(b)
  await flush()
  return { ...ctx, a, b, evA, evB }
}

describe('online sessions (mocked backend)', () => {
  it('create + join assigns seats and notifies the creator', async () => {
    const { a, b, evA } = await startGame()
    expect(a.info.myColor).toBe('white')
    expect(b.info.myColor).toBe('black')
    expect(b.role).toBe('black')
    expect(ofType(evA, 'opponent-joined')).toHaveLength(1)
    expect(a.info.opponentJoined).toBe(true)
    expect(a.info.startedAt).not.toBeNull()
    expect(ofType(evA, 'opponent-presence').at(-1)).toEqual({ type: 'opponent-presence', online: true })
  })

  it('delivers opponent actions once, in order, with server timestamps, never echoing our own', async () => {
    const { a, b, evA, evB, net } = await startGame()
    net.server.now += 5000
    await a.submitAction(0, act('white', 1))
    await flush()
    await b.submitAction(1, act('black', 2))
    await flush()
    expect(ofType(evB, 'action').map((e) => e.index)).toEqual([0])
    expect(ofType(evA, 'action').map((e) => e.index)).toEqual([1])
    expect(ofType(evB, 'action')[0].action).toEqual(act('white', 1)) // 'at' stripped
    expect(ofType(evB, 'action')[0].at).toBe(1_005_000)
    expect(a.info.actions).toHaveLength(2)
    expect(b.info.actionTimes).toEqual([1_005_000, 1_005_000])
    expect(ofType(evA, 'reset')).toHaveLength(0)
    expect(ofType(evB, 'reset')).toHaveLength(0)
  })

  it('ignores duplicate broadcasts', async () => {
    const { a, b, evB, net } = await startGame()
    await a.submitAction(0, act('white'))
    await flush()
    const chB = net.channels.find((c) => c.name === `game:${a.info.code}` && c.subscribed && c.presence?.color === 'black')!
    chB.inject('msg', { t: 'action', index: 0 })
    chB.inject('msg', { t: 'action', index: 0 })
    await flush()
    expect(ofType(evB, 'action')).toHaveLength(1)
    expect(b.info.actions).toHaveLength(1)
  })

  it('resyncs on a gap and emits the missing actions in order', async () => {
    const { a, b, evB, net } = await startGame()
    net.bus.deliver = false
    await a.submitAction(0, act('white', 0))
    // Simulate black's move made from another device so white can move again.
    const g = net.server.games.get(a.info.code)!
    g.actions.push({ ...act('black', 1), at: new Date(net.server.now).toISOString() })
    await a.resync()
    await a.submitAction(2, act('white', 2))
    net.bus.deliver = true
    const chB = net.channels.find((c) => c.presence?.color === 'black')!
    chB.inject('msg', { t: 'action', index: 2 })
    await flush()
    // index 1 is black's (ours) but unknown locally -> a 'reset' carrying the full list
    // instead of 'action' events past the gap.
    expect(ofType(evB, 'action').map((e) => e.index)).toEqual([0])
    expect(ofType(evB, 'reset')).toHaveLength(1)
    expect(evB.at(-1)!.type).toBe('reset')
    expect(b.info.actions.map((x) => x.player)).toEqual(['white', 'black', 'white'])
  })

  it('does not trust spoofed broadcasts', async () => {
    const { b, evB, net } = await startGame()
    const chB = net.channels.find((c) => c.presence?.color === 'black')!
    chB.inject('msg', { t: 'action', index: 0, action: act('white', 99) })
    chB.inject('msg', { t: 'result' })
    await flush()
    expect(ofType(evB, 'action')).toHaveLength(0)
    expect(ofType(evB, 'result')).toHaveLength(0)
    expect(b.info.actions).toHaveLength(0)
  })

  it('catches up on focus/visibility and polling', async () => {
    const { a, b, envB, evB, net } = await startGame()
    net.bus.deliver = false
    await a.submitAction(0, act('white'))
    await flush()
    expect(ofType(evB, 'action')).toHaveLength(0)
    envB.wake()
    await flush()
    expect(ofType(evB, 'action')).toHaveLength(1)

    // polling while it's the opponent's turn (after OPPONENT_TURN_POLL_MS)
    await b.submitAction(1, act('black'))
    await a.resync()
    await a.submitAction(2, act('white'))
    envB.t += 16_000
    envB.tick()
    await flush()
    expect(ofType(evB, 'action').map((e) => e.index)).toEqual([0, 2])
  })

  it('polls while waiting for the opponent to join', async () => {
    const ctx = setup()
    const a = await ctx.apiA.createGame({ variantId: 'standard', color: 'black', clock: null })
    const evA = record(a)
    ctx.net.bus.deliver = false
    // the joiner never manages to broadcast/track (e.g. they joined via another path)
    ctx.net.server.rpc('join_game', { p_code: a.info.code, p_token: 'x'.repeat(20) })
    ctx.envA.tick()
    await flush()
    expect(ofType(evA, 'opponent-joined')).toHaveLength(1)
  })

  it('surfaces out-of-sync / out-of-turn errors as friendly messages and resyncs', async () => {
    const { a, evA, net } = await startGame()
    const err = await a.submitAction(3, act('white')).catch((e) => e)
    expect(err).toBeInstanceOf(NetError)
    expect(err.message).toMatch(/out of sync with the server/i)
    expect(err.code).toBe('out_of_sync')
    expect(err.reason).toMatch(/expected index 0/)
    expect(ofType(evA, 'error')[0].message).toMatch(/out of sync/i)
    expect(net.server.calls.at(-1)!.fn).toBe('get_game')
    await a.submitAction(0, act('white'))
    await expect(a.submitAction(1, act('white'))).rejects.toThrow(/not your turn/i)
    await expect(a.submitAction(1, act('black'))).rejects.toThrow(/isn't for your side/)
  })

  it('submits through the game-action function and reports illegal actions', async () => {
    const { a, evA, net } = await startGame()
    const illegal: Action = { player: 'white', moves: [{ illegal: true } as never] }
    await expect(a.submitAction(0, illegal)).rejects.toThrow(/That move was rejected by the server: a move is not legal/)
    expect(ofType(evA, 'error').at(-1)!.message).toMatch(/rejected by the server/)
    expect(net.server.calls.filter((c) => c.fn === 'fn:submit')).toHaveLength(1)
    expect(net.server.calls.some((c) => c.fn === 'submit_action')).toBe(false)
    expect(a.info.actions).toHaveLength(0)
  })

  it('retries while offline, then succeeds', async () => {
    const { a, b, evA, evB, net } = await startGame()
    net.server.offlineCalls = 2
    await a.submitAction(0, act('white'))
    expect(ofType(evA, 'error').map((e) => e.message)).toEqual([OFFLINE_RETRYING])
    expect(net.server.calls.filter((c) => c.fn === 'fn:submit')).toHaveLength(1)
    await flush()
    expect(ofType(evB, 'action')).toHaveLength(1)
    expect(b.info.actions).toHaveLength(1)
  })

  it('a submit whose response was lost is not reported as an error', async () => {
    const { a, evA, net } = await startGame()
    net.server.lostResponses = 1
    await a.submitAction(0, act('white'))
    expect(a.info.actions).toHaveLength(1)
    expect(ofType(evA, 'reset')).toHaveLength(0)
    expect(ofType(evA, 'error').map((e) => e.message)).toEqual([OFFLINE_RETRYING])
  })

  it('gives up with a friendly message when the server stays unreachable', async () => {
    const { a, net } = await startGame()
    net.server.offlineCalls = 100
    await expect(a.submitAction(0, act('white'))).rejects.toThrow(/Couldn't reach the server/)
  })

  it('ignores stale (shorter) snapshots', async () => {
    const { a, b, evB } = await startGame()
    await a.submitAction(0, act('white'))
    await flush()
    // A stale get_game response arriving late must not roll back or reset.
    const stale = { ...b.info, actions: [] }
    ;(b as unknown as { apply(s: unknown): void }).apply({ ...stale, role: 'black', serverNow: null, clockMs: null })
    expect(b.info.actions).toHaveLength(1)
    expect(ofType(evB, 'reset')).toHaveLength(0)
  })

  it('checkmate claims are verified by the server', async () => {
    const { a, b, evA, evB, net } = await startGame()
    await expect(a.setResult({ kind: 'checkmate', winner: 'white' })).rejects.toThrow(/found a legal move/)
    expect(a.info.result.kind).toBe('ongoing')
    net.server.mateVerdict = 'inconclusive'
    await expect(a.setResult({ kind: 'checkmate', winner: 'white' })).rejects.toThrow(/couldn't confirm/)
    // the server records ITS verdict: claimed stalemate, it is mate for white
    net.server.mateVerdict = 'mate'
    await a.submitAction(0, act('white'))
    await flush()
    await b.setResult({ kind: 'stalemate' })
    await flush()
    expect(b.info.result).toEqual({ kind: 'checkmate', winner: 'white' })
    expect(ofType(evB, 'result')).toEqual([{ type: 'result', result: { kind: 'checkmate', winner: 'white' } }])
    expect(ofType(evA, 'result')).toHaveLength(1)
  })

  it('propagates results; our own result is not echoed', async () => {
    const { a, b, evA, evB } = await startGame()
    await b.setResult({ kind: 'resignation', winner: 'white' })
    await flush()
    expect(ofType(evB, 'result')).toHaveLength(0)
    expect(ofType(evA, 'result')).toEqual([{ type: 'result', result: { kind: 'resignation', winner: 'white' } }])
    expect(a.info.result).toEqual({ kind: 'resignation', winner: 'white' })
    expect(a.info.endedAt).not.toBeNull()
  })

  it('draw offer, decline and accept (persisted server-side)', async () => {
    const { a, b, evA, evB, net } = await startGame()
    // accepting without an offer is refused
    await expect(b.setResult({ kind: 'draw-agreed' })).rejects.toThrow(/no draw offer/)
    a.offerDraw()
    await flush()
    expect(net.server.games.get(a.info.code)!.draw_offer).toBe('white')
    expect(a.info.drawOffer).toBe('white')
    expect(b.info.drawOffer).toBe('white')
    expect(ofType(evB, 'draw-offer')).toHaveLength(1)
    expect(ofType(evA, 'draw-offer')).toHaveLength(0)
    b.answerDraw(false)
    await flush()
    expect(ofType(evA, 'draw-declined')).toEqual([{ type: 'draw-declined', reason: 'declined' }])
    expect(a.info.drawOffer).toBeNull()
    a.offerDraw()
    await flush()
    b.answerDraw(true)
    await flush()
    expect(ofType(evA, 'result')).toEqual([{ type: 'result', result: { kind: 'draw-agreed' } }])
    expect(b.info.result.kind).toBe('draw-agreed')
    expect(ofType(evB, 'result')).toHaveLength(0)
  })

  it('a draw offer survives a reload and lapses when an action is submitted', async () => {
    const { a, b, evA, net, storageB, envB } = await startGame()
    a.offerDraw()
    await flush()
    const apiB2 = createOnlineApi({ client: net.client(), storage: storageB, env: envB })
    const b2 = await apiB2.joinGame(a.info.code)
    expect(b2.info.drawOffer).toBe('white')
    const evB2 = record(b2)
    await a.submitAction(0, act('white'))
    await flush()
    expect(a.info.drawOffer).toBeNull()
    expect(b2.info.drawOffer).toBeNull()
    expect(ofType(evB2, 'draw-offer-withdrawn')).toHaveLength(1)
    // the offerer's own submit ended the offer: 'expired', not 'declined'
    expect(ofType(evA, 'draw-declined')).toEqual([{ type: 'draw-declined', reason: 'expired' }])
    await b.submitAction(1, act('black'))
    await flush()
    expect(ofType(evA, 'draw-declined')).toHaveLength(1)
  })

  it('spoofed draw/rematch broadcasts are ignored', async () => {
    const { a, b, evB, net } = await startGame()
    const chB = net.channels.find((c) => c.presence?.color === 'black')!
    chB.inject('msg', { t: 'draw-offer' })
    chB.inject('msg', { t: 'draw' })
    chB.inject('msg', { t: 'rematch-start', code: 'ZZZZZZ' })
    await flush()
    expect(ofType(evB, 'draw-offer')).toHaveLength(0)
    expect(ofType(evB, 'rematch-start')).toHaveLength(0)
    expect(b.info.drawOffer).toBeNull()
    expect(a.info.rematchCode).toBeNull()
  })

  it('cancel closes a waiting game: joins fail and it leaves the recent list', async () => {
    const ctx = setup()
    const a = await ctx.apiA.createGame({ variantId: 'standard', color: 'white', clock: null })
    expect(ctx.apiA.recentGames()).toHaveLength(1)
    await a.cancel()
    expect(a.info.cancelled).toBe(true)
    expect(ctx.apiA.recentGames()).toHaveLength(0)
    expect(ctx.envA.activeIntervals).toBe(0)
    await expect(ctx.apiB.joinGame(a.info.code)).rejects.toThrow(/This game was cancelled/)
    expect(ctx.apiB.recentGames()).toHaveLength(0)
  })

  it('cancel is refused once the opponent joined', async () => {
    const { a, evA } = await startGame()
    await expect(a.cancel()).rejects.toThrow(/already joined/)
    expect(ofType(evA, 'error')).toHaveLength(1)
  })

  it('rematch: offer, accept, new game with swapped colors', async () => {
    const { a, b, evA, evB, apiA, apiB } = await startGame()
    await b.setResult({ kind: 'resignation', winner: 'white' })
    await flush()
    a.offerRematch()
    await flush()
    expect(ofType(evB, 'rematch-offer')).toHaveLength(1)
    b.acceptRematch()
    await flush()
    const startA = ofType(evA, 'rematch-start')
    const startB = ofType(evB, 'rematch-start')
    expect(startA).toHaveLength(1)
    expect(startB).toHaveLength(1)
    expect(startA[0].code).toBe(startB[0].code)
    expect(startA[0].code).not.toBe(a.info.code)
    expect(a.info.rematchCode).toBe(startA[0].code)
    expect(b.info.rematchCode).toBe(startA[0].code)
    const b2 = await apiB.joinGame(startB[0].code)
    const a2 = await apiA.joinGame(startA[0].code)
    expect(b2.info.myColor).toBe('white')
    expect(a2.info.myColor).toBe('black')
    expect(a2.info.opponentJoined).toBe(true)
  })

  it('rematch state is persisted: offers and the code survive a reload; no seat for third parties', async () => {
    const { a, b, net, storageB, envB } = await startGame()
    await b.setResult({ kind: 'resignation', winner: 'white' })
    await flush()
    a.offerRematch()
    await flush()
    const apiB2 = createOnlineApi({ client: net.client(), storage: storageB, env: envB })
    const b2 = await apiB2.joinGame(a.info.code)
    expect(b2.info.rematchOffer).toBe('white')
    b2.acceptRematch()
    await flush()
    const code = b2.info.rematchCode!
    expect(code).toMatch(/^[A-Z]{6}$/)
    // a fresh load of the old game shows the code and resumes our seat in the rematch
    const apiB3 = createOnlineApi({ client: net.client(), storage: storageB, env: envB })
    const b3 = await apiB3.joinGame(a.info.code)
    expect(b3.info.rematchCode).toBe(code)
    expect((await apiB3.joinGame(code)).info.myColor).toBe('white')
    const apiC = createOnlineApi({ client: net.client(), storage: memoryStorage(), env: new FakeEnv() })
    await expect(apiC.joinGame(code)).rejects.toThrow(/game is full/)
  })

  it('simultaneous rematch offers create exactly one game', async () => {
    const { a, b, evA, evB, net } = await startGame()
    await b.setResult({ kind: 'resignation', winner: 'white' })
    await flush()
    const before = net.server.games.size
    a.offerRematch()
    b.offerRematch()
    await flush()
    expect(net.server.games.size).toBe(before + 1)
    expect(ofType(evA, 'rematch-start')).toHaveLength(1)
    expect(ofType(evB, 'rematch-start')).toHaveLength(1)
  })

  it('resumes the same seat after a refresh and lists recent games', async () => {
    const { a, net, storageB, envB } = await startGame()
    const apiB2 = createOnlineApi({ client: net.client(), storage: storageB, env: envB })
    expect(apiB2.recentGames().map((g) => g.code)).toEqual([a.info.code])
    expect(apiB2.recentGames()[0].color).toBe('black')
    const again = await apiB2.joinGame(a.info.code)
    expect(again.info.myColor).toBe('black')
    apiB2.forgetGame(a.info.code)
    expect(apiB2.recentGames()).toEqual([])
    await expect(apiB2.joinGame(a.info.code)).rejects.toThrow(/full/)
    expect(apiB2.recentGames()).toEqual([])
  })

  it('exposes spectator role and emits every action to spectators', async () => {
    const { a, b, net } = await startGame()
    const apiC = createOnlineApi({ client: net.client(), storage: memoryStorage(), env: new FakeEnv() })
    const c = await apiC.spectateGame(a.info.code)
    const evC = record(c)
    expect(c.role).toBe('spectator')
    expect(c.info.role).toBe('spectator')
    await a.submitAction(0, act('white'))
    await flush()
    await b.submitAction(1, act('black'))
    await flush()
    expect(ofType(evC, 'action').map((e) => e.index)).toEqual([0, 1])
    await expect(c.submitAction(2, act('white'))).rejects.toThrow(/Spectators/)
  })

  it('uses the server-derived first player for turn-zero variants', async () => {
    const ctx = setup()
    // the client's firstPlayer is ignored: the server derives it from the variant
    const a = await ctx.apiA.createGame({ variantId: 'tz', color: 'white', clock: null, firstPlayer: 'white' })
    const b = await ctx.apiB.joinGame(a.info.code)
    await flush()
    expect(a.info.firstPlayer).toBe('black')
    await expect(a.submitAction(0, act('white'))).rejects.toThrow(/not your turn/)
    await b.submitAction(0, act('black'))
    await flush()
    expect(a.info.actions).toHaveLength(1)
  })

  it('carries server-computed active-timeline counts for clocks', async () => {
    const ctx = setup()
    const a = await ctx.apiA.createGame({
      variantId: 'two-timelines',
      color: 'white',
      clock: { initial: 600, delayPerTimeline: 3 },
    })
    const evA = record(a)
    const b = await ctx.apiB.joinGame(a.info.code)
    const evB = record(b)
    await flush()
    expect(b.info.firstActiveTimelines).toBe(2)
    expect(b.info.activeTimelinesAtTurnStart).toEqual([2])
    ctx.net.server.serverActiveTimelines = 3
    // the client's own count is only a hint; the server's wins
    await a.submitAction(0, act('white'), { nextActiveTimelines: 5 })
    await flush()
    const got = ofType(evB, 'action')[0]
    expect(got.nextActiveTimelines).toBe(3)
    expect(got.action).toEqual(act('white')) // server stamp fields stripped
    expect(b.info.activeTimelinesAtTurnStart).toEqual([2, 3])
    expect(a.info.activeTimelinesAtTurnStart).toEqual([2, 3])
    expect(b.clocks()).toMatchObject({ running: 'black', delayRemaining: 9000 })
    // rematch keeps the variant's starting count
    await b.setResult({ kind: 'resignation', winner: 'white' })
    await flush()
    a.offerRematch()
    await flush()
    b.acceptRematch()
    await flush()
    const code = ofType(evA, 'rematch-start')[0].code
    const a2 = await ctx.apiA.joinGame(code)
    expect(a2.info.firstActiveTimelines).toBe(2)
    expect(a2.info.clock).toEqual({ initial: 600, delayPerTimeline: 3 })
  })

  it('retries a timeout claim the server says is early', async () => {
    const ctx = setup()
    const a = await ctx.apiA.createGame({ variantId: 's', color: 'white', clock: { initial: 60, delayPerTimeline: 5 } })
    await ctx.apiB.joinGame(a.info.code)
    await flush()
    ctx.net.server.timeoutRemaining = 40
    await a.setResult({ kind: 'timeout', winner: 'white' })
    expect(a.info.result).toEqual({ kind: 'timeout', winner: 'white' })
    expect(ctx.net.server.calls.filter((c) => c.fn === 'fn:result')).toHaveLength(2)
  })

  it('leave() stops polling and drops the channel', async () => {
    const { a, envA, net } = await startGame()
    expect(envA.activeIntervals).toBe(1)
    await a.leave()
    expect(envA.activeIntervals).toBe(0)
    expect(net.channels.filter((c) => c.subscribed && c.presence?.color === 'white')).toHaveLength(0)
  })

  it('rejects malformed codes before calling the server', async () => {
    const { apiA, net } = setup()
    await expect(apiA.joinGame('abc')).rejects.toThrow(/Invalid game code/)
    await expect(apiA.joinGame('QQQQQQ')).rejects.toThrow(/Game not found/)
    expect(net.server.calls).toHaveLength(1)
  })
})

describe('fromSupabase channel sharing', () => {
  it('lets several sessions share one realtime channel per topic', async () => {
    const { fromSupabase } = await import('./online')
    const handlers: { type: string; event: string; cb: (m: unknown) => void }[] = []
    let subscribed = false
    let removed = 0
    let created = 0
    const realtimeChannel = {
      on(type: string, filter: { event: string }, cb: (m: unknown) => void) {
        if (subscribed) throw new Error('cannot add callbacks after subscribe()')
        handlers.push({ type, event: filter.event, cb })
        return realtimeChannel
      },
      subscribe(cb: (s: string) => void) {
        subscribed = true
        setTimeout(() => cb('SUBSCRIBED'), 0)
      },
      send: async () => 'ok',
      track: async () => 'ok',
      presenceState: () => ({}),
    }
    const fake = {
      rpc: async () => ({ data: null, error: null }),
      functions: { invoke: async () => ({ data: null, error: null }) },
      channel: () => (created++, realtimeChannel),
      removeChannel: async () => {
        removed++
        subscribed = false
        handlers.length = 0
      },
    }
    const client = fromSupabase(fake as never)
    const got: string[] = []
    const mk = (id: string) => {
      const ch = client.channel('game:ABCDEF', id)
      ch.onBroadcast('msg', (p) => got.push(`${id}:${(p as { t: string }).t}`))
      ch.onPresenceSync(() => {})
      const statuses: string[] = []
      ch.subscribe((s) => statuses.push(s))
      return { ch, statuses }
    }
    const one = mk('one')
    await flush()
    const two = mk('two') // second session on the same topic after subscribe()
    await flush()
    expect(created).toBe(1)
    expect(one.statuses).toEqual(['SUBSCRIBED'])
    expect(two.statuses).toEqual(['SUBSCRIBED'])
    handlers.find((h) => h.type === 'broadcast')!.cb({ payload: { t: 'joined' } })
    expect(got).toEqual(['one:joined', 'two:joined'])
    await one.ch.unsubscribe()
    expect(removed).toBe(0)
    await two.ch.unsubscribe()
    expect(removed).toBe(1)
  })
})
