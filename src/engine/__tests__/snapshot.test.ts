import { describe, expect, it } from 'vitest'
import { Game, createGame } from '../game'
import { VARIANTS, findVariant } from '../variants'
import { T, pos, rows } from './helpers'

describe('snapshot', () => {
  it('returns fresh top-level objects but reuses Board instances of unchanged boards', () => {
    const g = createGame('standard', { skipMateDetection: true })
    const s1 = g.snapshot()
    g.makeMoveNotation('e4')
    const s2 = g.snapshot()
    expect(s2).not.toBe(s1)
    expect(s2.timelines).not.toBe(s1.timelines)
    expect(s2.timelines[0]).not.toBe(s1.timelines[0])
    expect(s2.timelines[0].boards[0]).toBe(s1.timelines[0].boards[0])
    expect(s2.timelines[0].boards).toHaveLength(2)
    g.submit()
    g.makeMoveNotation('e5')
    const s3 = g.snapshot()
    expect(s3.timelines[0].boards[1]).toBe(s2.timelines[0].boards[1])
    g.undoMove()
    expect(g.snapshot().timelines[0].boards[1]).toBe(s2.timelines[0].boards[1])
  })

  it('boards are immutable', () => {
    const g = createGame('standard', { skipMateDetection: true })
    const b = g.snapshot().timelines[0].boards[0]
    expect(Object.isFrozen(b)).toBe(true)
    expect(Object.isFrozen(b.squares)).toBe(true)
    expect(Object.isFrozen(b.squares[0])).toBe(true)
  })

  it('describes the starting position', () => {
    const s = createGame('standard').snapshot()
    expect(s).toMatchObject({ width: 8, height: 8, present: T(1), player: 'white', timelinesCreated: { white: 0, black: 0 }, canCreateActiveTimeline: { white: true, black: true } })
    expect(s.timelines).toHaveLength(1)
    expect(s.timelines[0]).toMatchObject({ l: 0, label: '0', startT: T(1), branchedFrom: null, createdBy: null, active: true })
    const b = s.timelines[0].boards[0]
    expect(b).toMatchObject({ l: 0, t: T(1), width: 8, height: 8 })
    expect(b.squares[4]).toEqual({ type: 'K', color: 'white', moved: false })
    expect(b.squares[7 * 8 + 3]).toEqual({ type: 'Q', color: 'black', moved: false })
  })

  it('clone is independent and shares nothing mutable', () => {
    const g = createGame('standard', { skipMateDetection: true })
    g.makeMoveNotation('e4')
    const c = g.clone() as Game
    c.submit()
    expect(g.player).toBe('white')
    expect(g.pendingMoves).toHaveLength(1)
    expect(c.player).toBe('black')
    expect(c.history).toHaveLength(1)
    expect(g.history).toHaveLength(0)
  })

  it('move records support last-move highlights', () => {
    const g = createGame('standard', { skipMateDetection: true })
    g.makeMoveNotation('e4')
    g.submit()
    const [r] = g.actionRecords()[0]
    expect(r).toMatchObject({ kind: 'spatial', player: 'white', notation: '(0T1)e4', fromBoard: { l: 0, t: T(1, 'b') } })
    expect(r.move).toEqual({ from: pos(0, T(1), 'e2'), to: pos(0, T(1), 'e4') })
  })
})

describe('variants', () => {
  it('lists every variant of the original game with a valid setup', () => {
    expect(VARIANTS.length).toBe(45)
    expect(new Set(VARIANTS.map((v) => v.id)).size).toBe(45)
    expect(new Set(VARIANTS.map((v) => v.name)).size).toBe(45)
    for (const v of VARIANTS) {
      const g = createGame(v.id)
      expect(g.fen().length, v.id).toBe(v.fen.length)
      if (v.id !== 'misc_global_warming') expect(g.movablePieces().length, v.id).toBeGreaterThan(0)
      expect(g.player, v.id).toBe('white')
    }
    expect(VARIANTS.map((v) => v.category).filter((c, i, a) => a.indexOf(c) === i)).toEqual(['Standard', 'Very Small', 'Small', 'Simple', 'Focused', 'Misc', 'Checkmate Practice'])
  })

  it('finds variants by id, display name, alias and the reference engine names', () => {
    expect(findVariant('Standard - Turn Zero')?.id).toBe('turn_zero')
    expect(findVariant('turn_zero')?.id).toBe('turn_zero')
    expect(findVariant('Misc - Small Open')?.id).toBe('small_open')
    expect(findVariant('Princess')?.id).toBe('princess')
    expect(findVariant('nope')).toBeUndefined()
  })

  it('Global Warming: an empty 1x1 board is a stalemate', () => {
    const g = createGame('misc_global_warming')
    expect(g.result()).toEqual({ kind: 'stalemate' })
    expect(g.movablePieces()).toEqual([])
    expect(g.hasLegalAction()).toBe(false)
    expect(g.isInCheck()).toBe(false)
  })

  it('Timeline Fragments starts staggered: white moves on +0 first', () => {
    const g = createGame('misc_timeline_fragments')
    expect(g.requiredBoards()).toEqual([{ l: 0.5, t: T(1) }])
    expect(g.snapshot().timelines.map((t) => t.startT)).toEqual([T(1, 'b'), T(1)])
  })

  it('initial boards match the variant definition', () => {
    for (const v of VARIANTS) {
      const fens = Game.fromVariant(v).fen()
      // Normalise: our writer only stars kings/rooks/pawns/brawns.
      const norm = (f: string): string => f.replace(/\*/g, '').replace(':+1:', ':1:')
      expect(fens.map(norm)).toEqual(v.fen.map(norm).sort((a, b) => order(a) - order(b)))
    }
  })

  it('custom positions from 5DFEN', () => {
    const g = Game.fromFen([`[${rows(4, 4, { a1: 'K*', d4: 'k*' })}:0:1:w]`], 4, 4)
    expect(g.variant.id).toBe('custom')
    expect(g.movablePieces()).toEqual([pos(0, T(1), 'a1')])
  })
})

/** Sort key of a 5DFEN board string by (timeline, turn). */
function order(fen: string): number {
  const m = /:([+-]?\d+):(\d+):([wb])\]$/.exec(fen)!
  const l = m[1] === '-0' ? -0.5 : m[1] === '+0' ? 0.5 : Number(m[1])
  return l * 10000 + Number(m[2]) * 2 + (m[3] === 'b' ? 1 : 0)
}
