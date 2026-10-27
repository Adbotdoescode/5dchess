// Small, failure-tolerant wrappers around localStorage (private mode, quota, SSR).

export function loadJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // ignore (quota / private mode)
  }
}

export function removeKey(key: string): void {
  try {
    localStorage.removeItem(key)
  } catch {
    // ignore
  }
}

export const KEYS = {
  settings: '5dchess:settings',
  localSave: '5dchess:local-save',
  activeOnline: '5dchess:active-online',
  lastSetup: '5dchess:last-setup',
} as const
