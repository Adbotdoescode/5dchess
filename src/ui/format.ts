import type { Color, GameResult } from '../engine'
import { VARIANTS } from '../engine'

export const colorName = (c: Color) => (c === 'white' ? 'White' : 'Black')
const other = (c: Color): Color => (c === 'white' ? 'black' : 'white')

export function variantName(id: string): string {
  return VARIANTS.find((v) => v.id === id)?.name ?? id
}

/** Headline + detail for the game-over card. */
export function resultText(r: GameResult): { title: string; detail: string } {
  switch (r.kind) {
    case 'checkmate':
      return { title: 'Checkmate', detail: `${colorName(r.winner)} wins` }
    case 'stalemate':
      return { title: 'Stalemate', detail: 'The game is a draw' }
    case 'draw-agreed':
      return { title: 'Draw by agreement', detail: 'The game is a draw' }
    case 'resignation':
      return { title: `${colorName(other(r.winner))} resigned`, detail: `${colorName(r.winner)} wins` }
    case 'timeout':
      return { title: `${colorName(other(r.winner))} lost on time`, detail: `${colorName(r.winner)} wins` }
    default:
      return { title: '', detail: '' }
  }
}

/** The original's bottom-left line: "Game ended - Black wins" / "Game ended - Draw". */
export function gameEndedLine(r: GameResult): string {
  if (r.kind === 'ongoing') return ''
  if (r.kind === 'stalemate' || r.kind === 'draw-agreed') return 'Game ended - Draw'
  return `Game ended - ${colorName(r.winner)} wins`
}

/** "You win!" / "You lose" / "Draw" for a seated online player. */
export function youLine(r: GameResult, me: Color): string {
  if (r.kind === 'ongoing') return ''
  if (r.kind === 'stalemate' || r.kind === 'draw-agreed') return 'Draw'
  return r.winner === me ? 'You win!' : 'You lose'
}

export function timeAgo(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return `${Math.floor(s / 86400)} d ago`
}
