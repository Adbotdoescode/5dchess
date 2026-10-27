// Edge Function `game-action`: the only way to submit actions, create games and
// claim results in online play. Deployed with verify_jwt = false (the app calls
// it with the publishable key and has no user accounts); every request is
// authorised by its seat token, checked by the database RPCs.
// See logic.ts for the ops and supabase/migrations/*_server_authority.sql.

import { DbError, HttpError, dbErrorStatus, handle } from './logic.ts'
import type { Deps } from './logic.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const MAX_BODY = 128 * 1024

const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Expose-Headers': 'server-timing',
  'Access-Control-Max-Age': '86400',
}

function authHeaders(): Record<string, string> {
  const h: Record<string, string> = { apikey: SERVICE_KEY }
  // Legacy JWT keys also go in Authorization; new sb_secret_ keys must not.
  if (SERVICE_KEY.startsWith('eyJ')) h.Authorization = `Bearer ${SERVICE_KEY}`
  return h
}

async function rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(args),
  })
  const text = await res.text()
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    // non-JSON error body
  }
  if (!res.ok) {
    const message = (data as { message?: string } | null)?.message ?? `${fn} failed (${res.status})`
    throw new DbError(message)
  }
  return data
}

async function broadcast(code: string, payload: unknown): Promise<void> {
  try {
    const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ topic: `game:${code}`, event: 'msg', payload, private: false }] }),
    })
    if (!res.ok) console.warn('broadcast failed', res.status, await res.text())
  } catch (e) {
    console.warn('broadcast failed', String(e))
  }
}

declare const EdgeRuntime: { waitUntil(p: Promise<unknown>): void } | undefined

const deps: Deps = {
  rpc,
  now: () => performance.now(),
  background(p) {
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(p)
  },
  broadcast,
  log: (msg, data) => console.log(JSON.stringify({ msg, ...data })),
}

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json', ...extra },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json(405, { error: 'method not allowed', code: 'bad_request' })
  let body: unknown
  try {
    const text = await req.text()
    if (text.length > MAX_BODY) return json(413, { error: 'request too large', code: 'bad_request' })
    body = JSON.parse(text)
  } catch {
    return json(400, { error: 'invalid JSON', code: 'bad_request' })
  }
  try {
    const { body: out, timing } = await handle(body, deps)
    const serverTiming = Object.entries(timing)
      .map(([k, v]) => `${k};dur=${v.toFixed(1)}`)
      .join(', ')
    return json(200, out, { 'Server-Timing': serverTiming })
  } catch (e) {
    if (e instanceof HttpError) return json(e.status, { error: e.message, code: e.code })
    if (e instanceof DbError) {
      const { status, code } = dbErrorStatus(e.message)
      return json(status, { error: e.message, code })
    }
    console.error('game-action failed', e)
    return json(500, { error: 'internal error', code: 'internal' })
  }
})
