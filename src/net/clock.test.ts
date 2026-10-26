import { describe, expect, it } from 'vitest'
import { ClockOffsetEstimator, computeClocks, parseServerTime, sideToMove } from './clock'
import { isValidCode, normalizeCode, parseJoinCode, shareUrl, generateToken } from './codes'
import type { ClockInput } from './clock'

const base = (over: Partial<ClockInput> = {}): ClockInput => ({
  clock: { initial: 60, increment: 2 },
  firstPlayer: 'white',
  startedAt: 0,
  endedAt: null,
  result: { kind: 'ongoing' },
  actions: [],
  actionTimes: [],
  ...over,
})

describe('computeClocks', () => {
  it('returns null for untimed games and full time before start', () => {
    expect(computeClocks(base({ clock: null }), 5000)).toBeNull()
    expect(computeClocks(base({ startedAt: null }), 5000)).toEqual({
      white: 60000,
      black: 60000,
      running: null,
      flagged: null,
    })
  })

  it('charges the side to move and adds increments per completed turn', () => {
    const g = base({
      actions: [{ player: 'white' }, { player: 'black' }],
      actionTimes: [10_000, 25_000],
    })
    // white used 10s (+2 inc) and is running for 5s more; black used 15s (+2)
    expect(computeClocks(g, 30_000)).toEqual({ white: 47_000, black: 47_000, running: 'white', flagged: null })
  })

  it('respects firstPlayer (turn-zero variants)', () => {
    const g = base({ firstPlayer: 'black' })
    expect(sideToMove(g.actions, 'black')).toBe('black')
    expect(computeClocks(g, 10_000)).toMatchObject({ white: 60_000, black: 50_000, running: 'black' })
  })

  it('freezes at endedAt and reports flags', () => {
    const g = base({ result: { kind: 'timeout', winner: 'black' }, endedAt: 61_000 })
    expect(computeClocks(g, 999_999)).toEqual({ white: -1000, black: 60_000, running: null, flagged: 'white' })
    expect(computeClocks(base(), 70_000)?.flagged).toBe('white')
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
