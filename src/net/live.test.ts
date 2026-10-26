// Opt-in end-to-end test against the real Supabase project.
//   NET_LIVE=1 npx vitest run src/net/live.test.ts
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY from the environment or .env.local.
// Creates a few rows in public.games (codes are printed); anon cannot delete them,
// so clean up afterwards with the service role / SQL editor if desired.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { Action, Color } from '../engine/types'
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

const act = (player: Color, tag: string): Action => ({ player, moves: [{ tag } as never] })

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

describe.skipIf(!LIVE)('live Supabase backend', () => {
  const sessions: OnlineSession[] = []
  const codes = new Set<string>()

  afterAll(async () => {
    await Promise.all(sessions.map((s) => s.leave()))
    console.log(`[live] games created: ${[...codes].join(', ')}`)
  })

  it('create → join → alternate actions via broadcast → rejections → result → rematch', { timeout: 90_000 }, async () => {
    const { url, key } = loadEnv()
    const supaA = createSupabaseClient(url, key)
    const supaB = createSupabaseClient(url, key)
    const storageA = memoryStorage()
    const storageB = memoryStorage()
    const apiA = createOnlineApi({ client: fromSupabase(supaA), storage: storageA })
    const apiB = createOnlineApi({ client: fromSupabase(supaB), storage: storageB })

    const a = await apiA.createGame({ variantId: 'standard', color: 'white', clock: { initial: 300, increment: 5 } })
    sessions.push(a)
    codes.add(a.info.code)
    const recA = recorder(a)
    expect(a.info.code).toMatch(/^[A-Z2-9]{6}$/)
    expect(a.info.myColor).toBe('white')
    expect(a.info.opponentJoined).toBe(false)
    expect(a.info.startedAt).toBeNull()
    expect(a.info.clock).toEqual({ initial: 300, increment: 5 })

    // submitting before the opponent joins is refused
    await expect(a.submitAction(0, act('white', 'early'))).rejects.toThrow(/waiting for opponent/)

    await new Promise((r) => setTimeout(r, 1500)) // let A's channel subscribe
    const b = await apiB.joinGame(a.info.code.toLowerCase())
    sessions.push(b)
    const recB = recorder(b)
    expect(b.info.myColor).toBe('black')
    expect(b.info.startedAt).not.toBeNull()
    await recA.waitFor((e) => e.type === 'opponent-joined', 'opponent-joined')
    expect(a.info.startedAt).toBe(b.info.startedAt)
    await recA.waitFor((e) => e.type === 'opponent-presence' && e.online, 'presence (A sees B)')
    await recB.waitFor((e) => e.type === 'opponent-presence' && e.online, 'presence (B sees A)')

    // a third party can't take a seat but can watch
    const apiC = createOnlineApi({ client: fromSupabase(createSupabaseClient(url, key)), storage: memoryStorage() })
    await expect(apiC.joinGame(a.info.code)).rejects.toThrow(/game is full/)
    const c = await apiC.spectateGame(a.info.code)
    sessions.push(c)
    expect(c.role).toBe('spectator')

    await new Promise((r) => setTimeout(r, 1000)) // let B's channel subscribe
    await a.submitAction(0, act('white', 'w1'))
    const got0 = await recB.waitFor((e) => e.type === 'action' && e.index === 0, 'B receives action 0')
    expect(got0).toMatchObject({ type: 'action', index: 0, action: act('white', 'w1') })
    expect(typeof (got0 as { at?: number }).at).toBe('number')

    await b.submitAction(1, act('black', 'b1'))
    await recA.waitFor((e) => e.type === 'action' && e.index === 1, 'A receives action 1')

    await a.submitAction(2, act('white', 'w2'))
    await recB.waitFor((e) => e.type === 'action' && e.index === 2, 'B receives action 2')

    // no echoes, no duplicates
    expect(recA.events.filter((e) => e.type === 'action').map((e) => (e as { index: number }).index)).toEqual([1])
    expect(recB.events.filter((e) => e.type === 'action').map((e) => (e as { index: number }).index)).toEqual([0, 2])
    expect(a.info.actions).toEqual(b.info.actions)
    expect(a.info.actionTimes.every((t) => typeof t === 'number')).toBe(true)

    // out of turn / out of sync / wrong seat
    await expect(a.submitAction(3, act('white', 'again'))).rejects.toThrow(/not your turn/)
    await expect(b.submitAction(7, act('black', 'skip'))).rejects.toThrow(/out of sync: expected index 3/)
    expect(recB.events.some((e) => e.type === 'error' && /out of sync/.test(e.message))).toBe(true)
    await expect(b.submitAction(3, act('white', 'imposter'))).rejects.toThrow(/does not match your seat/)

    // clocks: server-stamped and consistent with the server's own computation
    const clocks = a.clocks()!
    expect(clocks.running).toBe('black')
    expect(clocks.white).toBeGreaterThan(290_000)
    expect(clocks.white).toBeLessThanOrEqual(310_000)
    expect(a.info.clockMs).not.toBeNull()
    expect(Math.abs(a.info.serverTimeOffset)).toBeLessThan(60_000)
    console.log('[live] clocks', clocks, 'offset', a.info.serverTimeOffset, 'server clockMs', a.info.clockMs)

    // a premature timeout claim is refused by the server
    const raw = await supaA.rpc('set_result', {
      p_code: a.info.code,
      p_token: storageA.getItem(`5dchess:seat:${a.info.code}`),
      p_result: { kind: 'timeout', winner: 'white' },
    })
    expect(raw.error?.message).toMatch(/clock not expired: \d+ ms remaining/)
    // can't resign on the opponent's behalf
    await expect(a.setResult({ kind: 'resignation', winner: 'white' })).rejects.toThrow(/only resign for yourself/)

    // spectator saw everything
    await c.resync()
    expect(c.info.actions).toHaveLength(3)

    // resignation propagates
    await b.setResult({ kind: 'resignation', winner: 'white' })
    await recA.waitFor((e) => e.type === 'result', 'A receives result')
    expect(a.info.result).toEqual({ kind: 'resignation', winner: 'white' })
    await expect(a.submitAction(3, act('white', 'late'))).rejects.toThrow(/game is over/)

    // rematch with swapped colors
    a.offerRematch()
    await recB.waitFor((e) => e.type === 'rematch-offer', 'rematch-offer')
    b.acceptRematch()
    const startA = (await recA.waitFor((e) => e.type === 'rematch-start', 'A rematch-start')) as { code: string }
    const startB = (await recB.waitFor((e) => e.type === 'rematch-start', 'B rematch-start')) as { code: string }
    expect(startA.code).toBe(startB.code)
    codes.add(startA.code)
    const a2 = await apiA.joinGame(startA.code)
    const b2 = await apiB.joinGame(startB.code)
    sessions.push(a2, b2)
    expect(a2.info.myColor).toBe('black')
    expect(b2.info.myColor).toBe('white')
    expect(a2.info.clock).toEqual({ initial: 300, increment: 5 })

    // rejoin after "refresh": a fresh API instance over the same storage resumes the seat
    const apiA2 = createOnlineApi({ client: fromSupabase(supaA), storage: storageA })
    expect(apiA2.recentGames().map((g) => g.code)).toEqual(expect.arrayContaining([a.info.code, startA.code]))
    const resumed = await apiA2.joinGame(a.info.code)
    sessions.push(resumed)
    expect(resumed.info.myColor).toBe('white')
    expect(resumed.info.actions).toHaveLength(3)
  })
})
