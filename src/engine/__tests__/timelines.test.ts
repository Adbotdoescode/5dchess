import { describe, expect, it } from 'vitest'
import { createGame } from '../game'
import { T, fenGame, pos, rows } from './helpers'

const play = (g: ReturnType<typeof createGame>, actions: string[]): void => {
  for (const a of actions) {
    for (const m of a.split(' ')) g.makeMoveNotation(m)
    g.submit()
  }
}

describe('time travel, branching and the present', () => {
  it('queen d1 (0T7) to h5 (0T3) creates timeline +1 starting on T3 black (regression from a well-known video)', () => {
    const g = createGame('standard', { skipMateDetection: true })
    play(g, ['e3', 'a6', 'a3', 'a5', 'b3', 'h6', 'c3', 'b6', 'd3', 'c6', 'g3', 'd6'])
    const q = g.movesFrom(pos(0, T(7), 'd1')).find((m) => m.to.t === T(3) && m.to.x === 7 && m.to.y === 4)!
    expect(q).toBeDefined()
    expect(g.moveKind(q)).toBe('branch')
    expect(g.moveToNotation(q)).toBe('(0T7)Qd1>>(0T3)h5~')
    g.makeMove(q)
    const snap = g.snapshot()
    const tl = snap.timelines.find((t) => t.l === 1)!
    expect(tl.label).toBe('+1')
    expect(tl.startT).toBe(2 * 3 + 1) // T3, black to move
    expect(tl.branchedFrom).toEqual({ l: 0, t: T(3) })
    expect(tl.createdBy).toBe('white')
    expect(tl.active).toBe(true)
    expect(snap.present).toBe(T(3, 'b')) // the present moved back to T3 (black)
    expect(snap.timelinesCreated).toEqual({ white: 1, black: 0 })
    expect(g.pendingRecords()[0]).toMatchObject({ kind: 'branch', fromBoard: { l: 0, t: T(7, 'b') }, toBoard: { l: 1, t: T(3, 'b') }, createdTimeline: 1 })
    expect(g.canSubmit()).toBe(true)
    g.submit()
    // Black must now move on +1 (at the present); the main line is ahead and optional.
    expect(g.requiredBoards()).toEqual([{ l: 1, t: T(3, 'b') }])
    expect(g.playableBoards()).toEqual(expect.arrayContaining([{ l: 0, t: T(7, 'b') }, { l: 1, t: T(3, 'b') }]))
    g.makeMoveNotation('(1T3)Nf6')
    expect(g.canSubmit()).toBe(true)
    g.submit()
    const b = g.board(1, T(4))!
    expect(b.squares[4 * 8 + 7]).toMatchObject({ type: 'Q', color: 'white' }) // queen on h5 of (+1T4)
  })

  it('travel from T14 to T12 does not move the present while an active timeline ends at T9', () => {
    const e = rows(5, 5, { a1: 'K', e5: 'k' })
    const boards = [`[${e}:0:12:w]`, `[${e}:0:12:b]`, `[${e}:0:13:w]`, `[${e}:0:13:b]`, `[${rows(5, 5, { a1: 'K', e5: 'k', c3: 'R' })}:0:14:w]`, `[${e}:-1:9:w]`]
    const g = fenGame(boards, 5, 5)
    expect(g.present()).toBe(T(9))
    expect(g.requiredBoards()).toEqual([{ l: -1, t: T(9) }])
    const travel = g.movesFrom(pos(0, T(14), 'c3')).find((m) => m.to.t === T(12) && m.to.l === 0)!
    g.makeMove(travel)
    expect(g.moveKind(g.pendingMoves[0])).toBe('branch')
    expect(g.present()).toBe(T(9))
    expect(g.requiredBoards()).toEqual([{ l: -1, t: T(9) }])
    expect(g.submitBlocker()).toBe('must-move-present')
    g.makeMove(g.movesFrom(pos(-1, T(9), 'a1'))[0])
    expect(g.canSubmit()).toBe(true) // moves on future boards are optional
  })

  it('a jump to a timeline ahead (into the future) never moves the present back', () => {
    const e = rows(5, 5, { a1: 'K', e5: 'k' })
    const g = fenGame([`[${rows(5, 5, { a1: 'K', e5: 'k', c3: 'Q' })}:0:5:w]`, `[${e}:1:5:b]`, `[${rows(5, 5, { a5: 'K', e1: 'k' })}:1:6:w]`], 5, 5)
    const before = g.present()
    const jump = g.movesFrom(pos(0, T(5), 'c3')).find((m) => m.to.l === 1 && m.to.t === T(6))!
    expect(g.moveKind(jump)).toBe('jump')
    g.makeMove(jump)
    expect(g.present()).toBeGreaterThanOrEqual(before)
    expect(g.snapshot().timelines.length).toBe(2)
  })

  it('moving from one present board onto another satisfies both (Two Timelines)', () => {
    const g = createGame('two_timelines', { skipMateDetection: true })
    expect(g.requiredBoards()).toEqual([{ l: -0.5, t: T(1) }, { l: 0.5, t: T(1) }])
    g.makeMoveNotation('(+0T1)Nb1>(-0T1)b3')
    expect(g.requiredBoards()).toEqual([])
    expect(g.canSubmit()).toBe(true)
    expect(g.pendingRecords()[0].kind).toBe('jump')
  })

  it('must move on every active board at the present', () => {
    const g = createGame('two_timelines', { skipMateDetection: true })
    g.makeMoveNotation('(-0T1)e3')
    expect(g.canSubmit()).toBe(false)
    expect(g.submitBlocker()).toBe('must-move-present')
    g.makeMoveNotation('(+0T1)e3')
    expect(g.canSubmit()).toBe(true)
  })

  it('new timelines are numbered by color; extra timelines are inactive until the opponent catches up', () => {
    const g = createGame('standard', { skipMateDetection: true })
    play(g, ['e3', 'e6', 'Qf3', 'Qf6', '(0T3)Qf3>>(0T1)f5', '(1T1)Nc6'])
    let s = g.snapshot()
    expect(s.timelines.map((t) => [t.label, t.active])).toEqual([['0', true], ['+1', true]])
    expect(s.canCreateActiveTimeline).toEqual({ white: false, black: true })
    // White must move on +1 (T2); a second white timeline is inactive.
    expect(g.requiredBoards()).toEqual([{ l: 1, t: T(2) }])
    g.makeMoveNotation('(1T2)Qf5>>(0T1)f5')
    s = g.snapshot()
    expect(s.timelines.map((t) => [t.label, t.active])).toEqual([['0', true], ['+1', true], ['+2', false]])
    expect(g.canSubmit()).toBe(true)
    g.submit()
    // Black creates -1: white's +2 becomes active and, being earliest, pulls the present back.
    g.makeMoveNotation('(0T3)Qf6>>(0T2)f5')
    s = g.snapshot()
    expect(s.timelines.map((t) => [t.label, t.active])).toEqual([['-1', true], ['0', true], ['+1', true], ['+2', true]])
    expect(s.timelinesCreated).toEqual({ white: 2, black: 1 })
    expect(s.present).toBe(T(1, 'b'))
    expect(g.requiredBoards()).toEqual([{ l: 2, t: T(1, 'b') }])
  })

  it('undo restores the previous state exactly', () => {
    const g = createGame('standard', { skipMateDetection: true })
    play(g, ['e3', 'e6', 'Qf3', 'Qf6'])
    const before = g.snapshot()
    g.makeMoveNotation('(0T3)Qf3>>(0T1)f5')
    expect(g.snapshot().timelines.length).toBe(2)
    expect(g.undoMove()).toBe(true)
    expect(g.undoMove()).toBe(false)
    const after = g.snapshot()
    expect(after.timelines.length).toBe(1)
    after.timelines[0].boards.forEach((b, i) => expect(b).toBe(before.timelines[0].boards[i]))
    expect(after.present).toBe(before.present)
  })

  it('jump vs branch: a move onto a playable board that was already moved on branches', () => {
    const g = createGame('two_timelines', { skipMateDetection: true })
    g.makeMoveNotation('(-0T1)e3')
    // The -0 board was consumed; the knight landing on it now branches.
    const m = g.movesFrom(pos(0.5, T(1), 'b1')).find((x) => x.to.l === -0.5)!
    expect(g.moveKind(m)).toBe('branch')
    g.makeMove(m)
    expect(g.snapshot().timelines.map((t) => t.label)).toEqual(['-0', '+0', '+1'])
  })

  it('applyAction validates and applies a whole action; illegal actions leave the state untouched', () => {
    const g = createGame('standard', { skipMateDetection: true })
    const a = { player: 'white' as const, moves: [g.movesFrom(pos(0, T(1), 'e2'))[0]] }
    const bad = { player: 'white' as const, moves: [{ from: pos(0, T(1), 'e2'), to: pos(0, T(1), 'e5') }] }
    expect(() => g.applyAction(bad)).toThrow()
    expect(g.pendingMoves.length).toBe(0)
    g.applyAction(a)
    expect(g.player).toBe('black')
    expect(g.history).toHaveLength(1)
  })
})
