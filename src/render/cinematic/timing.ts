// Timeline of the time-travel cinematic, measured frame by frame from the original at
// 75 fps. All times are seconds from the moment the travel move is made (the
// parenthesised times are offsets on the reference capture).
// Pure math, no DOM: unit-tested in __tests__/cinematic.test.ts.

/** HUD (pills, tabs, status text) fades out as the camera starts to move (38.35-38.60 s). */
export const HUD_OUT = { start: 0.02, end: 0.27 }

/**
 * Camera orbit from the top-down view to looking back along time: elevation and
 * azimuth are lerped together (elev = θ, azim = 180° - θ, θ: 90° → 0°) with an
 * easeInOutSine, and the orthographic view height is interpolated with the same
 * easing (least-squares fit to 21 frames: start 38.40 s, 1.506 s long, RMS 0.9 deg).
 */
export const ORBIT = { start: 0.071, duration: 1.506 }
/** The card stack is cut to the flight layout here (θ ≈ 1°, a 14 px snap in the footage). */
export const STACK_CUT = 1.495
/** Floor → vortex cross-fade (smoothstep). */
export const FLOOR_FADE = { start: 0.527, end: 1.157 }
/** The front card rests until the flight begins (40.03-40.27 s). */
export const FLIGHT_START = 1.735

/**
 * Flight through the boards (perspective, depth in board spacings). A board at depth d
 * has a square area of FLIGHT_K * base / d px, where base is the view height (or the
 * width on narrow screens, see cinematicBase).
 */
export const FLIGHT_K = 100 / 1022
/** Depth of the front (source) card when the flight starts: it is as big as at the end of the stack. */
export const DEPTH_START = 0.3546
/** The travelling piece rides at this depth; the destination board stops here (786 px of 1022). */
export const DEPTH_LAND = 0.1272
/** Boards between the camera and DEPTH_LAND fade out, gone by about this depth. */
export const DEPTH_GONE = 0.035
/** Camera acceleration (spacings / s²) up to cruise speed. */
export const FLIGHT_ACCEL = 2.68
/** Cruise speed: one board per second, as in the original, for up to this many boards... */
export const CRUISE_SPEED = 1
export const MAX_REAL_TIME_BOARDS = 6
/** ...longer trips cruise faster so the flight never takes much longer than this (seconds). */
export const MAX_CRUISE_SECONDS = 6

/** The vortex rings stream inwards by this many rings per board spacing travelled (8 rings/s at cruise). */
export const RINGS_PER_SPACING = 8

/** After landing: HUD fades back in over the vortex (42.70-42.83 s). */
export const HUD_IN = { delay: 0.02, duration: 0.13 }
/** Then the vortex dissolves into the game, which already shows the new board at the same size. */
export const END_FADE = { delay: 0.04, duration: 0.9 }
/** The overlay is removed and the game camera zooms out (43.69-44.13 s, easeOutSine). */
export const OVERLAY_END = 0.995
export const ZOOM_OUT_SECONDS = 0.44

/** Orthographic view height at the end of the orbit, as a multiple of the base size per world unit. */
export const STACK_ZOOM = 366.1 / 1022

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x)
export const easeInOutSine = (x: number) => (1 - Math.cos(Math.PI * clamp01(x))) / 2
export const easeOutSine = (x: number) => Math.sin((Math.PI / 2) * clamp01(x))
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
/** The end cross-fade measured between linear and smoothstep. */
export const endFadeCurve = (u: number) => {
  const t = clamp01(u)
  return 0.5 * (t + t * t * (3 - 2 * t))
}

export interface FlightPlan {
  /** Boards passed before the destination (the source board counts). */
  passes: number
  /** Cruise speed (spacings / s). */
  speed: number
  /** Acceleration (spacings / s²). */
  accel: number
  /** Distance to travel until the destination board reaches DEPTH_LAND. */
  distance: number
  /** Flight duration (s). */
  duration: number
}

/** Plans the flight for a trip that passes `passes` boards before landing on the destination. */
export function planFlight(passes: number): FlightPlan {
  const n = Math.max(1, Math.round(passes))
  const distance = DEPTH_START + n - DEPTH_LAND
  let speed = CRUISE_SPEED
  if (n > MAX_REAL_TIME_BOARDS) speed = Math.max(CRUISE_SPEED, distance / MAX_CRUISE_SECONDS)
  const accel = FLIGHT_ACCEL * speed
  const t1 = speed / accel
  const d1 = (accel * t1 * t1) / 2
  const duration = distance <= d1 ? Math.sqrt((2 * distance) / accel) : t1 + (distance - d1) / speed
  return { passes: n, speed, accel, distance, duration }
}

/** Distance travelled (spacings) `tau` seconds after the flight starts. */
export function flightDistance(plan: FlightPlan, tau: number): number {
  if (tau <= 0) return 0
  if (tau >= plan.duration) return plan.distance
  const t1 = plan.speed / plan.accel
  if (tau <= t1) return (plan.accel * tau * tau) / 2
  return (plan.accel * t1 * t1) / 2 + (tau - t1) * plan.speed
}

/** Time (s after flight start) when `dist` has been travelled. */
export function flightTimeAt(plan: FlightPlan, dist: number): number {
  if (dist <= 0) return 0
  if (dist >= plan.distance) return plan.duration
  const t1 = plan.speed / plan.accel
  const d1 = (plan.accel * t1 * t1) / 2
  if (dist <= d1) return Math.sqrt((2 * dist) / plan.accel)
  return t1 + (dist - d1) / plan.speed
}

/** Opacity of a board at depth d in the flight (fades once it is nearer than the piece). */
export function boardAlpha(d: number): number {
  if (d >= DEPTH_LAND) return 1
  const u = (d - DEPTH_GONE) / (DEPTH_LAND - DEPTH_GONE)
  return u <= 0 ? 0 : Math.pow(u, 0.7)
}

export interface Schedule {
  plan: FlightPlan
  /** Piece leaves the source board (its board reaches DEPTH_LAND). */
  detach: number
  /** Landing on the destination board. */
  land: number
  /** HUD back in. */
  hudIn: { start: number; end: number }
  /** Vortex dissolves. */
  endFade: { start: number; end: number }
  /** Overlay removed, game camera zooms out. */
  overlayEnd: number
  /** Everything finished (zoom-out done). */
  total: number
}

export function schedule(passes: number): Schedule {
  const plan = planFlight(passes)
  const land = FLIGHT_START + plan.duration
  const detach = FLIGHT_START + flightTimeAt(plan, DEPTH_START - DEPTH_LAND)
  return {
    plan,
    detach,
    land,
    hudIn: { start: land + HUD_IN.delay, end: land + HUD_IN.delay + HUD_IN.duration },
    endFade: { start: land + END_FADE.delay, end: land + END_FADE.delay + END_FADE.duration },
    overlayEnd: land + OVERLAY_END,
    total: land + OVERLAY_END + ZOOM_OUT_SECONDS,
  }
}

/** Orbit progress 0..1 at time c. */
export const orbitProgress = (c: number) => easeInOutSine((c - ORBIT.start) / ORBIT.duration)

/** HUD opacity at time c (1 = fully visible). */
export function hudOpacity(c: number, s: Schedule): number {
  if (c < s.hudIn.start) return 1 - clamp01((c - HUD_OUT.start) / (HUD_OUT.end - HUD_OUT.start))
  return clamp01((c - s.hudIn.start) / (s.hudIn.end - s.hudIn.start))
}
