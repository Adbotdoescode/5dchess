import { describe, expect, it } from 'vitest'
import { DIRECTION_COUNTS, Multiverse, visitMoves } from '../core'
import { multiverseFromFen } from '../fen'
import { createGame } from '../game'
import { T, allMoves, fenGame, notations, pos, rows } from './helpers'

/** Multiverse with timelines -2..2, every board from T1 white to T5 black, one piece at (0, T3 white, d4). */
function openMultiverse(piece: string): Multiverse {
  const boards: string[] = []
  for (let l = -2; l <= 2; l++)
    for (let turn = 1; turn <= 5; turn++)
      for (const c of ['w', 'b']) {
        const r = l === 0 && turn === 3 && c === 'w' ? rows(8, 8, { d4: piece }) : rows(8, 8)
        boards.push(`[${r}:${l}:${turn}:${c}]`)
      }
  return multiverseFromFen(boards, 8, 8)
}

function destinations(mv: Multiverse): { dirs: Set<string>; targets: number } {
  const dirs = new Set<string>()
  let targets = 0
  visitMoves(mv, 0, T(3), 3, 3, false, (tl, tt, tx, ty) => {
    targets++
    const v = [tl - 0, (tt - T(3)) / 2, ty - 3, tx - 3]
    const g = v.reduce((a, b) => gcd(a, Math.abs(b)), 0)
    dirs.add(v.map((c) => c / g).join(','))
    return false
  })
  return { dirs, targets }
}
const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))

describe('4D movement invariants (open multiverse, nothing blocking)', () => {
  it('direction tables have the expected sizes', () => {
    expect(DIRECTION_COUNTS).toEqual({ rook: 8, bishop: 24, unicorn: 32, dragon: 16, queen: 80, princess: 32, king: 80, knight: 48 })
  })
  it.each([
    ['R', 8], ['B', 24], ['Q', 80], ['U', 32], ['D', 16], ['S', 32], ['Y', 80],
  ])('%s moves in %i directions', (p, n) => {
    expect(destinations(openMultiverse(p)).dirs.size).toBe(n)
  })
  it('king and common king have 80 one-step targets, knight 48 targets', () => {
    expect(destinations(openMultiverse('K')).targets).toBe(80)
    expect(destinations(openMultiverse('C')).targets).toBe(80)
    expect(destinations(openMultiverse('N')).targets).toBe(48)
  })
  it('from a playable (end) board a queen cannot go forward in time on its own timeline', () => {
    // All timelines end at the same board, so directions with dT = +1 do not exist: 80 - 27 = 53.
    const boards: string[] = []
    for (let l = -2; l <= 2; l++)
      for (let turn = 1; turn <= 3; turn++)
        for (const c of ['w', 'b']) {
          if (turn === 3 && c === 'b') continue
          boards.push(`[${l === 0 && turn === 3 ? rows(8, 8, { d4: 'Q' }) : rows(8, 8)}:${l}:${turn}:${c}]`)
        }
    const g = fenGame(boards, 8, 8)
    const dirs = new Set(g.movesFrom(pos(0, T(3), 'd4')).map((m) => {
      const v = [m.to.l - m.from.l, (m.to.t - m.from.t) / 2, m.to.y - m.from.y, m.to.x - m.from.x]
      const d = v.reduce((a, b) => gcd(a, Math.abs(b)), 0)
      return v.map((c) => c / d).join(',')
    }))
    expect(dirs.size).toBe(53)
  })
})

// Scenarios ported (as data) from the reference engine's test-suite.
const PAWN_SETUP_WHITE = `[5/5/5/5/5:-2:1:w] [5/5/5/5/5:-2:1:b] [5/5/5/5/5:-2:2:w] [5/5/5/5/5:-2:2:b] [5/5/5/5/5:-2:3:w]
[5/5/2q2/5/5:-1:1:w] [5/5/5/5/5:-1:1:b] [5/5/5/5/5:-1:2:w] [5/5/5/5/5:-1:2:b] [5/5/2q2/5/5:-1:3:w]
[5/5/5/5/5:0:1:w] [5/5/5/5/5:0:1:b] [5/1q1q1/2P*2/5/5:0:2:w]
[5/5/5/5/5:1:1:w] [5/5/5/5/5:1:1:b] [5/5/5/5/5:1:2:w] [5/5/5/5/5:1:2:b] [5/5/5/5/5:1:3:w]
[5/5/5/5/5:2:1:w] [5/5/5/5/5:2:1:b] [5/5/5/5/5:2:2:w] [5/5/5/5/5:2:2:b] [5/5/5/5/5:2:3:w]`

describe('pawns', () => {
  it('white pawn: pushes, captures, timeline moves and timeline captures', () => {
    const g = fenGame(PAWN_SETUP_WHITE.split(/\s+/), 5, 5)
    const n = notations(g)
    expect(n.sort()).toEqual([
      '(0T2)Pc3>>(-1T2)c3', // one timeline forward (towards black's timelines)
      '(0T2)Pc3>>(-2T2)c3', // two timelines forward (unmoved)
      '(0T2)Pc3>>x(-1T1)c3', // diagonal through timelines: forward + one turn back
      '(0T2)Pc3>x(-1T3)c3', //  ... and one turn forward (non-branching, that board is playable)
      '(0T2)c4',
      '(0T2)c5=Q', // double step onto the last rank of a 5x5 board promotes
      '(0T2)cxb4',
      '(0T2)cxd4',
    ].sort())
  })

  it('black pawn mirrors the white pawn (forward = towards white timelines)', () => {
    const boards = `[5/5/5/5/5:-2:1:w] [5/5/5/5/5:-2:1:b] [5/5/5/5/5:-2:2:w] [5/5/5/5/5:-2:2:b] [5/5/5/5/5:-2:3:w] [5/5/5/5/5:-2:3:b]
[5/5/5/5/5:-1:1:w] [5/5/5/5/5:-1:1:b] [5/5/5/5/5:-1:2:w] [5/5/5/5/5:-1:2:b] [5/5/5/5/5:-1:3:w] [5/5/5/5/5:-1:3:b]
[5/5/5/5/5:0:1:w] [5/5/5/5/5:0:1:b] [5/5/5/5/5:0:2:w] [5/5/2p*2/1Q1Q1/5:0:2:b]
[5/5/5/5/5:1:1:w] [5/5/2Q2/5/5:1:1:b] [5/5/5/5/5:1:2:w] [5/5/5/5/5:1:2:b] [5/5/5/5/5:1:3:w] [5/5/2Q2/5/5:1:3:b]
[5/5/5/5/5:2:1:w] [5/5/5/5/5:2:1:b] [5/5/5/5/5:2:2:w] [5/5/5/5/5:2:2:b] [5/5/5/5/5:2:3:w] [5/5/5/5/5:2:3:b]`
    const g = fenGame(boards.split(/\s+/), 5, 5)
    expect(g.player).toBe('black')
    expect(notations(g).sort()).toEqual([
      '(0T2)Pc3>>(1T2)c3', '(0T2)Pc3>>(2T2)c3', '(0T2)Pc3>>x(1T1)c3', '(0T2)Pc3>x(1T3)c3',
      '(0T2)c1=Q', '(0T2)c2', '(0T2)cxb2', '(0T2)cxd2',
    ].sort())
  })

  it('the original game only promotes to a queen, also in the Princess variant', () => {
    const g = createGame('princess', { skipMateDetection: true })
    for (const m of ['(0T1)a3', '(0T1)b5', '(0T2)a4', '(0T2)h6', '(0T3)axb5', '(0T3)g6', '(0T4)b6', '(0T4)f6', '(0T5)b7', '(0T5)e6']) {
      g.makeMoveNotation(m)
      g.submit()
    }
    const promos = allMoves(g).filter((m) => m.move.promotion)
    expect(promos.map((m) => m.notation).sort()).toEqual(['(0T6)bxa8=Q', '(0T6)bxc8=Q'])
    expect(() => g.makeMove({ ...promos[0].move, promotion: 'S' })).toThrow()
    g.makeMoveNotation('(0T6)bxc8=Q')
    expect(g.snapshot().timelines[0].boards.at(-1)!.squares[7 * 8 + 2]).toMatchObject({ type: 'Q', color: 'white' })
  })

  it('en passant (spatial only)', () => {
    const g = createGame('standard', { skipMateDetection: true })
    for (const m of ['e4', 'a6', 'e5', 'd5']) {
      g.makeMoveNotation(m)
      g.submit()
    }
    const ep = g.movesFrom(pos(0, T(3), 'e5')).find((m) => m.enPassant)
    expect(ep?.to).toEqual(pos(0, T(3), 'd6'))
    g.makeMove(ep!)
    const b = g.snapshot().timelines[0].boards.at(-1)!
    expect(b.squares[4 * 8 + 3]).toBeNull() // the d5 pawn was captured
    expect(b.squares[5 * 8 + 3]).toMatchObject({ type: 'P', color: 'white' })
  })

  it('black en passant after a white double step', () => {
    const g = createGame('standard', { skipMateDetection: true })
    for (const m of ['e4', 'a6', 'e5', 'd5', 'e6', 'd4', 'c4']) {
      g.makeMoveNotation(m)
      if (g.canSubmit()) g.submit()
    }
    expect(notations(g)).toContain('(0T4)dxc3')
  })

  it('unmoved pawns double-step, moved pawns do not', () => {
    const g = createGame('standard', { skipMateDetection: true })
    expect(g.movesFrom(pos(0, T(1), 'e2')).length).toBe(2)
    g.makeMoveNotation('e3')
    g.submit()
    g.makeMoveNotation('a6')
    g.submit()
    expect(g.movesFrom(pos(0, T(2), 'e3')).length).toBe(1)
  })
})

describe('brawns', () => {
  it('capture one step forward on one axis plus one step on another', () => {
    // White brawn on c3 of (0T2); black pieces on every square a brawn could capture.
    const empty = rows(5, 5)
    const boards = [
      `[${empty}:-1:1:w]`, `[${empty}:-1:1:b]`, `[${rows(5, 5, { b3: 'q', c4: 'q' })}:-1:2:w]`,
      `[${empty}:0:1:w]`, `[${empty}:0:1:b]`, `[${rows(5, 5, { c3: 'W*', b4: 'q', d4: 'q' })}:0:2:w]`,
    ]
    // (0T1) board with a queen on c4 for the "forward rank + one turn back" capture:
    boards[3] = `[${rows(5, 5, { c4: 'q' })}:0:1:w]`
    const g = fenGame(boards, 5, 5)
    const n = notations(g).sort()
    expect(n).toEqual([
      '(0T2)Wc4', '(0T2)Wc5=Q', '(0T2)Wc3>(-1T2)c3', // pushes (spatial, double onto the last rank, timeline)
      '(0T2)Wc3>>x(0T1)c4', // forward rank + one turn back
      '(0T2)Wc3>x(-1T2)b3', // forward timeline + file
      '(0T2)Wc3>x(-1T2)c4', // forward timeline + forward rank
      '(0T2)Wxb4', '(0T2)Wxd4', // ordinary diagonal captures
    ].sort())
  })

  it('pawns do not have the extra brawn captures', () => {
    const empty = rows(5, 5)
    const g = fenGame([
      `[${rows(5, 5, { c4: 'q' })}:0:1:w]`, `[${empty}:0:1:b]`, `[${rows(5, 5, { c3: 'P', c4: 'q' })}:0:2:w]`,
      `[${empty}:-1:1:w]`, `[${empty}:-1:1:b]`, `[${rows(5, 5, { b3: 'q', c4: 'q' })}:-1:2:w]`,
    ], 5, 5)
    const n = notations(g)
    expect(n).toContain('(0T2)Pc3>(-1T2)c3')
    for (const m of ['(0T2)Pc3>>x(0T1)c4', '(0T2)Pc3>x(-1T2)b3', '(0T2)Pc3>x(-1T2)c4']) expect(n).not.toContain(m)
  })
})

describe('riders across time and timelines (reference scenarios)', () => {
  const setup = (piece: string, black: boolean): string[] => {
    const e = '3/3/3'
    const res: string[] = []
    const lastSide = black ? ['1w', '1b', '2w', '2b', '3w', '3b'] : ['1w', '1b', '2w', '2b', '3w']
    for (const l of [-1, 1]) for (const b of lastSide) res.push(`[${e}:${l}:${b[0]}:${b[1]}]`)
    const main = black ? ['1w', '1b', '2w', '2b'] : ['1w', '1b', '2w']
    main.forEach((b, i) => res.push(`[${i === main.length - 1 ? `3/1${piece}1/3` : e}:0:${b[0]}:${b[1]}]`))
    return res
  }
  it.each([
    ['B', false, 20], ['b', true, 20], ['R', false, 7], ['r', true, 7],
  ])('%s (black: %s) has %i moves', (piece, black, count) => {
    const g = fenGame(setup(piece as string, black as boolean), 3, 3)
    const L = (piece as string).toUpperCase()
    const n = notations(g)
    expect(n.length).toBe(count)
    if (L === 'B') {
      for (const m of ['(0T2)Ba1', '(0T2)Bb2>>(0T1)b1', '(0T2)Bb2>>(-1T2)b1', '(0T2)Bb2>>(0T1)a2', '(0T2)Bb2>>(-1T2)a2', '(0T2)Bb2>>(-1T1)b2']) expect(n).toContain(m)
      for (const m of ['(0T2)Bb1', '(0T2)Ba2', '(0T2)Bb2>>(0T1)b2', '(0T2)Bb2>>(-1T2)b2', '(0T2)Bb2>>(0T1)a1', '(0T2)Bb2>>(-1T1)a1']) expect(n).not.toContain(m)
    } else {
      for (const m of ['(0T2)Rb1', '(0T2)Ra2', '(0T2)Rb2>>(0T1)b2', '(0T2)Rb2>>(-1T2)b2']) expect(n).toContain(m)
      for (const m of ['(0T2)Ra1', '(0T2)Rb2>>(0T1)b1', '(0T2)Rb2>>(-1T1)b2']) expect(n).not.toContain(m)
    }
  })

  it('sliding pieces are blocked by pieces on intermediate boards and by missing boards', () => {
    // Rook on (0T3) a1; a piece on (0T2) a1 blocks travel to (0T1); timeline -1 has no T1 board.
    const e = rows(3, 3)
    const g = fenGame([
      `[${e}:0:1:w]`, `[${e}:0:1:b]`, `[${rows(3, 3, { a1: 'n' })}:0:2:w]`, `[${e}:0:2:b]`, `[${rows(3, 3, { a1: 'R' })}:0:3:w]`,
      `[${e}:-1:2:b]`, `[${e}:-1:3:w]`,
      `[${e}:-2:1:w]`, `[${e}:-2:1:b]`, `[${e}:-2:2:w]`, `[${e}:-2:2:b]`, `[${e}:-2:3:w]`,
    ], 3, 3)
    const dests = g.movesFrom(pos(0, T(3), 'a1')).map((m) => `${m.to.l}:${m.to.t}`)
    expect(dests).toContain(`0:${T(2)}`) // captures the knight on (0T2)
    expect(dests).not.toContain(`0:${T(1)}`) // blocked by it
    expect(dests).toContain(`-1:${T(3)}`)
    expect(dests).toContain(`-2:${T(3)}`)
  })
})

describe('castling', () => {
  it('queenside and kingside castling', () => {
    const g = createGame('standard', { skipMateDetection: true })
    for (const m of ['e3', 'e6', 'Qe2', 'Qe7', 'd3', 'd6', 'Bd2', 'Bd7', 'Nc3', 'Nc6']) {
      g.makeMoveNotation(m)
      g.submit()
    }
    expect(notations(g)).toContain('(0T6)O-O-O')
    expect(notations(g)).not.toContain('(0T6)O-O')
    g.makeMoveNotation('O-O-O')
    const b = g.snapshot().timelines[0].boards.at(-1)!
    expect(b.squares[2]).toMatchObject({ type: 'K', moved: true })
    expect(b.squares[3]).toMatchObject({ type: 'R', moved: true })
    expect(g.pendingMoves[0].castle).toEqual({ rookFrom: pos(0, T(6), 'a1'), rookTo: pos(0, T(6), 'd1') })
  })

  it.each([
    ['r*nbqk*bnr*/p*p*p*p*p*p*p*p*/8/8/8/8/P*3P*P*P*P*/R*3K*BNR*', true],
    ['r*nbqk*bnr*/p*p*p*p*p*p*p*p*/8/8/1r6/8/P*3P*P*P*P*/R*3K*BNR*', true], // b-file attacked: the king does not pass it
    ['r*nbqk*bnr*/p*p*p*p*p*p*p*p*/8/8/8/8/P*3P*P*P*P*/R*2K*1BNR*', false], // king on d1: its castling move is written Kb1, not O-O-O
    ['r*nbqk*bnr*/p*p*p*p*p*p*p*p*/8/8/3r*4/8/P*3P*P*P*P*/R*3K*BNR*', false], // d1 attacked
    ['r*nbqk*bnr*/p*p*p*p*p*p*p*p*/8/8/5q2/8/P*3P*P*P*P*/R*3K*BNR*', false], // c1 attacked
    ['r*nbqk*bnr*/p*p*p*p*p*p*p*p*/8/8/1q6/8/P*3P*P*P*P*/R*3K*BNR*', false], // in check
  ])('reference castling scenario %#', (fen, allowed) => {
    const g = fenGame([`[${fen}:0:1:w]`], 8, 8)
    expect(notations(g).includes('(0T1)O-O-O')).toBe(allowed)
  })

  it('cannot castle through a square attacked from another timeline', () => {
    // Black rook on timeline -1 at d8 of the board at the same time attacks d1 of (0T1) along the timeline axis? No:
    // a black rook on (-1T1 black) d1 can move one timeline over onto d1 of (0T1 black) — the board after castling.
    const w = 'r*3k*2r*/8/8/8/8/8/8/R*3K*2R*'
    const g = fenGame([
      `[${w}:0:1:w]`,
      `[${rows(8, 8, { e8: 'k', h1: 'K', d1: 'r' })}:-1:1:b]`,
    ], 8, 8)
    // White to move only on (0T1); -1 is ahead (black to move there).
    expect(g.player).toBe('white')
    const n = notations(g)
    expect(n).toContain('(0T1)O-O') // kingside is fine
    expect(n).not.toContain('(0T1)O-O-O') // d1 is attacked from timeline -1
  })
})

describe('kings and knights', () => {
  it('knight leaps across two axes (2+1), ignoring blockers', () => {
    const g = createGame('standard', { skipMateDetection: true })
    for (const m of ['e3', 'e6', 'Nf3', 'Nf6']) {
      g.makeMoveNotation(m)
      g.submit()
    }
    // (0T3)Nf3 can jump back in time: 2 turns back + 1 square, or 1 turn back + 2 squares.
    const n = notations(g).filter((x) => x.startsWith('(0T3)Nf3>>'))
    expect(n).toContain('(0T3)Nf3>>(0T1)f4')
    expect(n).toContain('(0T3)Nf3>>(0T2)f5')
    expect(n).toContain('(0T3)Nf3>>(0T2)h3')
  })
})

describe('pawn capture set (checked against a fan guide that was unsure)', () => {
  // A fan guide lists, for a white pawn on c3 at turn 4 of timeline 1 ("c3-4-1"), the captures
  // b4-4-1, d4-4-1, c3-3-0, c3-5-0, c4-3-1, c4-5-1, b3-4-0, d3-4-0. In the original game a pawn
  // captures diagonally within its board, or diagonally "through timelines": one timeline
  // forward (towards the opponent) and one turn back or forward, landing on the same square.
  // The other combinations belong to the brawn.
  const setup = (pawn: string): string[] => {
    const e = rows(5, 5)
    return [
      `[${rows(5, 5, { c3: 'n' })}:0:3:w]`, `[${e}:0:3:b]`, `[${rows(5, 5, { b3: 'n', d3: 'n', c4: 'n' })}:0:4:w]`, `[${e}:0:4:b]`, `[${rows(5, 5, { c3: 'n' })}:0:5:w]`,
      `[${rows(5, 5, { c4: 'n' })}:1:3:w]`, `[${e}:1:3:b]`, `[${rows(5, 5, { c3: pawn, b4: 'n', d4: 'n', c4: 'n' })}:1:4:w]`,
    ]
  }
  it('pawn', () => {
    const g = fenGame(setup('P'), 5, 5)
    expect(notations(g).filter((n) => n.includes('x')).sort()).toEqual(['(1T4)Pc3>>x(0T3)c3', '(1T4)Pc3>x(0T5)c3', '(1T4)cxb4', '(1T4)cxd4'])
  })
  it('brawn', () => {
    const g = fenGame(setup('W'), 5, 5)
    expect(notations(g).filter((n) => n.includes('x')).sort()).toEqual([
      '(1T4)Wc3>>x(0T3)c3', '(1T4)Wc3>>x(0T4)b3', '(1T4)Wc3>>x(0T4)c4', '(1T4)Wc3>>x(0T4)d3', '(1T4)Wc3>>x(1T3)c4', '(1T4)Wc3>x(0T5)c3', '(1T4)Wxb4', '(1T4)Wxd4',
    ])
  })
})
