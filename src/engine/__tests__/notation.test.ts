import { describe, expect, it } from 'vitest'
import { Game, createGame } from '../game'
import { parsePgn } from '../notation'
import { VARIANTS } from '../variants'

// Two games played in the original game, transcribed in the 5D PGN specification
// (adri326/5dchess-notation). Used as test data. One transcription error is fixed:
// move 15 reads "(1T13)Ba4+" in the source, but a bishop on a3 cannot reach a4; the
// bishop captures on b4 (giving check to d6) and continues 16. (1T14)Bxc5+. Likewise
// "16. ... (0T14)Bg2" is impossible for the bishop on f7; it went to g6, from where
// it plays 17. ... (0T15)Bd3+.
const GAME_NO_QUEENS = `[White "Teln0"]
[Black "Shad Amethyst"]
[Board "Simple - No Queens"]
[Size "7x7"]
[Date "2020.08.14"]
[Result "1-0"]
[Mode "5D"]

1. (0T1)Nd3 / (0T1)Nc5
2. (0T2)Nxc5+ / (0T2)bxc5
3. (0T3)g3 / (0T3)g4
4. (0T4)Bg2 / (0T4)d5
5. (0T5)O-O {to the right} / (0T5)Be5
6. (0T6)Nb1>>(0T5)b3 / (1T5)Bb6
7. (1T6)Nc3 / (0T6)Ne7>(1T6)e5
8. (0T7)a4 (1T7)O-O {to the right} / (0T7)Be5>>(0T6)e4
9. (-1T7)Bxe4 / (-1T7)dxe4 (1T7)c4
10. (1T8)Nb3>(0T8)d3 (-1T8)a4 / (-1T8)Bd4 (0T8)Kd7>(1T8)d6
11. (-1T9)Ra3 (0T9)Ra3 (1T9)b3 / (-1T9)Bd4>x(0T9)d3 (1T9)cxb3
12. (-1T10)d3 (0T10)cxd3 (1T10)Ba3 / (-1T10)Nd5 (0T10)Rb7 (1T10)c5?
13. (-1T11)dxe4 (0T11)Rc3 (1T11)axb3 / (0T11)Rg5 (1T11)Ne5>x(-1T11)e4
14. (-1T12)Rd3 (0T12)d4 (1T12)b4 / (-1T12)c4 (0T12)c4 (1T12)cxb4
15. (-1T13)Rd4 (0T13)d3 (1T13)Bxb4+ / (-1T13)O-O-O {to the left} (0T13)cxd3 (1T13)Bc5
16. (-1T14)Rxe4 (0T14)exd3 (1T14)Bxc5+ / (0T14)Bg6 (-1T14)Nd5>x(1T14)c5
17. (-1T15)Rc4 (0T15)Rc6 (1T15)Ra5 / (-1T15)e5 (0T15)Bd3+ (1T15)Ne4
18. (-1T16)Rb4+ (0T16)Kg1 (1T16)Nxe4 / (-1T16)Kb7>x(0T16)c6 (1T16)dxe4
19. (-1T17)Rb4>(1T17)b4 (0T17)Bxg5 / (-1T17)Bc4 (0T17)Bc4 (1T17)Nd5
20. (-1T18)Be3 (0T18)Rc1 (1T18)Rd4 / (-1T18)Rd7 (0T18)Kc6>(1T18)b6?
21. (-1T19)Bb6+ {checks (1T19)d6} (0T19)Rb1 (1T19)Raxd5+ / (-1T19)c6>(0T19)c6 {blocks (-1T20)Bb6>>x(1T20)d6 1-0} (1T19)exd5
22. (-1T20)Bb6>x(0T20)b7+ {checks (1T20)d7} (1T20)Rxd5+ / (-1T20)Bc4>>x(-1T18)a4
23. (-2T19)Bb6 / (-2T19)Rb7
24. (-2T20)Bb6>>x(-1T20)a6+ {checks (1T20)b6, (2T20)b6 also checks (1T19)b6} 1-0 {Black forfeits}
`

const GAME_HALF_REFLECTED = `[Mode "5D"]
[Board "Standard - Half Reflected"]
[Size "8x8"]
[White "Shad Amethyst"]
[Black "PseudoAbstractMeta"]
[Date "2021.01.22"]
[Result "1-0"]

1. f4 / e5
2. f5 / f6
3. g3 / Bd6
4. b3? {This turned out later to be a weak move} / Qh5
5. Bh3 / Qg5
6. Nf3 / (0T6)Qg5>>x(0T4)g3+~
7. (-1T5)hxg3 / (-1T5)e4
8. (-1T6)e3 / (-1T6)g6?
9. (0T7)Bh3>>x(0T5)h5~ / (1T5)Nc6
10. (1T6)Be8+ / (1T6)Kxe8 {Forced}
11. (-1T7)Ne2 (1T7)e3 / (-1T7)gxf5 (0T7)Ne7 (1T7)h5 {Forced}
12. (0T8)Nf3>x(-1T8)f5 (1T8)Nh3 / (-1T8)Qg6 (0T8)Bd6>(1T8)d5
13. (1T9)Nh3>>x(1T8)h5~ / (2T8)Kd8!
14. (0T9)Rf1 (-1T9)Nxd6 (2T9)Qg4 / (-1T9)cxd6 (0T9)Ng8! {Protects (L+2)g7} (1T9)Nd4? (2T9)b6
15. (-1T10)Ba3 (0T10)Ba3 {Threatening mate on f8} (1T10)exd4 (2T10)Ne2 {Protecting (L+1)e4} / (-1T10)f5! (0T10)d6! (1T10)b6 (2T10)Nge7
16. (-1T11)Rg1 (0T11)Qd1>(2T11)f3 (1T11)Nc3 / (-1T11)Nc6 (0T11)Nc6 (1T11)Bxh1? (2T11)Bb7
17. (-1T12)Nf4 {Threatening the queen} (0T12)Nc3 (2T12)Rh1>x(1T12)h1 / (-1T12)Qg6>>x(-1T9)d6~ (>L-2)
18. (-2T10)Rg1 / (-2T10)h5
19. (-2T11)Nf4 / (-2T11)Qg5
20. (-2T12)Qe2 / (-2T12)h4 (0T12)Nd4 (1T12)Ne7 (2T12)Kc8 {Time trouble for black}
21. (2T13)Qg4>>x(2T10)g7~! (>L+3) / (3T10)Bd6>>x(1T10)d4~ (>L-3)
22. (3T11)Qg7g6*! (-3T11)Qh5+ / (-3T11)Rxh5 (2T13)Bd6>>x(2T9)d2~ {One of the two legal moves, black is losing} (>L-4)
23. (-4T10)Bxd2 / 1-0 {White wins by timeout; possible continuation would have been (-4T10)d4; 24. (-4T10)Qxd4#}
`

describe('5D PGN', () => {
  it('replays a real game from the original (Simple - No Queens)', () => {
    const g = Game.fromPgn(GAME_NO_QUEENS)
    expect(g.variant.name).toBe('Simple - No Queens')
    expect(g.history.length).toBe(47)
    expect(g.snapshot().timelines.map((t) => t.label)).toEqual(['-2', '-1', '0', '+1', '+2'])
  })

  it('replays a real game from the original (Standard - Half Reflected)', () => {
    const g = Game.fromPgn(GAME_HALF_REFLECTED)
    expect(g.history.length).toBe(45)
    expect(g.snapshot().timelines.map((t) => t.label)).toEqual(['-4', '-3', '-2', '-1', '0', '+1', '+2', '+3'])
    expect(g.player).toBe('black')
    expect(g.result().kind).toBe('ongoing')
  })

  it('exports and re-imports a game identically', () => {
    for (const pgn of [GAME_NO_QUEENS, GAME_HALF_REFLECTED]) {
      const g = Game.fromPgn(pgn, { skipMateDetection: true })
      const again = Game.fromPgn(g.toPgn(), { skipMateDetection: true })
      expect(again.fen()).toEqual(g.fen())
      expect(again.toPgn()).toEqual(g.toPgn())
    }
  })

  it('writes moves in 5D PGN', () => {
    const g = createGame('standard', { skipMateDetection: true })
    const n: string[] = []
    for (const m of ['e3', 'f6', 'Nc3', 'Nc6', 'Nb5', 'a6', '(0T4)Nb5>>(0T3)b3']) {
      const mv = g.parseMove(m)
      n.push(g.moveToNotation(mv))
      g.makeMove(mv)
      if (g.canSubmit()) g.submit()
    }
    expect(n).toEqual(['(0T1)e3', '(0T1)f6', '(0T2)Nc3', '(0T2)Nc6', '(0T3)Nb5', '(0T3)a6', '(0T4)Nb5>>(0T3)b3~'])
    expect(g.toPgn()).toBe(`[Mode "5D"]
[Board "Standard"]

1. (0T1)e3 / (0T1)f6
2. (0T2)Nc3 / (0T2)Nc6
3. (0T3)Nb5 / (0T3)a6
4. (0T4)Nb5>>(0T3)b3~
`)
  })

  it('handles even-timeline and turn-zero coordinates', () => {
    const g = Game.fromPgn('[Board "Standard - Two Timelines"]\n[Mode "5D"]\n1. (+0T1)h4 (-0T1)Nb1>>(+0T1)b3~ / (-0T1)a6 (1T1)Ng8>(+0T1)g6', { skipMateDetection: true })
    expect(g.snapshot().timelines.map((t) => [t.label, t.l])).toEqual([['-0', -0.5], ['+0', 0.5], ['+1', 1.5]])
    expect(g.actionRecords()[1].map((r) => r.notation)).toEqual(['(-0T1)a6', '(1T1)Ng8>(+0T1)g6'])
    const z = Game.fromPgn('[Board "Standard - Turn Zero"]\n1. e3 / f6 2. Qe2 / (0T2)Nb8>>(0T1)b6 (~T1) (>L-1) 3. (-1T2)Nf3 / (-1T2)Na6 4. (-1T3)Nd4', { skipMateDetection: true })
    expect(z.snapshot().timelines.map((t) => [t.label, t.startT])).toEqual([['-1', 4], ['0', 1]])
  })

  it('parses headers, custom 5DFEN boards, comments, turn markers and results', () => {
    const p = parsePgn(`[Board "custom"]\n[Size "5x5"]\n[4k/5/5/5/K1R2:0:1:w]\n{comment} 1. Kb2 / Ke4 2w. Re1 2b. Kd3 1-0`)
    expect(p.headers).toEqual({ Board: 'custom', Size: '5x5' })
    expect(p.fen).toEqual(['[4k/5/5/5/K1R2:0:1:w]'])
    expect(p.actions).toEqual([
      { color: 'white', moves: ['Kb2'] }, { color: 'black', moves: ['Ke4'] },
      { color: 'white', moves: ['Re1'] }, { color: 'black', moves: ['Kd3'] },
    ])
    expect(p.result).toBe('1-0')
  })

  it('custom games export their 5DFEN boards', () => {
    const g = Game.fromPgn('[Board "custom"]\n[Size "5x5"]\n[4k/5/5/5/K1R2:0:1:w]\n1. Kb2', { skipMateDetection: true })
    const pgn = g.toPgn()
    expect(pgn).toContain('[4k/5/5/5/K1R2:0:1:w]')
    expect(pgn).toContain('[Size "5x5"]')
    expect(Game.fromPgn(pgn).fen()).toEqual(g.fen())
  })

  it('every variant exports a PGN that re-imports', () => {
    for (const v of VARIANTS) {
      const g = createGame(v.id, { skipMateDetection: true })
      const p = g.toPgn()
      expect(Game.fromPgn(p).variant.id).toBe(v.id)
    }
  })

  it('rejects illegal or ambiguous notation', () => {
    const g = createGame('standard', { skipMateDetection: true })
    expect(() => g.makeMoveNotation('e5')).toThrow()
    expect(() => g.makeMoveNotation('(0T1)Nb1>>(0T0)b3')).toThrow()
    expect(g.pendingMoves.length).toBe(0)
  })
})
