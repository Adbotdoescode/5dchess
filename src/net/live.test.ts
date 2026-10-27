// Opt-in end-to-end test against the real Supabase project (RPCs + the
// `game-action` Edge Function + Realtime).
//   NET_LIVE=1 npx vitest run src/net/live.test.ts
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from the environment or .env.local.
// Creates rows in public.games (codes are printed at the end); anon cannot
// delete them, so clean up afterwards with SQL (service role), e.g.
//   delete from public.games where code in (...);

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { Game } from '../engine'
import type { Action, Color, Move } from '../engine/types'
import { memoryStorage } from './codes'
import { createOnlineApi, fromSupabase } from './online'
import { createSupabaseClient } from './supabase'
import type { OnlineEvent, OnlineSession } from './types'

const LIVE = process.env.NET_LIVE === '1'

function loadEnv(): { url: string; key: string } {
  const env: Record<string, string> = {}
  try {
    for (const line of readFileSync(resolve(process.cwd(), '.env.local'), 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, '')
    }
  } catch {
    // no .env.local
  }
  const url = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_PUBLISHABLE_KEY
  if (!url || !key) throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY')
  return { url, key }
}

const mv = (l: number, t: number, x: number, y: number, tx: number, ty: number): Move => ({
  from: { l, t, x, y },
  to: { l, t, x: tx, y: ty },
})
const act = (player: Color, ...moves: Move[]): Action => ({ player, moves })

// Standard: 1. e4 e5 2. Nf3 ...
const E4 = act('white', mv(0, 2, 4, 1, 4, 3))
const E5 = act('black', mv(0, 3, 4, 6, 4, 4))
const NF3 = act('white', mv(0, 4, 6, 0, 5, 2))
const KING_TELEPORT = act('white', mv(0, 4, 4, 0, 4, 5)) // Ke1-e6

function recorder(s: OnlineSession) {
  const events: OnlineEvent[] = []
  s.on((e) => events.push(e))
  const waitFor = async (pred: (e: OnlineEvent) => boolean, label: string, ms = 15000) => {
    const start = Date.now()
    while (Date.now() - start < ms) {
      const hit = events.find(pred)
      if (hit) return hit
      await new Promise((r) => setTimeout(r, 50))
    }
    throw new Error(`timed out waiting for ${label}; got ${JSON.stringify(events.map((e) => e.type))}`)
  }
  return { events, waitFor }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Seeded random legal game that time-travels a lot (many timelines). */
function randomGame(variantId: string, n: number, seed: number): Action[] {
  let s = seed >>> 0
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const g = Game.create(variantId, { skipMateDetection: true })
  const actions: Action[] = []
  for (let i = 0; i < n; i++) {
    let action: Action | null = null
    for (let attempt = 0; attempt < 40 && !action; attempt++) {
      while (g.undoMove());
      for (let guard = 0; g.submitBlocker() === 'must-move-present' && guard < 60; guard++) {
        const req = g.requiredBoards()
        const b = req[Math.floor(rand() * req.length)]
        const all = g.movablePieces().filter((p) => p.l === b.l && p.t === b.t).flatMap((p) => g.movesFrom(p))
        if (all.length === 0) break
        const travel = all.filter((m) => g.moveKind(m) !== 'spatial')
        const pool = travel.length > 0 && rand() < 0.6 ? travel : all
        g.makeMove(pool[Math.floor(rand() * pool.length)])
      }
      if (g.canSubmit()) action = { player: g.player, moves: g.pendingMoves.slice() }
    }
    while (g.undoMove());
    if (!action) break
    g.applyAction(action)
    actions.push(action)
  }
  return actions
}

describe.skipIf(!LIVE)('live Supabase backend (server-authoritative)', () => {
  const sessions: OnlineSession[] = []
  const codes = new Set<string>()
  const env = LIVE ? loadEnv() : { url: '', key: '' }
  const newApi = (storage = memoryStorage()) => ({
    storage,
    supa: createSupabaseClient(env.url, env.key),
    api: createOnlineApi({ client: fromSupabase(createSupabaseClient(env.url, env.key)), storage }),
  })
  const track = <T extends OnlineSession>(s: T): T => {
    sessions.push(s)
    codes.add(s.info.code)
    return s
  }

  afterAll(async () => {
    await Promise.all(sessions.map((s) => s.leave()))
    console.log(`[live] games created: ${[...codes].map((c) => `'${c}'`).join(', ')}`)
  })

  it('validates actions and results on the server; draws and rematches are persisted', { timeout: 120_000 }, async () => {
    const A = newApi()
    const B = newApi()
    const a = track(await A.api.createGame({ variantId: 'standard', color: 'white', clock: { initial: 300, delayPerTimeline: 5 } }))
    const recA = recorder(a)
    expect(a.info.code).toMatch(/^[A-Z2-9]{6}$/)
    expect(a.info.firstPlayer).toBe('white')
    expect(a.info.firstActiveTimelines).toBe(1)
    expect(a.info.drawOffer).toBeNull()
    expect(a.info.rematchCode).toBeNull()
    await expect(a.submitAction(0, E4)).rejects.toThrow(/Waiting for your opponent/)

    // the raw RPCs are closed to the publishable key
    const tokenA = A.storage.getItem(`5dchess:seat:${a.info.code}`)!
    for (const [fn, args] of [
      ['submit_action', { p_code: a.info.code, p_token: tokenA, p_index: 0, p_action: E4, p_next_active_timelines: 1 }],
      ['set_result', { p_code: a.info.code, p_token: tokenA, p_result: { kind: 'checkmate', winner: 'white' } }],
      ['create_game', { p_variant: 'standard', p_color: 'white', p_token: 'x'.repeat(20) }],
    ] as const) {
      const raw = await A.supa.rpc(fn, args)
      expect(raw.error?.message, fn).toMatch(/permission denied|Could not find the function/)
    }

    await sleep(1500) // let A's channel subscribe
    const b = track(await B.api.joinGame(a.info.code.toLowerCase()))
    const recB = recorder(b)
    expect(b.info.myColor).toBe('black')
    await recA.waitFor((e) => e.type === 'opponent-joined', 'opponent-joined')
    await sleep(1000)

    // legal actions; the server computes the active-timeline count (the client's 9 is ignored)
    await a.submitAction(0, E4, { nextActiveTimelines: 9 })
    const got0 = await recB.waitFor((e) => e.type === 'action' && e.index === 0, 'B receives action 0')
    expect(got0).toMatchObject({ type: 'action', index: 0, action: E4, nextActiveTimelines: 1 })
    await b.submitAction(1, E5)
    await recA.waitFor((e) => e.type === 'action' && e.index === 1, 'A receives action 1')

    // an illegal action (king teleport) is rejected and not stored
    const err = await a.submitAction(2, KING_TELEPORT).catch((e) => e)
    expect(err.message).toMatch(/That move was rejected by the server/)
    expect(err.code).toBe('illegal')
    expect(recA.events.some((e) => e.type === 'error' && /rejected by the server/.test(e.message))).toBe(true)
    // ... also when sent straight to the function
    const direct = await A.supa.functions.invoke('game-action', {
      body: { op: 'submit', code: a.info.code, token: tokenA, index: 2, action: KING_TELEPORT },
    })
    expect(direct.error).toBeTruthy()
    await b.resync()
    expect(b.info.actions).toHaveLength(2)

    // out of turn / out of sync / wrong seat
    await expect(b.submitAction(2, act('black', mv(0, 5, 3, 6, 3, 4)))).rejects.toThrow(/isn't for your side|not your turn/i)
    await expect(a.submitAction(5, NF3)).rejects.toThrow(/Out of sync/)

    // a fake checkmate (and a fake stalemate) is refused
    await expect(a.setResult({ kind: 'checkmate', winner: 'white' })).rejects.toThrow(/found a legal move/)
    await expect(b.setResult({ kind: 'stalemate' })).rejects.toThrow(/found a legal move/)
    // a premature timeout claim is refused by the server clock
    await expect(a.setResult({ kind: 'timeout', winner: 'white' })).rejects.toThrow(/clock hasn't run out/)
    // can't resign on the opponent's behalf
    await expect(a.setResult({ kind: 'resignation', winner: 'white' })).rejects.toThrow(/only resign for yourself/)
    // draw-agreed needs a stored offer from the OTHER side
    await expect(b.setResult({ kind: 'draw-agreed' })).rejects.toThrow(/no draw offer/)
    expect(a.info.result.kind).toBe('ongoing')

    // draw offer: persisted, declined, lapses on submit, accepted
    a.offerDraw()
    await recB.waitFor((e) => e.type === 'draw-offer', 'B sees the draw offer')
    expect(b.info.drawOffer).toBe('white')
    const reloadB = track(await newApi(B.storage).api.joinGame(a.info.code))
    expect(reloadB.info.drawOffer).toBe('white') // survives a reload
    await expect(a.setResult({ kind: 'draw-agreed' })).rejects.toThrow(/no draw offer/) // can't accept your own
    b.answerDraw(false)
    await recA.waitFor((e) => e.type === 'draw-declined', 'A sees the decline')
    expect(a.info.drawOffer).toBeNull()
    a.offerDraw()
    await recB.waitFor((e) => e.type === 'draw-offer' && b.info.drawOffer === 'white', 'second offer')
    await a.submitAction(2, NF3)
    expect(a.info.drawOffer).toBeNull() // any submit clears it
    await recB.waitFor((e) => e.type === 'draw-offer-withdrawn', 'B sees the offer lapse')
    b.offerDraw()
    await recA.waitFor((e) => e.type === 'draw-offer', 'A sees B offer')
    a.answerDraw(true)
    await recB.waitFor((e) => e.type === 'result', 'B receives the draw')
    expect(b.info.result).toEqual({ kind: 'draw-agreed' })
    await expect(a.submitAction(3, act('white'))).rejects.toThrow(/already over/)

    // rematch: persisted offer + code, swapped colours, both seats pre-assigned
    b.offerRematch()
    await recA.waitFor((e) => e.type === 'rematch-offer', 'A sees the rematch offer')
    expect(a.info.rematchOffer).toBe('black')
    a.acceptRematch()
    const startA = (await recA.waitFor((e) => e.type === 'rematch-start', 'A rematch-start')) as { code: string }
    const startB = (await recB.waitFor((e) => e.type === 'rematch-start', 'B rematch-start')) as { code: string }
    expect(startA.code).toBe(startB.code)
    codes.add(startA.code)
    const fresh = newApi(A.storage)
    const reloadA = track(await fresh.api.joinGame(a.info.code))
    expect(reloadA.info.rematchCode).toBe(startA.code) // read back from the DB
    const a2 = track(await fresh.api.joinGame(startA.code))
    const b2 = track(await B.api.joinGame(startB.code))
    expect(a2.info.myColor).toBe('black')
    expect(b2.info.myColor).toBe('white')
    expect(a2.info.opponentJoined).toBe(true)
    expect(a2.info.clock).toEqual({ initial: 300, delayPerTimeline: 5 })
    await expect(newApi().api.joinGame(startA.code)).rejects.toThrow(/game is full/)
  })

  it('cancel closes the waiting room: joining then fails', { timeout: 30_000 }, async () => {
    const A = newApi()
    const a = track(await A.api.createGame({ variantId: 'standard', color: 'random', clock: null }))
    const code = a.info.code
    await a.cancel()
    expect(a.info.cancelled).toBe(true)
    expect(A.api.recentGames().some((g) => g.code === code)).toBe(false)
    await expect(newApi().api.joinGame(code)).rejects.toThrow(/This game was cancelled/)
  })

  it('the SERVER records a real checkmate (Very Small - Open: b1-b4, d3-d2, c1-d2)', { timeout: 60_000 }, async () => {
    const A = newApi()
    const B = newApi()
    const a = track(await A.api.createGame({ variantId: 'very_small_open', color: 'white', clock: null }))
    const b = track(await B.api.joinGame(a.info.code))
    const recA = recorder(a)
    const recB = recorder(b)
    await sleep(1500)
    await a.submitAction(0, act('white', mv(0, 2, 1, 0, 1, 3)))
    await recB.waitFor((e) => e.type === 'action' && e.index === 0, 'B gets b1-b4')
    await b.submitAction(1, act('black', mv(0, 3, 3, 2, 3, 1)))
    await recA.waitFor((e) => e.type === 'action' && e.index === 1, 'A gets d3-d2')
    await a.submitAction(2, act('white', mv(0, 4, 2, 0, 3, 1)))
    // nobody claims anything: the result arrives from the server (background search + broadcast hint)
    const r = await recB.waitFor((e) => e.type === 'result', 'B receives the server-recorded mate', 20_000)
    expect(r).toEqual({ type: 'result', result: { kind: 'checkmate', winner: 'white' } })
    await recA.waitFor((e) => e.type === 'result', 'A receives the server-recorded mate', 20_000)
    expect(a.info.result).toEqual({ kind: 'checkmate', winner: 'white' })
    expect(a.info.endedAt).not.toBeNull()
  })

  it('latency: replaying long multi-timeline games on every submit', { timeout: 600_000 }, async () => {
    const report: string[] = []
    for (const [n, seed] of [
      [40, 1],
      [120, 3],
    ] as const) {
      const actions = randomGame('standard', n, seed)
      const final = Game.fromActions('standard', actions, { skipMateDetection: true })
      const timelines = final.snapshot().timelines.length
      const tokens = { white: `lat-w-${seed}-${'x'.repeat(16)}`, black: `lat-b-${seed}-${'y'.repeat(16)}` }
      const call = async (body: Record<string, unknown>) => {
        const t0 = performance.now()
        const res = await fetch(`${env.url}/functions/v1/game-action`, {
          method: 'POST',
          headers: { apikey: env.key, Authorization: `Bearer ${env.key}`, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
        const rtt = performance.now() - t0
        const json = await res.json()
        if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(json)}`)
        return { json, rtt, timing: res.headers.get('server-timing') ?? '' }
      }
      const created = await call({ op: 'create', variantId: 'standard', color: 'white', token: tokens.white, clock: null })
      const code = created.json.code as string
      codes.add(code)
      const supa = createSupabaseClient(env.url, env.key)
      const joined = await supa.rpc('join_game', { p_code: code, p_token: tokens.black })
      expect(joined.error).toBeNull()
      const samples: { i: number; rtt: number; timing: string }[] = []
      for (let i = 0; i < actions.length; i++) {
        const r = await call({ op: 'submit', code, token: tokens[actions[i].player], index: i, action: actions[i] })
        samples.push({ i, rtt: r.rtt, timing: r.timing })
        if (i === actions.length - 1) {
          // the server stored the same canonical history as our engine
          expect(r.json.actions.map(({ at: _a, nextActiveTimelines: _n, ...rest }: Record<string, unknown>) => rest)).toEqual(
            JSON.parse(JSON.stringify(final.history)),
          )
        }
      }
      const last = samples.slice(-10)
      const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length
      const replay = (t: string) => Number(/replay;dur=([\d.]+)/.exec(t)?.[1] ?? NaN)
      report.push(
        `${actions.length} actions / ${timelines} timelines: first submit ${samples[0].rtt.toFixed(0)} ms; ` +
          `last 10 submits avg RTT ${avg(last.map((s) => s.rtt)).toFixed(0)} ms (max ${Math.max(...last.map((s) => s.rtt)).toFixed(0)}), ` +
          `server replay avg ${avg(last.map((s) => replay(s.timing))).toFixed(0)} ms; last Server-Timing: ${last.at(-1)!.timing}`,
      )
      expect(avg(last.map((s) => s.rtt))).toBeLessThan(2500)
    }
    console.log(`[live] latency\n  ${report.join('\n  ')}`)
  })
})
