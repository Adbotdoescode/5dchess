// Deno tests for the game-action logic against an in-memory stand-in of the RPCs.
//   cd supabase/functions && deno test game-action/

import { assert, assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { DbError, HttpError, handle } from './logic.ts'
import type { Deps } from './logic.ts'
import { randomGame } from './testgame.ts'

interface Row {
  code: string
  variant: string
  white: string | null
  black: string | null
  actions: Record<string, unknown>[]
  result: Record<string, unknown>
  first: string
  firstActive: number
  drawOffer: string | null
}

function fakeDeps() {
  const rows = new Map<string, Row>()
  const pending: Promise<unknown>[] = []
  const broadcasts: unknown[] = []
  const calls: string[] = []
  const json = (r: Row, color: string) => ({
    code: r.code,
    variantId: r.variant,
    myColor: color,
    actions: structuredClone(r.actions),
    result: r.result,
    opponentJoined: !!(r.white && r.black),
    firstPlayer: r.first,
    firstActiveTimelines: r.firstActive,
    drawOffer: r.drawOffer,
  })
  const seat = (r: Row, tok: unknown) => (r.white === tok ? 'white' : r.black === tok ? 'black' : null)
  const deps: Deps = {
    async rpc(fn, a) {
      calls.push(fn)
      const r = rows.get(String(a.p_code))
      switch (fn) {
        case 'create_game': {
          const code = `G${rows.size}AAAA`.slice(0, 6)
          const row: Row = {
            code,
            variant: String(a.p_variant),
            white: a.p_color === 'white' ? String(a.p_token) : null,
            black: a.p_color === 'black' ? String(a.p_token) : null,
            actions: [],
            result: { kind: 'ongoing' },
            first: String(a.p_first),
            firstActive: Number(a.p_first_active_timelines),
            drawOffer: null,
          }
          rows.set(code, row)
          return json(row, String(a.p_color))
        }
        case 'get_game':
          if (!r) throw new DbError('game not found')
          return json(r, seat(r, a.p_token) ?? 'spectator')
        case 'submit_action': {
          if (!r) throw new DbError('game not found')
          const c = seat(r, a.p_token)
          if (!c) throw new DbError('not a player in this game')
          if (a.p_index !== r.actions.length) throw new DbError(`out of sync: expected index ${r.actions.length}`)
          r.actions.push({ ...(a.p_action as object), at: 'now', nextActiveTimelines: a.p_next_active_timelines })
          r.drawOffer = null
          return json(r, c)
        }
        case 'set_result': {
          if (!r) throw new DbError('game not found')
          const c = seat(r, a.p_token)!
          const res = a.p_result as Record<string, unknown>
          if (res.kind === 'resignation' && res.winner === c) throw new DbError('you can only resign for yourself')
          if (res.kind === 'draw-agreed' && r.drawOffer !== (c === 'white' ? 'black' : 'white')) {
            throw new DbError('no draw offer from your opponent')
          }
          if (a.p_expected_len != null && a.p_expected_len !== r.actions.length) throw new DbError('out of sync')
          if (r.result.kind === 'ongoing') r.result = res
          return json(r, c)
        }
      }
      throw new Error(`unexpected rpc ${fn}`)
    },
    now: () => performance.now(),
    background: (p) => void pending.push(p),
    broadcast: async (_code, payload) => void broadcasts.push(payload),
    log: () => {},
  }
  const settle = () => Promise.all(pending.splice(0))
  return { rows, deps, settle, broadcasts, calls }
}

const W = 'white-token-0123456789'
const B = 'black-token-0123456789'

async function newGame(variantId: string) {
  const f = fakeDeps()
  const { body } = await handle({ op: 'create', variantId, color: 'white', token: W, clock: null }, f.deps)
  const code = (body as { code: string }).code
  f.rows.get(code)!.black = B
  return { ...f, code }
}

const mv = (l: number, t: number, x: number, y: number, tx: number, ty: number) => ({
  from: { l, t, x, y },
  to: { l, t, x: tx, y: ty },
})

Deno.test('create validates the variant and derives first player / active timelines', async () => {
  const f = fakeDeps()
  await assertRejects(
    () => handle({ op: 'create', variantId: 'nope', color: 'white', token: W, clock: null }, f.deps),
    HttpError,
    'unknown variant',
  )
  const { body } = await handle({ op: 'create', variantId: 'Standard', color: 'white', token: W, clock: null }, f.deps)
  const row = f.rows.get((body as { code: string }).code)!
  assertEquals(row.variant, 'standard')
  assertEquals(row.first, 'white')
  assertEquals(row.firstActive, 1)
})

Deno.test('legal action is stored canonically with the server-computed timeline count', async () => {
  const { deps, rows, code } = await newGame('standard')
  // e2-e4 with junk fields and a lying timeline count
  const action = { player: 'white', moves: [{ ...mv(0, 2, 4, 1, 4, 3), junk: 'x'.repeat(100) }], extra: 1 }
  await handle({ op: 'submit', code, token: W, index: 0, action, nextActiveTimelines: 7 }, deps)
  const stored = rows.get(code)!.actions[0]
  assertEquals(stored.nextActiveTimelines, 1)
  assertEquals(stored.moves, [mv(0, 2, 4, 1, 4, 3)])
  assertEquals(stored.extra, undefined)
})

Deno.test('illegal actions are rejected and nothing is stored', async () => {
  const { deps, rows, code } = await newGame('standard')
  const submit = (action: unknown, token = W, index = 0) => handle({ op: 'submit', code, token, index, action }, deps)
  // king teleport e1-e6
  const e = await assertRejects(() => submit({ player: 'white', moves: [mv(0, 2, 4, 0, 4, 5)] }), HttpError)
  assertEquals((e as HttpError).status, 422)
  assertEquals((e as HttpError).code, 'illegal')
  // empty action (must move in the present)
  await assertRejects(() => submit({ player: 'white', moves: [] }), HttpError, 'malformed')
  // black moving first
  await assertRejects(() => submit({ player: 'black', moves: [mv(0, 2, 4, 6, 4, 4)] }, B), HttpError, 'not your turn')
  // wrong seat in the action
  await assertRejects(() => submit({ player: 'black', moves: [mv(0, 2, 4, 1, 4, 3)] }), HttpError, 'does not match')
  // stale index
  await assertRejects(() => submit({ player: 'white', moves: [mv(0, 2, 4, 1, 4, 3)] }, W, 3), HttpError, 'out of sync')
  // spectator token
  await assertRejects(() => submit({ player: 'white', moves: [mv(0, 2, 4, 1, 4, 3)] }, 'spectator-token-xxxx'), HttpError, 'not a player')
  // malformed coordinates
  await assertRejects(() => submit({ player: 'white', moves: [{ from: { l: 0, t: 2, x: 'e', y: 1 }, to: {} }] }), HttpError, 'malformed')
  assertEquals(rows.get(code)!.actions.length, 0)
})

Deno.test('fake checkmate claim is rejected; resignation passes through', async () => {
  const { deps, rows, code } = await newGame('standard')
  await assertRejects(
    () => handle({ op: 'result', code, token: W, result: { kind: 'checkmate', winner: 'white' } }, deps),
    HttpError,
    'no checkmate',
  )
  await assertRejects(
    () => handle({ op: 'result', code, token: W, result: { kind: 'draw-agreed' } }, deps),
    DbError,
    'no draw offer',
  )
  assertEquals(rows.get(code)!.result.kind, 'ongoing')
  await handle({ op: 'result', code, token: B, result: { kind: 'resignation', winner: 'white' } }, deps)
  assertEquals(rows.get(code)!.result, { kind: 'resignation', winner: 'white' })
})

Deno.test('the server detects a real checkmate (Very Small - Open: b1-b4, d3-d2, c1-d2)', async () => {
  const { deps, rows, code, settle, broadcasts } = await newGame('very_small_open')
  const submit = async (token: string, index: number, player: string, m: unknown) => {
    await handle({ op: 'submit', code, token, index, action: { player, moves: [m] } }, deps)
    await settle()
  }
  await submit(W, 0, 'white', mv(0, 2, 1, 0, 1, 3))
  await submit(B, 1, 'black', mv(0, 3, 3, 2, 3, 1))
  assertEquals(rows.get(code)!.result.kind, 'ongoing')
  await submit(W, 2, 'white', mv(0, 4, 2, 0, 3, 1))
  assertEquals(rows.get(code)!.result, { kind: 'checkmate', winner: 'white' })
  assertEquals(broadcasts, [{ t: 'result' }])
})

Deno.test('a mate claim records the server verdict', async () => {
  const { deps, rows, code } = await newGame('very_small_open')
  const r = rows.get(code)!
  r.actions = [
    { player: 'white', moves: [mv(0, 2, 1, 0, 1, 3)] },
    { player: 'black', moves: [mv(0, 3, 3, 2, 3, 1)] },
    { player: 'white', moves: [mv(0, 4, 2, 0, 3, 1)] },
  ]
  // claimed as stalemate, recorded as what it is
  await handle({ op: 'result', code, token: B, result: { kind: 'stalemate' } }, deps)
  assertEquals(r.result, { kind: 'checkmate', winner: 'white' })
})

Deno.test('replay latency on long multi-timeline games', async () => {
  for (const [n, seed] of [[40, 1], [120, 3]]) {
    const { actions, game } = randomGame('standard', n, seed)
    const { deps, rows, code } = await newGame('standard')
    const r = rows.get(code)!
    r.actions = actions.slice(0, -1).map((a) => ({ ...a }))
    const last = actions[actions.length - 1]
    const token = last.player === 'white' ? W : B
    const { timing } = await handle({ op: 'submit', code, token, index: actions.length - 1, action: last }, deps)
    const timelines = game.snapshot().timelines.length
    console.log(`  ${actions.length} actions, ${timelines} timelines:`, JSON.stringify(timing, (_k, v) => (typeof v === 'number' ? Math.round(v) : v)))
    assert(timing.total < 1000)
  }
})
