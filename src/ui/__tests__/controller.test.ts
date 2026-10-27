import { describe, expect, it } from 'vitest'
import { Game } from '../../engine'
import type { Action, Color } from '../../engine'
import type { OnlineEvent, OnlineGameInfo, OnlineSession } from '../../net'
import { GameController, replayActions } from '../controller'
import { friendlyError } from '../format'

function actionsFor(moves: string[][]): Action[] {
  const g = Game.create('standard', { skipMateDetection: true })
  for (const a of moves) {
    for (const n of a) g.makeMoveNotation(n)
    g.submit()
  }
  return g.history.slice()
}

function fakeSession(actions: Action[], extra: Partial<OnlineGameInfo> = {}, role: Color = 'white'): OnlineSession & { fire(e: OnlineEvent): void } {
  const listeners = new Set<(e: OnlineEvent) => void>()
  const info: OnlineGameInfo = {
    code: 'ABCDEF',
    variantId: 'standard',
    myColor: role,
    actions,
    result: { kind: 'ongoing' },
    clock: null,
    role,
    firstPlayer: 'white',
    opponentJoined: true,
    actionTimes: actions.map(() => null),
    startedAt: 0,
    endedAt: null,
    serverTimeOffset: 0,
    clockMs: null,
    clockMsAt: null,
    firstActiveTimelines: 1,
    activeTimelinesAtTurnStart: [],
    drawOffer: null,
    rematchOffer: null,
    rematchCode: null,
    cancelled: false,
    ...extra,
  }
  return {
    info,
    role,
    submitAction: async () => {},
    setResult: async () => {},
    offerDraw: () => {},
    answerDraw: () => {},
    offerRematch: () => {},
    acceptRematch: () => {},
    on: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    leave: async () => {},
    clocks: () => null,
    serverNow: () => Date.now(),
    resync: async () => {},
    cancel: async () => {},
    fire(e) {
      for (const l of listeners) l(e)
    },
  }
}

describe('replayActions', () => {
  it('stops at the first action that does not replay', () => {
    const good = actionsFor([['(0T1)e4'], ['(0T1)e5']])
    const bad: Action = { player: 'white', moves: [{ from: { l: 0, t: 4, x: 0, y: 0 }, to: { l: 0, t: 4, x: 7, y: 7 } }] }
    const { game, error } = replayActions('standard', [...good, bad, good[1]])
    expect(error).toEqual({ index: 2, player: 'white' })
    expect(game.history.length).toBe(2)
  })

  it('replays a valid history completely', () => {
    const good = actionsFor([['(0T1)e4'], ['(0T1)e5']])
    expect(replayActions('standard', good).error).toBeNull()
  })
})

describe('GameController (online)', () => {
  it('opens a game whose stored history is invalid without throwing, frozen before the bad action', () => {
    const good = actionsFor([['(0T1)e4']])
    const bad: Action = { player: 'black', moves: [{ from: { l: 0, t: 3, x: 4, y: 6 }, to: { l: 0, t: 3, x: 4, y: 1 } }] }
    const ctrl = new GameController({ kind: 'online', session: fakeSession([...good, bad]) }, 'standard')
    expect(ctrl.historyError).toEqual({ index: 1, player: 'black' })
    expect(ctrl.game.history.length).toBe(1)
    expect(ctrl.canInteract).toBe(false)
  })

  it('derives the draw offer from the persisted info (reload) and clears it on decline / action', () => {
    const s = fakeSession(actionsFor([['(0T1)e4']]), { drawOffer: 'white' }, 'black')
    const ctrl = new GameController({ kind: 'online', session: s }, 'standard')
    expect(ctrl.drawOfferIncoming).toBe(true)
    expect(ctrl.drawOfferSent).toBe(false)
    ctrl.answerDraw(false)
    expect(ctrl.drawOfferIncoming).toBe(false) // even before the session clears info.drawOffer

    const s2 = fakeSession(actionsFor([['(0T1)e4']]), { drawOffer: 'white' }, 'white')
    const c2 = new GameController({ kind: 'online', session: s2 }, 'standard')
    expect(c2.drawOfferSent).toBe(true)
    // the opponent declines: "Offer draw" is available again
    ;(c2 as unknown as { onOnlineEvent(e: OnlineEvent): void }).onOnlineEvent({ type: 'draw-declined', reason: 'declined' })
    expect(c2.drawOfferSent).toBe(false)
  })

  it('restores the rematch state from info', () => {
    const s = fakeSession(actionsFor([['(0T1)e4']]), { result: { kind: 'resignation', winner: 'white' }, rematchOffer: 'black' }, 'white')
    const ctrl = new GameController({ kind: 'online', session: s }, 'standard')
    expect(ctrl.rematchIncoming).toBe(true)
    expect(ctrl.rematchSent).toBe(false)
    s.info.rematchCode = 'XYZW23'
    expect(ctrl.rematchCode).toBe('XYZW23')
  })

  it('writes the local date into the PGN', () => {
    const ctrl = new GameController({ kind: 'local', clock: null }, 'standard')
    const d = new Date()
    const want = `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
    expect(ctrl.pgn()).toContain(`[Date "${want}"]`)
  })
})

describe('friendlyError', () => {
  it('hides raw technical errors', () => {
    expect(friendlyError('TypeError: Failed to fetch')).toBe('Connection lost — retrying…')
    expect(friendlyError('out of sync: expected index 1')).toBe('Game updated from another tab')
    expect(friendlyError('relation "games" does not exist')).toBe('Something went wrong — please try again')
  })
  it('keeps messages already written for players', () => {
    expect(friendlyError('This game was cancelled.')).toBe('This game was cancelled.')
    expect(friendlyError("It's not your turn.")).toBe("It's not your turn.")
  })
})
