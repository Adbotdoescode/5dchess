// 5DFEN board strings: `[<rows>:<timeline>:<turn>:<w|b>]`, rows from the top
// rank to rank 1, '/'-separated; uppercase = white, lowercase = black, digits =
// empty squares, '*' after a piece = unmoved. Clean-room implementation.

import { Multiverse, parseTlNotation, tlNotation } from './core'
import type { ITimeline } from './core'
import { BLACK, TYPE_LETTERS, TYPE_MASK, T_K, T_P, T_R, T_W, UNMOVED, typeFromLetter } from './pieces'

export interface FenBoard {
  rows: string
  timeline: string
  turn: number
  color: 'w' | 'b'
}

const FEN_RE = /^\[([^:\]]+):([+-]?\d+):(\d+):([wb])\]$/

export function isFenBoardString(s: string): boolean {
  return FEN_RE.test(s.trim())
}

export function parseFenBoard(s: string): FenBoard {
  const m = FEN_RE.exec(s.trim())
  if (!m) throw new Error(`Invalid 5DFEN board string: ${s}`)
  return { rows: m[1], timeline: m[2], turn: Number(m[3]), color: m[4] as 'w' | 'b' }
}

/** Pieces whose unmoved state matters and is therefore written with '*'. */
const STAR_TYPES = new Set([T_P, T_W, T_K, T_R])

export function fenRowsToCells(rows: string, W: number, H: number): Uint8Array {
  const cells = new Uint8Array(W * H)
  const parts = rows.split('/')
  if (parts.length !== H) throw new Error(`5DFEN: expected ${H} rows, got ${parts.length} in "${rows}"`)
  for (let r = 0; r < H; r++) {
    const y = H - 1 - r
    const row = parts[r]
    let x = 0
    let i = 0
    while (i < row.length) {
      const ch = row[i]
      if (ch >= '0' && ch <= '9') {
        let j = i
        while (j < row.length && row[j] >= '0' && row[j] <= '9') j++
        x += Number(row.slice(i, j))
        i = j
        continue
      }
      if (ch === '+') {
        i++
        continue
      }
      if (!/[A-Za-z]/.test(ch)) throw new Error(`5DFEN: unexpected character "${ch}" in "${rows}"`)
      const upper = ch.toUpperCase()
      const type = typeFromLetter(upper)
      let code = type | (ch === upper ? 0 : BLACK)
      i++
      if (row[i] === '*') {
        code |= UNMOVED
        i++
      } else if (!STAR_TYPES.has(type)) {
        // Pieces whose moved-state does not matter start as "not moved".
        code |= UNMOVED
      }
      if (x >= W) throw new Error(`5DFEN: row too long in "${rows}"`)
      cells[y * W + x] = code
      x++
    }
    if (x !== W) throw new Error(`5DFEN: row ${r + 1} has ${x} squares, expected ${W} in "${rows}"`)
  }
  return cells
}

export function cellsToFenRows(cells: Uint8Array, W: number, H: number): string {
  const rows: string[] = []
  for (let y = H - 1; y >= 0; y--) {
    let s = ''
    let empty = 0
    for (let x = 0; x < W; x++) {
      const c = cells[y * W + x]
      if (c === 0) {
        empty++
        continue
      }
      if (empty) {
        s += empty
        empty = 0
      }
      const type = c & TYPE_MASK
      const letter = TYPE_LETTERS[type]
      s += c & BLACK ? letter.toLowerCase() : letter
      if (c & UNMOVED && STAR_TYPES.has(type)) s += '*'
    }
    if (empty) s += empty
    rows.push(s)
  }
  return rows.join('/')
}

export function boardToFen(even: boolean, li: number, t: number, cells: Uint8Array, W: number, H: number): string {
  return `[${cellsToFenRows(cells, W, H)}:${tlNotation(even, li)}:${Math.floor(t / 2)}:${t % 2 === 0 ? 'w' : 'b'}]`
}

/** Build a multiverse from 5DFEN board strings. */
export function multiverseFromFen(boards: readonly string[], W: number, H: number): Multiverse {
  const parsed = boards.map(parseFenBoard)
  if (parsed.length === 0) throw new Error('5DFEN: no boards')
  const even = parsed.some((b) => b.timeline === '-0' || b.timeline === '+0')
  const byLi = new Map<number, { t: number; cells: Uint8Array }[]>()
  for (const b of parsed) {
    const li = parseTlNotation(even, b.timeline)
    const t = 2 * b.turn + (b.color === 'b' ? 1 : 0)
    const list = byLi.get(li) ?? []
    list.push({ t, cells: fenRowsToCells(b.rows, W, H) })
    byLi.set(li, list)
  }
  const mv = new Multiverse(W, H, even)
  const lis = [...byLi.keys()].sort((a, b) => a - b)
  for (let i = 1; i < lis.length; i++) {
    if (lis[i] !== lis[i - 1] + 1) throw new Error('5DFEN: timelines must be contiguous')
  }
  for (const li of lis) {
    const list = byLi.get(li)!.sort((a, b) => a.t - b.t)
    for (let i = 1; i < list.length; i++) {
      if (list[i].t !== list[i - 1].t + 1) throw new Error(`5DFEN: boards of timeline ${li} must be consecutive`)
    }
    const tl: ITimeline = {
      li,
      startT: list[0].t,
      boards: list.map((b) => ({ li, t: b.t, cells: b.cells, pub: null })),
      branchedFrom: null,
      createdBy: null,
    }
    mv.addTimeline(tl)
  }
  return mv
}
