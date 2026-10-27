// Remembered menu choices (variant, colour, time controls).

import { useState } from 'react'
import type { Color } from '../engine'
import type { ClockPresetId } from '../net'
import { KEYS, loadJson, saveJson } from './storage'

export const RANDOM_VARIANT = 'random'

export interface CreateOpts {
  variantId: string
  color: Color | 'random'
  clock: ClockPresetId
}

export interface Setup {
  variantId: string
  color: Color | 'random'
  clock: ClockPresetId
  localClock: ClockPresetId
}

const DEFAULT_SETUP: Setup = { variantId: 'standard', color: 'random', clock: 'none', localClock: 'none' }

export function useSetup(): [Setup, (p: Partial<Setup>) => void] {
  const [setup, setSetup] = useState<Setup>(() => ({ ...DEFAULT_SETUP, ...(loadJson<Partial<Setup>>(KEYS.lastSetup) ?? {}) }))
  const update = (p: Partial<Setup>) =>
    setSetup((s) => {
      const n = { ...s, ...p }
      saveJson(KEYS.lastSetup, n)
      return n
    })
  return [setup, update]
}
