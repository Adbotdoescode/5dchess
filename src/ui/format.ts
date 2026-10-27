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

const RAW_NETWORK = /failed to fetch|networkerror|network ?request failed|load failed|fetch failed|ECONN|ERR_[A-Z_]+|socket hang up|timed? ?out/i
const TECHNICAL = /^[A-Za-z]*Error\b|\bat \w+ \(|[{}]|\bfailed \(\d{3}\)|status \d{3}|\bundefined\b|JSON|Unexpected token|^[a-z]/

/**
 * A player-facing message for an error from the network layer. Raw text
 * ("TypeError: Failed to fetch", "out of sync: expected index 1", ...) belongs in
 * the console, not in a toast; messages the session already words for players
 * pass through.
 */
export function friendlyError(raw: string): string {
  const m = (raw || '').trim()
  if (!m) return 'Something went wrong — please try again'
  if (RAW_NETWORK.test(m)) return 'Connection lost — retrying…'
  if (/out of sync/i.test(m)) return 'Game updated from another tab'
  if (!TECHNICAL.test(m)) return m
  if (/not your turn/i.test(m)) return "It's not your turn"
  if (/game is over|already over/i.test(m)) return 'The game is already over'
  if (/cancelled/i.test(m)) return 'This game was cancelled'
  if (/not found/i.test(m)) return 'Game not found'
  if (/full/i.test(m)) return 'That game is full'
  if (/illegal|invalid|malformed/i.test(m)) return 'The server rejected that move'
  if (/network|offline/i.test(m)) return 'Connection lost — retrying…'
  return 'Something went wrong — please try again'
}
