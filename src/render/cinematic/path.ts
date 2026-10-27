// Which boards the time-travel cinematic shows, in flight order (pure, unit-tested).
//
// In the original (owner's recording 38-43 s, BrodieOnGames 12:49-12:58) the camera
// tilts the source timeline into a stack of cards and then flies back through every
// board between the piece's source board and its destination, one board per second,
// and lands on the destination board. The source board comes first (k = 0), the
// destination last (k = passes); for a jump to another timeline the boards in between come
// from the destination timeline where it has them. Boards behind the destination on the same line
// (earlier boards of that timeline) are also stood up: they hide behind the
// destination card, as in the footage, so the floor shows no flat copies of them.

import type { MultiverseSnapshot, Pos } from '../../engine/types'

export interface PathBoard {
  l: number
  t: number
  /** Order along the flight: 0 = source, `passes` = destination, more = behind it. */
  k: number
}

export interface TravelPath {
  boards: PathBoard[]
  /** Boards passed before landing (the source board counts). */
  passes: number
}

const exists = (s: MultiverseSnapshot, l: number, t: number) => {
  const tl = s.timelines.find((x) => x.l === l)
  return !!tl && t >= tl.startT && t < tl.startT + tl.boards.length
}

/** Boards on the destination timeline that precede `t` (back to the timeline start). */
function earlier(s: MultiverseSnapshot, l: number, t: number, max: number): number[] {
  const out: number[] = []
  for (let u = t - 1; out.length < max && exists(s, l, u); u--) out.push(u)
  return out
}

/**
 * The flight path for a travel move, from the snapshot *before* the move.
 * `behind` caps how many boards behind the destination are stood up.
 */
export function travelPath(before: MultiverseSnapshot, from: Pos, to: Pos, behind = 6): TravelPath {
  const boards: PathBoard[] = [{ l: from.l, t: from.t, k: 0 }]
  // one board per half-turn in between, ordered from the source time towards the destination:
  // the destination timeline's board at that time, else the source timeline's (a timeline
  // created later has no boards that far back or forward)
  const dir = to.t < from.t ? -1 : 1
  for (let u = from.t + dir; dir < 0 ? u > to.t : u < to.t; u += dir) {
    if (exists(before, to.l, u)) boards.push({ l: to.l, t: u, k: boards.length })
    else if (exists(before, from.l, u)) boards.push({ l: from.l, t: u, k: boards.length })
  }
  const passes = boards.length
  boards.push({ l: to.l, t: to.t, k: passes })
  if (dir < 0 || to.t === from.t) {
    let k = passes + 1
    for (const u of earlier(before, to.l, to.t, behind)) boards.push({ l: to.l, t: u, k: k++ })
  }
  return { boards, passes }
}
