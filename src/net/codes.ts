// Join codes, share URLs, seat tokens and the "recent games" list.

import type { OnlineRole, RecentGame } from './types'

/** Alphabet used by create_game (no 0/O/1/I). */
const CODE_RE = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/

export function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[\s\-–—_]/g, '')
}

export function isValidCode(code: string): boolean {
  return CODE_RE.test(normalizeCode(code))
}

function currentOrigin(): string {
  return typeof location !== 'undefined' ? location.origin : ''
}

export function shareUrl(code: string, origin: string = currentOrigin()): string {
  return `${origin}/?join=${encodeURIComponent(normalizeCode(code))}`
}

export function parseJoinCode(input?: string): string | null {
  const src = input ?? (typeof location !== 'undefined' ? location.href : '')
  if (!src) return null
  try {
    const join = new URL(src, 'http://local.invalid').searchParams.get('join')
    if (join !== null) {
      const c = normalizeCode(join)
      return isValidCode(c) ? c : null
    }
  } catch {
    // not a URL; fall through to bare code
  }
  const c = normalizeCode(src)
  return isValidCode(c) ? c : null
}

/** Random seat token (32 base64url chars, 192 bits). */
export function generateToken(): string {
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export interface KeyValueStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function memoryStorage(): KeyValueStorage {
  const m = new Map<string, string>()
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
  }
}

/** localStorage when usable, else an in-memory fallback (private mode, SSR, tests). */
export function defaultStorage(): KeyValueStorage {
  try {
    if (typeof localStorage !== 'undefined') {
      const probe = '5dchess:probe'
      localStorage.setItem(probe, '1')
      localStorage.removeItem(probe)
      return localStorage
    }
  } catch {
    // fall through
  }
  return memoryStorage()
}

const TOKEN_PREFIX = '5dchess:seat:'
const RECENT_KEY = '5dchess:recent-games'
const MAX_RECENT = 30

/** Seat tokens + recent games persisted in a KeyValueStorage. */
export class SeatStore {
  private storage: KeyValueStorage
  constructor(storage: KeyValueStorage) {
    this.storage = storage
  }

  getToken(code: string): string | null {
    try {
      return this.storage.getItem(TOKEN_PREFIX + normalizeCode(code))
    } catch {
      return null
    }
  }

  setToken(code: string, token: string): void {
    try {
      this.storage.setItem(TOKEN_PREFIX + normalizeCode(code), token)
    } catch {
      // storage full / unavailable: the seat just won't survive a reload
    }
  }

  list(): RecentGame[] {
    try {
      const raw = this.storage.getItem(RECENT_KEY)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      if (!Array.isArray(parsed)) return []
      return (parsed as RecentGame[])
        .filter((g) => g && typeof g.code === 'string' && typeof g.lastSeen === 'number')
        .sort((a, b) => b.lastSeen - a.lastSeen)
    } catch {
      return []
    }
  }

  touch(entry: { code: string; variantId: string; color: OnlineRole; finished?: boolean }): void {
    const code = normalizeCode(entry.code)
    const rest = this.list().filter((g) => g.code !== code)
    const next: RecentGame[] = [{ ...entry, code, lastSeen: Date.now() }, ...rest]
    for (const dropped of next.splice(MAX_RECENT)) this.removeToken(dropped.code)
    this.saveList(next)
  }

  forget(code: string): void {
    const c = normalizeCode(code)
    this.removeToken(c)
    this.saveList(this.list().filter((g) => g.code !== c))
  }

  private removeToken(code: string): void {
    try {
      this.storage.removeItem(TOKEN_PREFIX + normalizeCode(code))
    } catch {
      // ignore
    }
  }

  private saveList(list: RecentGame[]): void {
    try {
      this.storage.setItem(RECENT_KEY, JSON.stringify(list))
    } catch {
      // ignore
    }
  }
}
