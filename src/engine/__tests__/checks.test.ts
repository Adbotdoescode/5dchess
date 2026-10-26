import { describe, expect, it } from 'vitest'
import { Game, createGame } from '../game'
import { T, fenGame, rows } from './helpers'

// Game records ported (as data) from the reference engine's test-suite.
const CHECK_NOT_MATE = [
  '1. d4 / c5 2. Bf4 / Nc6 3. Nc3 / cxd4 4. Nd5 / Qa5 5. Bd2 / Qxd5 6. Nf3 / e6 7. g3 / Bb4 8. c3 / dxc3 9. bxc3 / Qc5 10. cxb4 / (0T10)Qc5>>x(0T7)f2 11. (-1T8)Kxf2 / (-1T8)d3 12. (-1T9)e3 / (-1T9)Ne5 13. (0T11)Bd2>>x(0T8)d5 / (1T8)Nge7 14. (1T9)Bxb4 / (1T9)Nxb4 15. (-1T10)Bg2 (1T10)Ne5 / (-1T10)Qd5>x(1T10)d5 16. (-1T11)Nxe5 (1T11)Nxf7 / (-1T11)Nf6 (0T11)Nf6 (1T11)Nxc2 17. (-1T12)Ne5>(0T12)c5 (1T12)Qxc2 / (1T12)Qb5 (0T12)Ng4 (-1T12)Ng4 18. (0T13)Nc5>(1T13)c7 (-1T13)Qxg4 / (0T13)Bc8>x(1T13)c7 (-1T13)Bc5 19. (-1T14)Qxe6 (0T14)Qxd7 (1T14)Qxc7',
  '1. d4 / c5 2. Bf4 / Nc6 3. Nc3 / cxd4 4. Nd5 / Qa5 5. Bd2 / Qxd5 6. Nf3 / e6 7. g3 / Bb4 8. c3 / dxc3 9. bxc3 / Qc5 10. cxb4 / (0T10)Qc5>>x(0T7)f2 11. (-1T8)Kxf2 / (-1T8)d3 12. (-1T9)e3 / (-1T9)Ne5 13. (0T11)Bd2>>x(0T8)d5 / (1T8)Nge7 14. (1T9)Bxb4 / (1T9)Nxb4 15. (-1T10)Bg2 (1T10)Ne5 / (-1T10)Qd5>x(1T10)d5 16. (-1T11)Nxe5 (1T11)Nxf7 / (-1T11)Nf6 (0T11)Nf6 (1T11)Nxc2 17. (-1T12)Ne5>(0T12)c5 (1T12)Qxc2 / (1T12)Qb5 (0T12)Ng4 (-1T12)Ng4 18. (0T13)Nc5>(1T13)c7 (-1T13)Qxg4 / (0T13)Bc8>x(1T13)c7 (-1T13)Bc5 19. (-1T14)Qxe6 (0T14)Qxd7 (1T14)Qxc7 / (1T14)Qb5>>x(1T11)b2 20. (1T15)Qc7>(-2T12)f4 / (-2T12)Qc3 21. (-2T13)Qfd2 / (-2T13)Nxc2 22. (-2T14)Q1xc2 / (-2T14)Qd5>x(0T14)d7 (-1T14)fxe6 23. (-1T15)Bd2>(0T15)d3 (-2T15)Qcxc3 / (-2T15)O-O (-1T15)O-O (0T15)Qd6 (1T15)O-O 24. (1T16)Nf7>x(-1T16)f8 (0T16)a3 (-2T16)Qcxd4 / (1T16)Rf8>x(-1T16)f8 (0T16)Nxb4 (-2T16)Rxf7 25. (-2T17)Qd4>x(0T17)d6 (-1T17)Bf3 (1T17)Bh3 / (-2T17)Rf7>(-1T17)f7 (0T17)Nxd3 (1T17)Nd5 26. (-2T18)Qg5 (-1T18)cxd3 (0T18)exd3 (1T18)Bxe6 / (1T18)dxe6 (0T18)Ne3 (-1T18)Rxf3 (-2T18)Nc6 27. (0T19)fxe3 (-2T19)Qg5>>(0T19)e7 (1T19)O-O (-1T19)Ke1 / (1T19)Bc8>>(1T14)c3 28. (-3T15)bxc3 / (-3T15)O-O 29. (-3T16)Nh6 / (-3T16)gxh6 30. (-3T17)e3 / (-3T17)Qf5 31. (-3T18)Qf4 / (-3T18)Qxf4 32. (-3T19)gxf4',
  '1. e3 / h5 2. a4 / h4 3. c3 / h3 4. Nf3 / hxg2 5. Bxg2 / Rxh2 6. Nxh2 / g5 7. (0T7)Bg2>>(0T6)g1 / (1T6)Rxh1 8. (1T7)Bxh1 / (1T7)g5 (0T7)g4 9. (1T8)Nxg5 (0T8)Qc2 / (1T8)f5 (0T8)g3 10. (0T9)Qh7 (1T9)Qh5 / (0T9)Pf7>(1T9)f7 11. (1T10)Qh5>>(1T9)g6 (0T10)fxg3 / (1T10)f4 (0T10)e5 12. (0T11)Qg6 (1T11)Bd5 / (1T11)Ng8>x(0T11)g6 13. (1T12)Bxf7 (0T12)a5 / (0T12)Bf8>>x(0T6)f2 14. (-1T7)Kxf2 / (-1T7)g5 15. (-1T8)Bxb7 / (-1T8)Ng8>>(-1T7)g6 16. (-2T8)Bxb7 / (-2T8)Nf4 17. (-1T9)Bb7>>x(-1T8)c7 / (3T8)Qxc7 18. (-2T9)exf4 (3T9)Bxb7 / (-1T9)Nb8>>(-1T8)b6 19. (-3T9)Kf3 / (-3T9)Nb6>>(-1T8)b6 20. (-4T9)Qd1>>(0T9)h5',
]

describe('check, checkmate and stalemate', () => {
  it('simple 3-action checkmate: the queen attacks the king on a past board', () => {
    const g = createGame('standard')
    for (const m of ['e3', 'f6', 'Qe2', 'Nc6']) {
      g.makeMoveNotation(m)
      g.submit()
      expect(g.isInCheck()).toBe(false)
      expect(g.result().kind).toBe('ongoing')
    }
    g.makeMoveNotation('Qh5')
    g.submit()
    expect(g.isInCheck()).toBe(true)
    expect(g.result()).toEqual({ kind: 'checkmate', winner: 'white' })
    // The red arrows include the attack through time onto (0T1) e8 (T1 white board).
    expect(g.checks()).toContainEqual({ from: { l: 0, t: T(3, 'b'), x: 7, y: 4 }, to: { l: 0, t: T(1), x: 4, y: 7 } })
    expect(g.toPgn()).toContain('(0T3)Qh5#')
    expect(g.hasLegalAction()).toBe(false)
    expect(g.movablePieces()).toEqual([])
  })

  it('3-action check that is not mate', () => {
    const g = Game.fromPgn('1. a3 / a6 2. e3 / f5 3. Qe2 / Nf6 4. Qh5')
    expect(g.isInCheck()).toBe(true)
    expect(g.result().kind).toBe('ongoing')
    expect(g.toPgn()).toContain('(0T4)Qh5+')
  })

  it.each(CHECK_NOT_MATE.map((p, i) => [i, p]))('multiverse check but not mate #%i', (i, pgn) => {
    // Record #1 contains (-1T15)O-O, castling through f8 which the white knight on f7
    // of timeline +1 attacks (with +1 passed). That is illegal under our multiverse-wide
    // castling rule, so it is replayed with the reference engine's board-local rule.
    const g = Game.fromPgn(pgn as string, { castlingRule: i === 1 ? 'board' : 'multiverse' })
    expect(g.isInCheck()).toBe(true)
    expect(g.result().kind).toBe('ongoing')
    expect(g.history.length).toBe((pgn as string).split('/').length + (pgn as string).split('/').length - 1)
    const escape = g.findLegalAction()!
    for (const m of escape) g.makeMove(m)
    expect(g.canSubmit()).toBe(true)
  })

  it('reversed royalty: the royal queen can be checkmated', () => {
    const g = Game.fromPgn(`
[Board "Standard - Reversed Royalty"]
[Size "8x8"]

1. d4 / Nf6
2. Bf4 / d5
3. Bxc7 / RQxc7
4. Nc3 / Bd7
5. (0T5)Nc3>>(0T4)c5* / (0T5)Yc7>>(0T2)c4
6. (-1T3)e3 / (-1T3)Ya4
7. (-1T4)Nc3#`)
    expect(g.isInCheck()).toBe(true)
    expect(g.result()).toEqual({ kind: 'checkmate', winner: 'white' })
  })

  it('Rook Tactics I: a rook mates a king sitting on a past board', () => {
    const g = Game.fromPgn(`[Size "5x5"]
[Puzzle "mate-in-1"]
[Board "custom"]
[4k/5/5/5/K1R2:0:1:w]

1. Kb2 / Ke4
2. Re1 / Kd3
3. Re5`)
    expect(g.result()).toEqual({ kind: 'checkmate', winner: 'white' })
    // The rook on e5 can travel three turns back and capture the king on e5 of (0T1).
    expect(g.checks()).toContainEqual({ from: { l: 0, t: T(3, 'b'), x: 4, y: 4 }, to: { l: 0, t: T(1), x: 4, y: 4 } })
  })

  it('stalemate: no legal action and not in check', () => {
    const g = fenGame([`[${rows(8, 8, { a8: 'k', c7: 'Q', b6: 'K' })}:0:1:b]`], 8, 8)
    expect(g.player).toBe('black')
    expect(g.isInCheck()).toBe(false)
    expect(g.hasLegalAction()).toBe(false)
    // Detected after a submit:
    const g2 = fenGame([`[${rows(8, 8, { a8: 'k', c7: 'Q', b5: 'K' })}:0:1:w]`], 8, 8)
    g2.options.skipMateDetection = false
    g2.makeMoveNotation('Kb6')
    g2.submit()
    expect(g2.result()).toEqual({ kind: 'stalemate' })
  })

  it('moves into check are allowed tentatively; submit is blocked', () => {
    const g = createGame('standard', { skipMateDetection: true })
    for (const m of ['e3', 'e6', 'Qh5']) {
      g.makeMoveNotation(m)
      g.submit()
    }
    g.makeMoveNotation('f6') // opens h5-e8 for the queen
    expect(g.canSubmit()).toBe(false)
    expect(g.submitBlocker()).toBe('in-check')
    expect(g.checks().length).toBeGreaterThan(0)
    g.undoMove()
    g.makeMoveNotation('Nf6')
    expect(g.submitBlocker()).toBe(null)
  })

  it('checks consider unmoved present boards as passed', () => {
    // Two Timelines: a white queen on -0 can capture the black king on +0 once black passes there.
    const g = createGame('two_timelines', { skipMateDetection: true })
    for (const m of ['(-0T1)e3 (+0T1)e3', '(-0T1)e6 (+0T1)e6', '(-0T2)Qh5 (+0T2)a3']) {
      for (const x of m.split(' ')) g.makeMoveNotation(x)
      g.submit()
    }
    g.makeMoveNotation('(-0T2)f6')
    // +0 not moved yet: the queen's attack onto -0's king is reported, and the board must be moved anyway.
    expect(g.isInCheck()).toBe(true)
    expect(g.submitBlocker()).toBe('must-move-present')
  })
})
