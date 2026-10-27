// Persisted user settings (a tiny external store for useSyncExternalStore).

import { useSyncExternalStore } from 'react'
import { KEYS, loadJson, saveJson } from './storage'

export interface Settings {
  /** Sound effects on/off and volume (0..1). */
  sound: boolean
  volume: number
  /** Piece and board animations (pieces glide, new boards slide out). */
  animations: boolean
  /**
   * The original's round button (blue swirl = on, grey checker = off; hotkey I): the next
   * time travel you make plays the full-screen vortex cinematic, after which the button
   * turns itself off.
   * Global and persisted, like the original's (not per game).
   */
  travelAnimation: boolean
  /** Local games: flip the view to the side to move after each submit (original default: on). */
  autoFlip: boolean
  /** Draw travel arrows for the whole history (original) or only for the last action. */
  allArrows: boolean
  /** Yellow/blue last-move squares on every past board. */
  historyHighlights: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  volume: 0.6,
  animations: true,
  travelAnimation: true,
  autoFlip: true,
  allArrows: true,
  historyHighlights: true,
}

function load(): Settings {
  const saved = { ...(loadJson<Partial<Settings> & { cameraMode?: unknown }>(KEYS.settings) ?? {}) }
  // the old tilted-3D-camera setting became the History / Parallel View tabs
  delete saved.cameraMode
  return { ...DEFAULT_SETTINGS, ...saved }
}

let current: Settings = load()
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
