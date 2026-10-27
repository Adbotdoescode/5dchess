// Hand-made snapshots for the renderer demo and screenshots. They follow the
// engine contract (src/engine/types.ts) but are built without the engine.

import type { Board, Check, Color, MultiverseSnapshot, Piece, PieceType, Pos, Timeline } from '../../engine/types'
import type { BoardArrow, HighlightedSquare, RenderModel } from '../types'

// ---------------------------------------------------------------------------
// Tiny position helpers

const BACK: PieceType[] = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R']

export function startBoard(l: number, t: number): Board {
  const squares: (Piece | null)[] = new Array(64).fill(null)
  for (let x = 0; x < 8; x++) {
    squares[x] = { type: BACK[x], color: 'white', moved: false }
    squares[8 + x] = { type: 'P', color: 'white', moved: false }
    squares[48 + x] = { type: 'P', color: 'black', moved: false }
    squares[56 + x] = { type: BACK[x], color: 'black', moved: false }
  }
  return { l, t, width: 8, height: 8, squares }
}

const sq = (s: string) => ({ x: s.charCodeAt(0) - 97, y: Number(s[1]) - 1 })

/** Returns a new board at (l, t) after applying moves like "e2e4" (castling: "e1g1" moves the rook too). */
export function play(b: Board, l: number, t: number, ...moves: string[]): Board {
  const squares = b.squares.slice()
  for (const m of moves) {
    const f = sq(m.slice(0, 2))
    const to = sq(m.slice(2, 4))
    const pc = squares[f.y * 8 + f.x]
    squares[f.y * 8 + f.x] = null
    squares[to.y * 8 + to.x] = pc ? { ...pc, moved: true } : null
    if (pc?.type === 'K' && Math.abs(to.x - f.x) === 2) {
      const rookFrom = to.x > f.x ? 7 : 0
      const rookTo = to.x > f.x ? 5 : 3
      squares[f.y * 8 + rookTo] = squares[f.y * 8 + rookFrom]
      squares[f.y * 8 + rookFrom] = null
    }
  }
  return { l, t, width: b.width, height: b.height, squares }
}

export function put(b: Board, l: number, t: number, at: string, piece: Piece | null): Board {
  const squares = b.squares.slice()
  const p = sq(at)
  squares[p.y * b.width + p.x] = piece
  return { l, t, width: b.width, height: b.height, squares }
}

/** Builds a timeline by playing one move per half-turn from `first`. */
function line(l: number, startT: number, first: Board, moves: string[][]): Board[] {
  const boards = [first]
  let cur = first
  moves.forEach((m, i) => {
    cur = play(cur, l, startT + i + 1, ...m)
    boards.push(cur)
  })
  return boards
}

const P = (l: number, t: number, s: string): Pos => ({ l, t, ...sq(s) })

function tl(
  l: number,
  startT: number,
  boards: Board[],
  opts: Partial<Pick<Timeline, 'branchedFrom' | 'createdBy' | 'active' | 'label'>> = {},
): Timeline {
  return {
    l,
    label: opts.label ?? (l === 0 ? '0' : l > 0 ? `+${l}` : `${l}`),
    startT,
    boards,
    branchedFrom: opts.branchedFrom ?? null,
    createdBy: opts.createdBy ?? null,
    active: opts.active ?? true,
  }
}

function snapshot(
  timelines: Timeline[],
  present: number,
  player: Color,
  canCreate: { white: boolean; black: boolean },
): MultiverseSnapshot {
  const sorted = timelines.slice().sort((a, b) => a.l - b.l)
  const timelinesCreated = { white: 0, black: 0 }
  for (const t of sorted) if (t.createdBy) timelinesCreated[t.createdBy]++
  return { width: 8, height: 8, timelines: sorted, present, player, timelinesCreated, canCreateActiveTimeline: canCreate }
}

export function baseModel(snapshot: MultiverseSnapshot, extra: Partial<RenderModel> = {}): RenderModel {
  return {
    snapshot,
    perspective: 'white',
    highlights: [],
    arrows: [],
    checks: [],
    pendingBoards: [],
    requiredBoards: [],
    viewFilter: 'all',
    filterColor: 'white',
    animations: true,
    cameraMode: '2d',
    ...extra,
  }
}

const moved = (l: number, t: number, a: string, b: string): HighlightedSquare[] => [
  { pos: P(l, t, a), kind: 'moved' },
  { pos: P(l, t, b), kind: 'moved' },
]

// ---------------------------------------------------------------------------
// Fixtures

export interface Fixture {
  id: string
  name: string
  model: RenderModel
}

function fixtureStart(): Fixture {
  const s = snapshot([tl(0, 2, [startBoard(0, 2)])], 2, 'white', { white: true, black: true })
  return { id: 'start', name: 'Standard start', model: baseModel(s, { requiredBoards: ['0:2'] }) }
}

/** White bishop travels back from (0,t6) to (0,t2) creating +1 (tentative). */
function fixtureBranch(): Fixture {
  const m = line(0, 2, startBoard(0, 2), [['e2e4'], ['e7e5'], ['f1e2'], ['d8f6']]) // t = 2..6
  const t7 = put(m[4], 0, 7, 'e2', null) // the bishop left e2 (tentative)
  const branchFirst = put(startBoard(1, 3), 1, 3, 'e4', { type: 'B', color: 'white', moved: true })
  const s = snapshot(
    [
      tl(0, 2, [...m, t7]),
      tl(1, 3, [branchFirst], { branchedFrom: { l: 0, t: 2 }, createdBy: 'white' }),
    ],
    3,
    'white',
    { white: false, black: true },
  )
  return {
    id: 'branch',
    name: 'White branch',
    model: baseModel(s, {
      pendingBoards: ['0:7', '1:3'],
      arrows: [{ from: P(0, 6, 'e2'), to: P(0, 2, 'e4'), kind: 'pending' }],
      highlights: [
        ...moved(0, 3, 'e2', 'e4'),
        ...moved(0, 4, 'e7', 'e5'),
        ...moved(0, 5, 'f1', 'e2'),
        ...moved(0, 6, 'd8', 'f6'),
        { pos: P(0, 7, 'e2'), kind: 'travel' },
        { pos: P(1, 3, 'e4'), kind: 'travel' },
      ],
    }),
  }
}

/** Three timelines, the newest one inactive (white band). */
function fixtureMulti(): Fixture {
  const main = line(0, 2, startBoard(0, 2), [['e2e4'], ['e7e5'], ['d1h5'], ['b8c6'], ['f1c4'], ['g8f6']])
  // +1 branched from (0, t2): white queen arrived on c3 at t=3? (black to move first)
  const b1first = put(startBoard(1, 3), 1, 3, 'h3', { type: 'Q', color: 'white', moved: true })
  const plus1 = line(1, 3, b1first, [['g8f6'], ['h3g3'], ['f6h5'], ['g3e3'], ['b8c6'], ['e3c3']])
  // +2 (inactive, white) branched from (+1, t4)
  const b2first = put(plus1[1], 2, 5, 'e3', { type: 'Q', color: 'white', moved: true })
  const s = snapshot(
    [
      tl(0, 2, main),
      tl(1, 3, plus1, { branchedFrom: { l: 0, t: 2 }, createdBy: 'white' }),
      tl(2, 5, [b2first], { branchedFrom: { l: 1, t: 4 }, createdBy: 'white', active: false }),
    ],
    8,
    'white',
    { white: false, black: true },
  )
  return {
    id: 'multi',
    name: 'Three timelines, inactive',
    model: baseModel(s, {
      pendingBoards: ['1:9', '2:5'],
      requiredBoards: ['0:8'],
      arrows: [
        { from: P(0, 6, 'h5'), to: P(0, 2, 'h3'), kind: 'last-move' },
        { from: P(1, 8, 'c3'), to: P(1, 4, 'e3'), kind: 'pending' },
        { from: P(0, 7, 'g8'), to: P(1, 7, 'f6'), kind: 'last-move' },
      ],
      highlights: [
        ...moved(0, 3, 'e2', 'e4'),
        ...moved(0, 4, 'e7', 'e5'),
        ...moved(0, 6, 'b8', 'c6'),
        ...moved(0, 7, 'f1', 'c4'),
        ...moved(0, 8, 'g8', 'f6'),
        ...moved(1, 5, 'h3', 'g3'),
        { pos: P(0, 5, 'h5'), kind: 'travel' },
        { pos: P(1, 3, 'h3'), kind: 'travel' },
        { pos: P(1, 9, 'c3'), kind: 'travel' },
        { pos: P(2, 5, 'e3'), kind: 'travel' },
      ],
    }),
  }
}

/** Queen branch: Q(0T7)d1>>(0T3)h5 creates +1 starting at (+1T3) black-to-move. Present t=7. */
function fixtureQueenBranch(): Fixture {
  const moves = [
    ['e2e4'],
    ['e7e5'],
    ['g1f3'],
    ['b8c6'],
    ['f1c4'],
    ['f8c5'],
    ['c2c3'],
    ['g8f6'],
    ['d2d3'],
    ['d7d6'],
    ['e1g1'],
    ['e8g8'],
  ]
  const main = line(0, 2, startBoard(0, 2), moves) // t = 2..14
  const t15 = put(main[12], 0, 15, 'd1', null)
  const first = put(main[4], 1, 7, 'h5', { type: 'Q', color: 'white', moved: true }) // copy of (0,t6) + queen
  const s = snapshot(
    [tl(0, 2, [...main, t15]), tl(1, 7, [first], { branchedFrom: { l: 0, t: 6 }, createdBy: 'white' })],
    7,
    'black',
    { white: false, black: true },
  )
  return {
    id: 'queen-branch',
    name: 'Queen branch: Q(0T7)d1>>(0T3)h5',
    model: baseModel(s, {
      arrows: [{ from: P(0, 14, 'd1'), to: P(0, 6, 'h5'), kind: 'last-move' }],
      highlights: [
        ...moved(0, 14, 'e8', 'g8'),
        { pos: P(0, 15, 'd1'), kind: 'travel' },
        { pos: P(1, 7, 'h5'), kind: 'travel' },
      ],
      requiredBoards: ['1:7'],
    }),
  }
}

/** Black timelines, an inactive black timeline, a check against a king on a PAST board. */
function fixtureChecks(): Fixture {
  const main = line(0, 2, startBoard(0, 2), [['e2e4'], ['f7f6'], ['d2d4'], ['g7g5'], ['b1c3'], ['a7a6'], ['g1f3']])
  // -1 created by black from (0,t5) (black travel): first board is white-to-move at t=6
  const m1first = put(main[3], -1, 6, 'h4', { type: 'Q', color: 'black', moved: true })
  const minus1 = line(-1, 6, m1first, [['g1f3'], ['h4g4'], ['h2h3']])
  // +1 created by white from (-1, t6)
  const p1first = put(minus1[0], 1, 7, 'd3', { type: 'N', color: 'white', moved: true })
  const plus1 = line(1, 7, p1first, [['a7a5'], ['d3b4']])
  // -2 created by black (inactive) from (0, t7)
  const m2first = put(main[5], -2, 8, 'f4', { type: 'B', color: 'black', moved: true })
  const s = snapshot(
    [
      tl(0, 2, main),
      tl(-1, 6, minus1, { branchedFrom: { l: 0, t: 5 }, createdBy: 'black' }),
      tl(1, 7, plus1, { branchedFrom: { l: -1, t: 6 }, createdBy: 'white' }),
      tl(-2, 8, [m2first], { branchedFrom: { l: 0, t: 7 }, createdBy: 'black', active: false }),
    ],
    9,
    'black',
    { white: true, black: false },
  )
  const checks: Check[] = [
    // a queen on the end board of -1 attacks the white king on a past main-line board
    { from: P(-1, 9, 'g4'), to: P(0, 3, 'e1') },
    { from: P(1, 9, 'b4'), to: P(1, 9, 'c6') },
  ]
  return {
    id: 'checks',
    name: 'Black timelines, inactive black, past-board check',
    model: baseModel(s, {
      checks,
      highlights: [
        { pos: P(0, 3, 'e1'), kind: 'check' },
        ...moved(0, 8, 'g1', 'f3'),
        ...moved(-1, 9, 'h2', 'h3'),
        { pos: P(-1, 6, 'h4'), kind: 'travel' },
        { pos: P(1, 7, 'd3'), kind: 'travel' },
        { pos: P(-2, 8, 'f4'), kind: 'travel' },
        { pos: P(-1, 9, 'g4'), kind: 'selected' },
        { pos: P(-1, 9, 'g3'), kind: 'destination' },
        { pos: P(-1, 9, 'g2'), kind: 'capture' },
        { pos: P(-1, 9, 'f5'), kind: 'destination' },
      ],
      arrows: [{ from: P(-1, 8, 'g1'), to: P(-1, 8, 'f3'), kind: 'last-move' }],
      filterColor: 'black',
    }),
  }
}

/** Every piece type, both colours. */
function fixtureFairy(): Fixture {
  const types: PieceType[] = ['K', 'Q', 'R', 'B', 'N', 'P', 'U', 'D', 'S', 'W', 'C', 'Y']
  const squares: (Piece | null)[] = new Array(64).fill(null)
  types.forEach((type, i) => {
    const x = i % 6
    const row = Math.floor(i / 6)
    squares[(row + 0) * 8 + x + 1] = { type, color: 'white', moved: false }
    squares[(row + 2) * 8 + x + 1] = { type, color: 'black', moved: false }
  })
  const b: Board = { l: 0, t: 2, width: 8, height: 8, squares }
  const b2: Board = { l: 0, t: 3, width: 8, height: 8, squares: squares.slice() }
  const s = snapshot([tl(0, 2, [b, b2])], 3, 'black', { white: true, black: true })
  return { id: 'fairy', name: 'All piece types', model: baseModel(s, { highlights: [{ pos: P(0, 3, 'b1'), kind: 'hover' }] }) }
}

/** ~15 timelines x 40 half-turns. */
function fixturePerf(): Fixture {
  let seed = 7
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const T_END = 41
  const randomStep = (b: Board, l: number, t: number): Board => {
    // move a random piece of the side to move to a random empty square (visual only)
    const color: Color = t % 2 === 0 ? 'black' : 'white' // board t is the result of colorAt(t-1)'s move
    const own: number[] = []
    const empty: number[] = []
    b.squares.forEach((p, i) => (p ? p.color === color && own.push(i) : empty.push(i)))
    const squares = b.squares.slice()
    if (own.length && empty.length) {
      const from = own[Math.floor(rnd() * own.length)]
      const to = empty[Math.floor(rnd() * empty.length)]
      squares[to] = { ...squares[from]!, moved: true }
      squares[from] = null
    }
    return { l, t, width: 8, height: 8, squares }
  }
  const timelines: Timeline[] = []
  const grow = (l: number, startT: number, first: Board) => {
    const boards = [first]
    for (let t = startT + 1; t <= T_END - (Math.abs(l) % 3 === 2 ? 1 : 0); t++) boards.push(randomStep(boards[boards.length - 1], l, t))
    return boards
  }
  timelines.push(tl(0, 2, grow(0, 2, startBoard(0, 2))))
  for (let i = 1; i <= 7; i++) {
    for (const sign of [1, -1]) {
      const l = sign * i
      const parent = timelines.find((x) => x.l === sign * (i - 1)) ?? timelines[0]
      const srcT = Math.min(parent.startT + 1 + Math.floor(rnd() * 4), parent.startT + parent.boards.length - 2)
      const src = parent.boards[srcT - parent.startT]
      const first: Board = { ...src, l, t: srcT + 1, squares: src.squares.slice() }
      timelines.push(
        tl(l, srcT + 1, grow(l, srcT + 1, first), {
          branchedFrom: { l: parent.l, t: srcT },
          createdBy: sign > 0 ? 'white' : 'black',
          active: i < 7,
        }),
      )
    }
  }
  const present = Math.min(...timelines.filter((x) => x.active).map((x) => x.startT + x.boards.length - 1))
  const s = snapshot(timelines, present, present % 2 === 0 ? 'white' : 'black', { white: true, black: true })
  const arrows: BoardArrow[] = [
    { from: { l: 3, t: 30, x: 3, y: 0 }, to: { l: -2, t: 14, x: 3, y: 5 }, kind: 'last-move' },
    { from: { l: -4, t: 33, x: 6, y: 7 }, to: { l: 1, t: 21, x: 2, y: 2 }, kind: 'last-move' },
  ]
  return { id: 'perf', name: 'Performance: 15 timelines x 40', model: baseModel(s, { arrows }) }
}

/** Even number of starting timelines ("-0" / "+0" at l = -0.5 / +0.5) plus one branch each. */
function fixtureEven(): Fixture {
  const a = line(-0.5, 2, startBoard(-0.5, 2), [['e2e4'], ['e7e5'], ['g1f3']])
  const b = line(0.5, 2, startBoard(0.5, 2), [['d2d4'], ['d7d5'], ['c2c4']])
  const w = put(b[0], 1.5, 3, 'f3', { type: 'N', color: 'white', moved: true })
  const s = snapshot(
    [
      tl(-0.5, 2, a, { label: '-0' }),
      tl(0.5, 2, b, { label: '+0' }),
      tl(1.5, 3, [w], { branchedFrom: { l: 0.5, t: 2 }, createdBy: 'white', label: '+1' }),
    ],
    3,
    'black',
    { white: false, black: true },
  )
  return { id: 'even', name: 'Even timelines (-0/+0)', model: baseModel(s) }
}

export function fixtures(): Fixture[] {
  return [
    fixtureStart(),
    fixtureBranch(),
    fixtureMulti(),
    fixtureQueenBranch(),
    fixtureChecks(),
    fixtureEven(),
    fixtureFairy(),
    fixturePerf(),
  ]
}
