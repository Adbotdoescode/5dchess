import { describe, expect, it } from 'vitest'
import { ClockOffsetEstimator, computeClocks, parseServerTime, sideToMove } from './clock'
import { isValidCode, normalizeCode, parseJoinCode, shareUrl, generateToken } from './codes'
import type { ClockInput } from './clock'
import { CLOCK_PRESETS } from './types'

const base = (over: Partial<ClockInput> = {}): ClockInput => ({
  clock: { initial: 600, delayPerTimeline: 3 }, // "Short (10+3/L)"
  firstPlayer: 'white',
  startedAt: 0,
  endedAt: null,
  result: { kind: 'ongoing' },
  actions: [],
  actionTimes: [],
  activeTimelinesAtTurnStart: [1],
  ...over,
})

describe('computeClocks (delay per active timeline)', () => {
  it('returns null for untimed games and full time before start', () => {
    expect(computeClocks(base({ clock: null }), 5000)).toBeNull()
    expect(computeClocks(base({ startedAt: null, activeTimelinesAtTurnStart: [2] }), 5000)).toEqual({
      white: 600_000,
      black: 600_000,
      running: null,
      flagged: null,
      delayRemaining: 0,
      delayMs: { white: 6000, black: 0 }, // upcoming first-turn delay shown for the first player
    })
  })

  it('main time does not run during the delay', () => {
    const c = computeClocks(base(), 2000)!
    expect(c).toMatchObject({ white: 600_000, black: 600_000, running: 'white', delayRemaining: 1000 })
    expect(c.delayMs).toEqual({ white: 1000, black: 0 })
    expect(computeClocks(base(), 3000)).toMatchObject({ white: 600_000, delayRemaining: 0 })
    expect(computeClocks(base(), 10_000)).toMatchObject({ white: 593_000, delayRemaining: 0 })
  })

  it('scales the delay by active timelines at the start of each turn; unused delay is lost', () => {
    const g = base({
      actions: [{ player: 'white' }, { player: 'black' }],
      actionTimes: [1_000, 21_000],
      // turn 0: 1 line (3 s), turn 1: 4 lines (12 s), turn 2: 2 lines (6 s)
      activeTimelinesAtTurnStart: [1, 4, 2],
    })
    // white: turn 0 took 1 s < 3 s delay -> 0 used (2 s lost, not banked)
    // black: turn 1 took 20 s - 12 s delay -> 8 s used
    // white: turn 2 running for 10 s - 6 s delay -> 4 s used
    expect(computeClocks(g, 31_000)).toEqual({
      white: 596_000,
      black: 592_000,
      running: 'white',
      flagged: null,
      delayRemaining: 0,
      delayMs: { white: 0, black: 0 },
    })
    expect(computeClocks(g, 24_000)).toMatchObject({ white: 600_000, delayRemaining: 3000, delayMs: { white: 3000, black: 0 } })
  })

  it('treats a missing count as 1 timeline', () => {
    const g = base({ actions: [{ player: 'white' }], actionTimes: [0], activeTimelinesAtTurnStart: [1, null] })
    expect(computeClocks(g, 3000)).toMatchObject({ running: 'black', black: 600_000, delayRemaining: 0 })
    expect(computeClocks(g, 4000)).toMatchObject({ black: 599_000 })
  })

  it('respects firstPlayer (turn-zero variants)', () => {
    const g = base({ firstPlayer: 'black' })
    expect(sideToMove(g.actions, 'black')).toBe('black')
    expect(computeClocks(g, 10_000)).toMatchObject({ white: 600_000, black: 593_000, running: 'black' })
  })

  it('freezes at endedAt and reports flags', () => {
    const g = base({ clock: { initial: 60, delayPerTimeline: 0 }, result: { kind: 'timeout', winner: 'black' }, endedAt: 61_000 })
    expect(computeClocks(g, 999_999)).toEqual({
      white: -1000,
      black: 60_000,
      running: null,
      flagged: 'white',
      delayRemaining: 0,
      delayMs: { white: 0, black: 0 },
    })
    expect(computeClocks(base({ clock: { initial: 60, delayPerTimeline: 3 } }), 64_000)?.flagged).toBe('white')
  })

  it('has the original presets', () => {
    expect(CLOCK_PRESETS.map((p) => [p.label, p.clock])).toEqual([
      ['No Clock (recommended)', null],
      ['Short (10+3/L)', { initial: 600, delayPerTimeline: 3 }],
      ['Medium (20+5/L)', { initial: 1200, delayPerTimeline: 5 }],
      ['Long (40+8/L)', { initial: 2400, delayPerTimeline: 8 }],
    ])
  })
})

describe('time helpers', () => {
  it('parses postgres microsecond timestamps', () => {
    expect(parseServerTime('2026-10-26T22:23:24.123456+00:00')).toBe(Date.UTC(2026, 9, 26, 22, 23, 24, 123))
    expect(parseServerTime(null)).toBeNull()
    expect(parseServerTime('garbage')).toBeNull()
  })

  it('estimates offset from the min-RTT sample', () => {
    const e = new ClockOffsetEstimator()
    e.add(0, 1000, 10_500) // rtt 1000 -> offset 10000
    e.add(2000, 2100, 12_100) // rtt 100 -> offset 10050
    e.add(3000, 4000, 99_999)
    expect(e.offset).toBe(10_050)
  })
})

describe('codes', () => {
  it('normalizes and validates codes', () => {
    expect(normalizeCode(' k7q-x2m ')).toBe('K7QX2M')
    expect(isValidCode('k7q x2m')).toBe(true)
    expect(isValidCode('K7QX2')).toBe(false)
    expect(isValidCode('K7QX2O')).toBe(false) // O not in alphabet
  })

  it('builds and parses share URLs', () => {
    expect(shareUrl('k7qx2m', 'https://example.com')).toBe('https://example.com/?join=K7QX2M')
    expect(parseJoinCode('https://example.com/?join=k7q-x2m')).toBe('K7QX2M')
    expect(parseJoinCode('?join=K7QX2M&x=1')).toBe('K7QX2M')
    expect(parseJoinCode('K7QX2M')).toBe('K7QX2M')
    expect(parseJoinCode('https://example.com/')).toBeNull()
    expect(parseJoinCode('https://example.com/?join=nope')).toBeNull()
  })

  it('generates long random tokens', () => {
    const t = generateToken()
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/)
    expect(generateToken()).not.toBe(t)
  })
})
