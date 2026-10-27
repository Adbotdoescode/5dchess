import { describe, expect, it } from 'vitest'
import { Game } from '../../engine'
import { travelPath } from '../cinematic/path'
import {
  DEPTH_LAND,
  DEPTH_START,
  FLIGHT_START,
  FLOOR_FADE,
  MAX_CRUISE_SECONDS,
  ORBIT,
  STACK_CUT,
  boardAlpha,
  flightDistance,
  flightTimeAt,
  hudOpacity,
  orbitProgress,
  planFlight,
  schedule,
} from '../cinematic/timing'
import { VORTEX_LUT, vortexProfile } from '../cinematic/vortex'

// The owner's recording (docs/original-recording-notes.md): the move is made at 38.333 s; the
// recorder froze for 0.2 s at 38.735, so later frames are at raw - 38.533 s of animation time.
const raw = (t: number) => (t < 38.735 ? t - 38.333 : t - 38.533)

describe('time-travel cinematic timing (fitted to the recording)', () => {
  const s = schedule(2) // (0T2)Ng1>>(0T1)g3 passes the source board and T1 black

  it('orbit: easeInOutSine from flat to looking back along time', () => {
    expect(orbitProgress(0)).toBe(0)
    expect(orbitProgress(ORBIT.start + ORBIT.duration)).toBeCloseTo(1)
    // measured camera elevation (deg) at a few frames: elev = 90 * (1 - progress)
    const measured: [number, number][] = [
      [38.722, 80.2],
      [39.335, 47.1],
      [39.548, 26.6],
      [39.748, 12.5],
    ]
    for (const [t, deg] of measured) expect(Math.abs(90 * (1 - orbitProgress(raw(t))) - deg)).toBeLessThan(2.5)
    expect(STACK_CUT).toBeGreaterThan(FLOOR_FADE.end)
    expect(FLIGHT_START).toBeGreaterThan(STACK_CUT)
  })

  it('flight: one board per second, the destination lands at 42.68 s', () => {
    expect(s.plan.speed).toBe(1)
    expect(Math.abs(s.land - raw(42.682))).toBeLessThan(0.02)
    // the piece leaves the source board when that board reaches the landing depth (40.68 s)
    expect(Math.abs(s.detach - raw(40.682))).toBeLessThan(0.02)
    // board B (T1 black) is 1 spacing behind the source: 624 px at 41.628 s within a frame
    const d = DEPTH_START + 1 - flightDistance(s.plan, raw(41.588) - FLIGHT_START)
    expect(Math.abs(100 / d - 472)).toBeLessThan(40)
    expect(flightTimeAt(s.plan, flightDistance(s.plan, 1.3))).toBeCloseTo(1.3)
  })

  it('HUD fades out at once and back in right after landing', () => {
    expect(hudOpacity(0, s)).toBe(1)
    expect(hudOpacity(0.5, s)).toBe(0)
    expect(hudOpacity(s.land, s)).toBe(0)
    expect(hudOpacity(s.hudIn.end + 0.01, s)).toBe(1)
    expect(s.overlayEnd).toBeGreaterThan(s.endFade.end)
  })

  it('long trips are compressed, short ones play in real time', () => {
    expect(planFlight(6).speed).toBe(1)
    const long = planFlight(40)
    expect(long.speed).toBeGreaterThan(1)
    expect(long.duration).toBeLessThan(MAX_CRUISE_SECONDS + 0.5)
    expect(planFlight(0).passes).toBe(1)
  })

  it('passing boards fade out between the piece and the camera', () => {
    expect(boardAlpha(DEPTH_LAND)).toBe(1)
    expect(boardAlpha(0.5)).toBe(1)
    expect(boardAlpha(0.02)).toBe(0)
    const mid = boardAlpha((DEPTH_LAND + 0.035) / 2)
    expect(mid).toBeGreaterThan(0.2)
    expect(mid).toBeLessThan(0.8)
  })
})

describe('vortex profile', () => {
  it('fades from blue-grey at the edges to a pale centre', () => {
    const edge = vortexProfile(2)
    const centre = vortexProfile(0.1)
    expect(centre[0]).toBeGreaterThan(edge[0] + 30)
    expect(edge[2]).toBeGreaterThan(edge[0] + 40) // blue
    for (let i = 1; i < VORTEX_LUT.length; i++) expect(VORTEX_LUT[i][0]).toBeGreaterThan(VORTEX_LUT[i - 1][0])
  })
})

describe('travel path', () => {
  it('same timeline: source, every board in between, destination, then earlier boards behind it', () => {
    const g = Game.fromPgn('1. d4 / b5 2. Nf3 / Nf6')
    const s = g.snapshot()
    // (0T3) knight f3 back to (0T1): t 6 -> t 2
    const p = travelPath(s, { l: 0, t: 6, x: 5, y: 2 }, { l: 0, t: 2, x: 5, y: 2 })
    expect(p.passes).toBe(4)
    expect(p.boards.map((b) => b.t)).toEqual([6, 5, 4, 3, 2])
    expect(p.boards.map((b) => b.k)).toEqual([0, 1, 2, 3, 4])
  })

  it('cross-timeline travel: boards in between from the destination timeline, else the source one', () => {
    const g = Game.fromPgn('1. d4 / b5 2. Nf3 / Nf6')
    // white's knight jumps back two half-turns, creating timeline +1 at t = 4..
    const tr = g.movesFrom({ l: 0, t: 6, x: 5, y: 2 }).find((m) => m.to.t === 4 && m.to.l === 0)!
    g.makeMove(tr)
    const s = g.snapshot()
    const tl1 = s.timelines.find((t) => t.l === 1)!
    // a (hypothetical) trip from the main line's T4 board to the start of +1
    const p = travelPath(s, { l: 0, t: 8, x: 1, y: 0 }, { l: 1, t: tl1.startT, x: 2, y: 2 })
    expect(p.passes).toBe(8 - tl1.startT)
    const keys = p.boards.slice(0, p.passes + 1).map((b) => `${b.l}:${b.t}`)
    expect(keys[0]).toBe('0:8')
    expect(keys[keys.length - 1]).toBe(`1:${tl1.startT}`)
    // times the new timeline has no board for come from the main line
    for (const k of keys.slice(1, -1)) {
      const [l, t] = k.split(':').map(Number)
      expect(l === 1 ? t >= tl1.startT && t < tl1.startT + tl1.boards.length : l === 0).toBe(true)
    }
  })

  it('jump at the same time to another timeline passes just the source board', () => {
    const g = Game.create('two_timelines')
    const s = g.snapshot()
    const [a, b] = s.timelines
    const t = a.startT + a.boards.length - 1
    const p = travelPath(s, { l: a.l, t, x: 1, y: 0 }, { l: b.l, t, x: 1, y: 0 })
    expect(p.passes).toBe(1)
    expect(p.boards[0]).toEqual({ l: a.l, t, k: 0 })
    expect(p.boards[1]).toMatchObject({ l: b.l, t, k: 1 })
  })
})
