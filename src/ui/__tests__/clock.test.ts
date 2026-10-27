import { describe, expect, test } from 'vitest'
import { formatClock, LocalClock } from '../clock'
import { gameEndedLine, resultText, youLine } from '../format'

describe('LocalClock (original "+N/L" delay model)', () => {
  const settings = { initial: 600, delayPerTimeline: 3 }

  test('delay counts down before main time', () => {
    const c = new LocalClock(settings, 'white', 1, null, 0)
    expect(c.view(2000)).toMatchObject({ white: 600000, black: 600000, running: 'white', delay: 1000 })
    expect(c.view(5000)).toMatchObject({ white: 598000, delay: 0 })
  })

  test('delay scales with active timelines and unused delay is lost', () => {
    const c = new LocalClock(settings, 'white', 1, null, 0)
    c.submitted('white', 2, 1000) // white used 1 s of a 3 s delay: no main time
    expect(c.view(1000)).toMatchObject({ white: 600000, running: 'black', delay: 6000 })
    expect(c.view(9000)).toMatchObject({ black: 598000, delay: 0 })
  })

  test('flag falls and the clock freezes when stopped', () => {
    const c = new LocalClock({ initial: 10, delayPerTimeline: 0 }, 'white', 1, null, 0)
    expect(c.view(11000).flagged).toBe('white')
    c.stop(5000)
    expect(c.view(60000)).toMatchObject({ white: 5000, running: null, flagged: null })
  })

  test('save/restore pauses the clock while closed', () => {
    const c = new LocalClock(settings, 'white', 1, null, 0)
    const saved = c.save(10000) // 7 s of main time used
    const r = new LocalClock(settings, 'white', 1, saved, 500000)
    expect(r.view(500000).white).toBe(593000)
  })

  test('formatClock', () => {
    expect(formatClock(600000)).toBe('10:00')
    expect(formatClock(65001)).toBe('1:06')
    expect(formatClock(-5)).toBe('0:00')
    expect(formatClock(3600000 + 61000)).toBe('1:01:01')
  })
})

describe('result strings (the original\'s wording)', () => {
  test('lines', () => {
    expect(gameEndedLine({ kind: 'checkmate', winner: 'black' })).toBe('Game ended - Black wins')
    expect(gameEndedLine({ kind: 'stalemate' })).toBe('Game ended - Draw')
    expect(youLine({ kind: 'timeout', winner: 'white' }, 'white')).toBe('You win!')
    expect(youLine({ kind: 'resignation', winner: 'white' }, 'black')).toBe('You lose')
    expect(resultText({ kind: 'timeout', winner: 'white' })).toEqual({ title: 'Black lost on time', detail: 'White wins' })
    expect(resultText({ kind: 'resignation', winner: 'black' }).title).toBe('White resigned')
  })
})
