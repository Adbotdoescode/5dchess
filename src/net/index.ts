// Public entry point of the online-play module.

import { createOnlineApi, fromSupabase } from './online'
import { getSupabase } from './supabase'
import type { OnlineApi } from './types'

/** App-wide online API (Supabase client is created on first use). */
export const online: OnlineApi = createOnlineApi({ client: () => fromSupabase(getSupabase()) })

export {
  createOnlineApi,
  fromSupabase,
  GameSession,
  parseSnapshot,
  NetError,
  toNetError,
  GAME_FUNCTION,
  OFFLINE_RETRYING,
  OFFLINE_GAVE_UP,
} from './online'
export type { NetChannel, NetClient, NetEnv, OnlineApiOptions, RpcError } from './online'
export { computeClocks, sideToMove, parseServerTime, ClockOffsetEstimator } from './clock'
export { normalizeCode, isValidCode, shareUrl, parseJoinCode, generateToken, memoryStorage } from './codes'
export type { KeyValueStorage } from './codes'
export { getSupabase, createSupabaseClient } from './supabase'
export { CLOCK_PRESETS } from './types'
export type * from './types'
