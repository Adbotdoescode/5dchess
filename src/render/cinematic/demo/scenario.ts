// Dev harness helper: builds before/after render models for a time-travel move with the
// real rules engine (any variant, any piece type, any depth). Dev-only.

import { Game, findVariant } from '../../../engine'
import type { Color, Move, MoveRecord, Pos, PieceType } from '../../../engine'
import type { BoardArrow, HighlightedSquare, RenderModel } from '../../types'

export interface Scenario {
  before: RenderModel
  after: RenderModel
  move: Move
  record: MoveRecord
  label: string
}

const key = (l: number, t: number) => `${l}:${t}`

/** Render model in the controller's style (last action highlighted, pending boards framed). */
export function modelOf(g: Game, persp: Color): RenderModel {
  const highlights: HighlightedSquare[] = []
  const arrows: BoardArrow[] = []
  const pendingBoards: string[] = []
  const pendingKinds: Record<string, 'move' | 'travel'> = {}
  const mark = (rec: MoveRecord) => {
    const m = rec.move
    if (rec.kind === 'spatial') {
      highlights.push({ pos: { l: rec.fromBoard.l, t: rec.fromBoard.t, x: m.from.x, y: m.from.y }, kind: 'moved' })
      highlights.push({ pos: { l: rec.fromBoard.l, t: rec.fromBoard.t, x: m.to.x, y: m.to.y }, kind: 'moved' })
    } else {
      highlights.push({ pos: { l: rec.fromBoard.l, t: rec.fromBoard.t, x: m.from.x, y: m.from.y }, kind: 'travel' })
      if (rec.toBoard) highlights.push({ pos: { l: rec.toBoard.l, t: rec.toBoard.t, x: m.to.x, y: m.to.y }, kind: 'travel' })
    }
  }
  const all = g.actionRecords()
  // the app's defaults: history highlights and arrows for every action
  all.forEach((recs) => {
    for (const rec of recs) {
      mark(rec)
      if (rec.kind !== 'spatial') arrows.push({ from: rec.move.from, to: rec.move.to, kind: 'last-move' })
    }
  })
  for (const rec of g.pendingRecords()) {
    mark(rec)
    if (rec.kind !== 'spatial') arrows.push({ from: rec.move.from, to: rec.move.to, kind: 'pending' })
    const kind = rec.kind === 'spatial' ? 'move' : 'travel'
    pendingBoards.push(key(rec.fromBoard.l, rec.fromBoard.t))
    pendingKinds[key(rec.fromBoard.l, rec.fromBoard.t)] = kind
    if (rec.toBoard) {
      pendingBoards.push(key(rec.toBoard.l, rec.toBoard.t))
      pendingKinds[key(rec.toBoard.l, rec.toBoard.t)] = kind
    }
  }
  return {
    snapshot: g.snapshot(),
    perspective: persp,
    highlights,
    arrows,
    checks: g.checks(),
    pendingBoards,
    pendingBoardKinds: pendingKinds,
    requiredBoards: g.requiredBoards().map((b) => key(b.l, b.t)),
    viewFilter: 'all',
    filterColor: persp,
    animations: true,
    viewMode: '2d',
  }
}

/** Deterministic pseudo-random numbers. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 4294967296
  }
}

function spatialMoves(g: Game): Move[] {
  const out: Move[] = []
  const req = new Set(g.requiredBoards().map((b) => key(b.l, b.t)))
  for (const p of g.movablePieces()) {
    if (req.size && !req.has(key(p.l, p.t))) continue
    for (const m of g.movesFrom(p)) if (g.moveKind(m) === 'spatial') out.push(m)
  }
  return out
}

/** Plays one quiet action for the side to move (spatial moves only). */
function playQuiet(g: Game, rand: () => number): boolean {
  for (let guard = 0; guard < 12 && !g.canSubmit(); guard++) {
    const ms = spatialMoves(g)
    if (!ms.length) return false
    // prefer non-captures that do not touch kings
    const quiet = ms.filter((m) => {
      const b = g.snapshot().timelines.find((t) => t.l === m.to.l)?.boards.find((x) => x.t === m.to.t)
      return !b?.squares[m.to.y * b.width + m.to.x]
    })
    const pool = quiet.length ? quiet : ms
    g.makeMove(pool[Math.floor(rand() * pool.length)])
  }
  if (!g.canSubmit()) return false
  g.submit()
  return g.result().kind === 'ongoing'
}

function pieceAt(g: Game, p: Pos) {
  const tl = g.snapshot().timelines.find((t) => t.l === p.l)
  const b = tl?.boards[p.t - tl.startT]
  return b?.squares[p.y * b.width + p.x] ?? null
}

/** Travel moves of the side to move by a piece of `type`, deepest first. */
function travels(g: Game, type: PieceType | 'any'): Move[] {
  const out: Move[] = []
  for (const p of g.movablePieces()) {
    const pc = pieceAt(g, p)
    if (!pc || (type !== 'any' && pc.type !== type)) continue
    for (const m of g.movesFrom(p)) if (g.moveKind(m) !== 'spatial') out.push(m)
  }
  out.sort((a, b) => b.from.t - b.to.t - (a.from.t - a.to.t) || Math.abs(b.to.l - b.from.l) - Math.abs(a.to.l - a.from.l))
  return out
}

export interface ScenarioOptions {
  variant: string
  piece: PieceType | 'any'
  color: Color
  /** Full turns of quiet history before the travel. */
  history: number
  /** Preferred depth in half-turns (0 = deepest available). */
  depth: number
  perspective: Color
  seed: number
  /** Explicit actions (PGN-style move lists) instead of random history. */
  pgn?: string
}

export function buildScenario(o: ScenarioOptions): Scenario | string {
  if (o.pgn) {
    const g0 = Game.fromPgn(o.pgn)
    // the last move of the PGN becomes the (pending) travel move
    let g: Game
    let last: Move
    if (g0.pendingMoves.length) {
      g = g0
      last = g0.pendingMoves[g0.pendingMoves.length - 1]
      g.undoMove()
    } else {
      const hist = g0.history
      const act = hist[hist.length - 1]
      if (!act) return 'empty PGN'
      g = Game.fromActions(g0.variant.id, hist.slice(0, -1))
      for (const m of act.moves.slice(0, -1)) g.makeMove(m)
      last = act.moves[act.moves.length - 1]
    }
    const before = modelOf(g, o.perspective)
    g.makeMove(last)
    const after = modelOf(g, o.perspective)
    const record = g.pendingRecords()[g.pendingRecords().length - 1]
    return { before, after, move: last, record, label: record.notation }
  }
  if (!findVariant(o.variant)) return `unknown variant ${o.variant}`
  const rand = rng(o.seed)
  const g = Game.create(o.variant)
  let turns = 0
  for (let guard = 0; guard < 200; guard++) {
    const mover = g.player
    if (mover === o.color && turns >= o.history) {
      const list = travels(g, o.piece)
      if (list.length) {
        let pick = list[0]
        if (o.depth > 0) pick = list.find((m) => m.from.t - m.to.t === o.depth) ?? list.reduce((a, b) => (Math.abs(b.from.t - b.to.t - o.depth) < Math.abs(a.from.t - a.to.t - o.depth) ? b : a))
        // make the other required moves of this action first? keep it simple: travel is the first move
        const before = modelOf(g, o.perspective)
        g.makeMove(pick)
        const after = modelOf(g, o.perspective)
        const record = g.pendingRecords()[g.pendingRecords().length - 1]
        return { before, after, move: pick, record, label: record.notation }
      }
    }
    if (!playQuiet(g, rand)) return 'game ended or no quiet move before a travel was found'
    if (mover === 'black') turns++
  }
  return `no travel move by ${o.color} ${o.piece} found`
}
