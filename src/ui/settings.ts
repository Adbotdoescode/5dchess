// Persisted user settings (a tiny external store for useSyncExternalStore).

import { useSyncExternalStore } from 'react'
import { KEYS, loadJson, saveJson } from './storage'

export interface Settings {
  /** Sound effects on/off and volume (0..1). */
  sound: boolean
  volume: number
  /** Time-travel / board animations (the round checkered button). */
  animations: boolean
  /** Local games: flip the view to the side to move after each submit (original default: on). */
  autoFlip: boolean
  /** 2D top-down (original) or tilted 3D camera. */
  cameraMode: '2d' | '3d'
  /** Draw travel arrows for the whole history (original) or only for the last action. */
  allArrows: boolean
  /** Yellow/blue last-move squares on every past board. */
  historyHighlights: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 0.6,
  animations: true,
  autoFlip: true,
  cameraMode: '2d',
  allArrows: true,
  historyHighlights: true,
}

let current: Settings = { ...DEFAULT_SETTINGS, ...(loadJson<Partial<Settings>>(KEYS.settings) ?? {}) }
const listeners = new Set<() => void>()

export function getSettings(): Settings {
  return current
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...current, ...patch }
  saveJson(KEYS.settings, current)
  for (const l of listeners) l()
}

export function subscribeSettings(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function useSettings(): Settings {
  return useSyncExternalStore(subscribeSettings, getSettings, getSettings)
}
