// Variants of "5D Chess With Multiverse Time Travel" (all 45 of the current
// game, excluding "Random" and the puzzles), as 5DFEN board strings.
//
// Sources: the 5D PGN reference table of built-in boards (adri326/5dchess-notation),
// the 5D chess wiki's variant page, the Steam guide "All Variants Explained" (screenshots
// checked square by square where available) and the reference engine's built-in boards.
// Unmoved markers ('*') are put on every king, rook, pawn and brawn of the starting
// position (pieces that have never moved), which is how the game tracks double steps
// and castling rights.

import type { VariantInfo } from './types'

export interface VariantDef extends VariantInfo {
  width: number
  height: number
  /** 5DFEN board strings of the initial boards. */
  fen: readonly string[]
  /** Other names accepted when importing ("Board" header values). */
  aliases?: readonly string[]
  /** Pieces a pawn/brawn may promote to; the first is the default. The base game always promotes to a queen. */
  promotions?: readonly ('Q' | 'N' | 'R' | 'B' | 'S' | 'U' | 'D' | 'C')[]
}

const STD = 'r*nbqk*bnr*/p*p*p*p*p*p*p*p*/8/8/8/8/P*P*P*P*P*P*P*P*/R*NBQK*BNR*'

export const VARIANTS: VariantDef[] = [
  // --- Standard ---------------------------------------------------------
  {
    id: 'standard', name: 'Standard', category: 'Standard', width: 8, height: 8,
    description: 'A completely ordinary game of 5D Chess.',
    fen: [`[${STD}:0:1:w]`], aliases: ['Standard - Default'],
  },
  {
    id: 'defended_pawn', name: 'Standard - Defended Pawn', category: 'Standard', width: 8, height: 8,
    description: 'Standard pieces with the queen and queenside knight swapped, so every pawn starts defended.',
    fen: ['[r*qbnk*bnr*/p*p*p*p*p*p*p*p*/8/8/8/8/P*P*P*P*P*P*P*P*/R*QBNK*BNR*:0:1:w]'],
  },
  {
    id: 'half_reflected', name: 'Standard - Half Reflected', category: 'Standard', width: 8, height: 8,
    description: "Standard, but Black's king and queen are swapped.",
    fen: ['[r*nbk*qbnr*/p*p*p*p*p*p*p*p*/8/8/8/8/P*P*P*P*P*P*P*P*/R*NBQK*BNR*:0:1:w]'], aliases: ['Misc - Reflected'],
  },
  {
    id: 'princess', name: 'Standard - Princess', category: 'Standard', width: 8, height: 8,
    description: 'The queen is replaced by a princess, which moves like a rook or a bishop. Pawns still promote to queens.',
    fen: ['[r*nbsk*bnr*/p*p*p*p*p*p*p*p*/8/8/8/8/P*P*P*P*P*P*P*P*/R*NBSK*BNR*:0:1:w]'],
  },
  {
    id: 'reversed_royalty', name: 'Standard - Reversed Royalty', category: 'Standard', width: 8, height: 8,
    description: 'The queen is royal (can be checked) and the king is a common king that cannot be checked.',
    fen: ['[r*nbycbnr*/p*p*p*p*p*p*p*p*/8/8/8/8/P*P*P*P*P*P*P*P*/R*NBYCBNR*:0:1:w]'],
  },
  {
    id: 'turn_zero', name: 'Standard - Turn Zero', category: 'Standard', width: 8, height: 8,
    description: 'An extra zeroth turn is already played, so Black can branch on their first turn.',
    fen: [`[${STD}:0:0:b]`, `[${STD}:0:1:w]`],
  },
  {
    id: 'two_timelines', name: 'Standard - Two Timelines', category: 'Standard', width: 8, height: 8,
    description: 'Two standard boards on two initial timelines.',
    fen: [`[${STD}:-0:1:w]`, `[${STD}:+0:1:w]`],
  },
  // --- Very Small ---------------------------------------------------------
  {
    id: 'very_small', name: 'Very Small', category: 'Very Small', width: 4, height: 4,
    description: 'A 4x4 board without any clear space initially.',
    fen: ['[nbr*k*/p*p*p*p*/P*P*P*P*/K*R*BN:0:1:w]'], aliases: ['Misc - Very Small'],
  },
  {
    id: 'very_small_open', name: 'Very Small - Open', category: 'Very Small', width: 4, height: 4,
    description: 'A 4x4 board with a very open initial position.',
    fen: ['[nbr*k*/3p*/P*3/K*R*BN:0:1:w]'], aliases: ['Misc - Very Small Open'],
  },
  // --- Small ----------------------------------------------------------------
  {
    id: 'small', name: 'Small', category: 'Small', width: 5, height: 5,
    description: 'A 5x5 board with fewer pieces; the position is mirrored across the board.',
    fen: ['[k*qbnr*/p*p*p*p*p*/5/P*P*P*P*P*/K*QBNR*:0:1:w]'], aliases: ['Misc - Small'],
  },
  {
    id: 'small_centered', name: 'Small - Centered', category: 'Small', width: 5, height: 5,
    description: 'A 5x5 board with the king in the center of its starting rank.',
    fen: ['[r*nk*qr*/p*p*p*p*p*/5/P*P*P*P*P*/R*QK*NR*:0:1:w]'], aliases: ['Misc - Small Centered'],
  },
  {
    id: 'small_flipped', name: 'Small - Flipped', category: 'Small', width: 5, height: 5,
    description: 'A 5x5 board whose layout is rotated across the board rather than mirrored.',
    fen: ['[nbr*qk*/p*p*p*p*p*/5/P*P*P*P*P*/K*QR*BN:0:1:w]'], aliases: ['Misc - Small Flipped'],
  },
  {
    id: 'small_open', name: 'Small - Open', category: 'Small', width: 5, height: 5,
    description: 'A 5x5 board with fewer pawns; the front ranks are open to attack.',
    fen: ['[p*r*nbk*/3p*p*/5/P*P*3/K*BNR*P*:0:1:w]'], aliases: ['Misc - Small Open'],
  },
  // --- Simple ---------------------------------------------------------------
  {
    id: 'simple_no_bishops', name: 'Simple - No Bishops', category: 'Simple', width: 6, height: 6,
    description: 'A 6x6 board without bishops.',
    fen: ['[r*nqk*nr*/p*p*p*p*p*p*/6/6/P*P*P*P*P*P*/R*NQK*NR*:0:1:w]'],
  },
  {
    id: 'simple_no_knights', name: 'Simple - No Knights', category: 'Simple', width: 6, height: 6,
    description: 'A 6x6 board without knights.',
    fen: ['[r*bqk*br*/p*p*p*p*p*p*/6/6/P*P*P*P*P*P*/R*BQK*BR*:0:1:w]'],
  },
  {
    id: 'simple_no_queens', name: 'Simple - No Queens', category: 'Simple', width: 7, height: 7,
    description: 'A 7x7 board without queens.',
    fen: ['[r*nbk*nbr*/p*p*p*p*p*p*p*/7/7/7/P*P*P*P*P*P*P*/R*NBK*NBR*:0:1:w]'],
  },
  {
    id: 'simple_no_rooks', name: 'Simple - No Rooks', category: 'Simple', width: 6, height: 6,
    description: 'A 6x6 board without rooks.',
    fen: ['[nbqk*bn/p*p*p*p*p*p*/6/6/P*P*P*P*P*P*/NBQK*BN:0:1:w]'],
  },
  {
    id: 'simple_knights_vs_bishops', name: 'Simple - Knights vs. Bishops', category: 'Simple', width: 6, height: 6,
    description: 'A 6x6 board where White has two knights and Black has two bishops.',
    fen: ['[r*bqk*br*/p*p*p*p*p*p*/6/6/P*P*P*P*P*P*/R*NQK*NR*:0:1:w]'], aliases: ['Simple - Knights vs. Bishop', 'Simple - Knights vs Bishops'],
  },
  {
    id: 'simple_set', name: 'Simple - Simple Set', category: 'Simple', width: 6, height: 6,
    description: 'A 6x6 board with a simplified set of pieces.',
    fen: ['[r*nbqk*r*/p*p*p*p*p*p*/6/6/P*P*P*P*P*P*/R*K*QBNR*:0:1:w]'],
  },
  // --- Focused --------------------------------------------------------------
  {
    id: 'focused_just_bishops', name: 'Focused - Just Bishops', category: 'Focused', width: 5, height: 5,
    description: 'Two bishops and a king per side.',
    fen: ['[1bbk*1/5/5/5/1K*BB1:0:1:w]'],
  },
  {
    id: 'focused_just_brawns', name: 'Focused - Just Brawns', category: 'Focused', width: 5, height: 5,
    description: 'Four brawns and a king per side.',
    fen: ['[w*w*w*w*k*/5/5/5/K*W*W*W*W*:0:1:w]'],
  },
  {
    id: 'focused_just_dragons', name: 'Focused - Just Dragons', category: 'Focused', width: 5, height: 5,
    description: 'Two dragons and a king per side; expect many branching timelines.',
    fen: ['[2ddk*/5/5/5/K*DD2:0:1:w]'],
  },
  {
    id: 'focused_just_kings', name: 'Focused - Just Kings', category: 'Focused', width: 3, height: 3,
    description: 'Only kings. Win by checkmating a king in the past or leaving the opponent without moves.',
    fen: ['[2k*/3/K*2:0:1:w]'],
  },
  {
    id: 'focused_just_knights', name: 'Focused - Just Knights', category: 'Focused', width: 5, height: 5,
    description: 'Two knights and a king per side.',
    fen: ['[n1k*n1/5/5/5/1NK*1N:0:1:w]'],
  },
  {
    id: 'focused_just_pawns', name: 'Focused - Just Pawns', category: 'Focused', width: 5, height: 5,
    description: 'Four pawns and a king per side.',
    fen: ['[p*p*p*p*k*/5/5/5/K*P*P*P*P*:0:1:w]'],
  },
  {
    id: 'focused_just_queens', name: 'Focused - Just Queens', category: 'Focused', width: 6, height: 6,
    description: 'A queen and a king per side.',
    fen: ['[1q1k*2/6/6/6/6/2K*1Q1:0:1:w]'],
  },
  {
    id: 'focused_just_rooks', name: 'Focused - Just Rooks', category: 'Focused', width: 5, height: 5,
    description: 'Two rooks and a king per side.',
    fen: ['[1r*k*1r*/5/5/5/R*1K*R*1:0:1:w]'],
  },
  {
    id: 'focused_just_unicorns', name: 'Focused - Just Unicorns', category: 'Focused', width: 5, height: 5,
    description: 'Two unicorns and a king per side; expect many branching timelines.',
    fen: ['[1u1uk*/5/5/5/K*U1U1:0:1:w]'],
  },
  // --- Misc -----------------------------------------------------------------
  {
    id: 'misc_excessive', name: 'Misc - Excessive', category: 'Misc', width: 7, height: 7,
    description: 'A crowded 7x7 board with unicorns, dragons and three kings per side.',
    fen: ['[k*r*uqdr*k*/r*nbk*nbr*/p*p*p*p*p*p*p*/7/P*P*P*P*P*P*P*/R*NBK*NBR*/K*R*UQDR*K*:0:1:w]'],
  },
  {
    id: 'misc_global_warming', name: 'Misc - Global Warming', category: 'Misc', width: 1, height: 1,
    description: 'Almost all of the board has been reclaimed by the surrounding grey. There are no winners, only losers.',
    fen: ['[1:0:1:w]'], aliases: ['Misc - Gobal Warming'],
  },
  {
    id: 'misc_king_of_kings', name: 'Misc - King of Kings', category: 'Misc', width: 5, height: 5,
    description: 'One royal king surrounded by common kings.',
    fen: ['[cck*cc/5/5/5/CCK*CC:0:1:w]'],
  },
  {
    id: 'misc_royal_queen_showdown', name: 'Misc - Royal Queen Showdown', category: 'Misc', width: 6, height: 6,
    description: 'A single royal queen per side.',
    fen: ['[4y1/6/6/6/6/1Y4:0:1:w]'],
  },
  {
    id: 'misc_timeline_battleground', name: 'Misc - Timeline Battleground', category: 'Misc', width: 5, height: 5,
    description: 'Armies split across three initial timelines in unique configurations.',
    fen: [
      '[r*r*k*r*r*/bbqbb/p*p*p*p*p*/5/P*P*P*P*P*:-1:1:w]',
      '[nnnnn/p*p*p*p*p*/5/P*P*P*P*P*/NNNNN:0:1:w]',
      '[p*p*p*p*p*/5/P*P*P*P*P*/BBQBB/R*R*K*R*R*:+1:1:w]',
    ],
    aliases: ['Misc - Timeline Battlegrounds'],
  },
  {
    id: 'misc_timeline_formations', name: 'Misc - Timeline Formations', category: 'Misc', width: 5, height: 5,
    description: 'Pawns and kings spread across two initial timelines; each king starts on a different timeline from its pawns.',
    fen: ['[p*p*p*p*p*/5/5/5/2K*2:-0:1:w]', '[2k*2/5/5/5/P*P*P*P*P*:+0:1:w]'],
    aliases: ['Misc - Timeline Formation'],
  },
  {
    id: 'misc_timeline_fragments', name: 'Misc - Timeline Fragments', category: 'Misc', width: 4, height: 4,
    description: 'Two staggered 4x4 timelines with unicorns.',
    fen: ['[k*p*p*p*/4/4/NBR*U:-0:1:b]', '[nbr*u/4/4/K*P*P*P*:+0:1:w]'],
  },
  {
    id: 'misc_timeline_invasion', name: 'Misc - Timeline Invasion', category: 'Misc', width: 5, height: 5,
    description: 'Two 5x5 timelines; White and Black mostly begin on different boards and must invade across timelines.',
    fen: ['[nbk*r*b/p*p*p*p*p*/5/5/P*P*P*P*P*:-0:1:w]', '[p*p*p*p*p*/5/5/P*P*P*P*P*/NBK*R*B:+0:1:w]'],
  },
  {
    id: 'misc_timeline_marauders', name: 'Misc - Timeline Marauders', category: 'Misc', width: 5, height: 5,
    description: 'Brawn armies spread across three initial timelines.',
    fen: [
      '[w*r*k*r*w*/1w*w*w*1/5/5/5:-1:1:w]',
      '[w*1w*1w*/5/5/5/W*1W*1W*:0:1:w]',
      '[5/5/5/1W*W*W*1/W*R*K*R*W*:+1:1:w]',
    ],
  },
  {
    id: 'misc_timeline_skirmish', name: 'Misc - Timeline Skirmish', category: 'Misc', width: 5, height: 5,
    description: 'Small armies split across two initial timelines.',
    fen: ['[3r*k*/3p*p*/5/BB3/NN3:-0:1:w]', '[3nn/3bb/5/P*P*3/K*R*3:+0:1:w]'],
  },
  {
    id: 'misc_timeline_strategos', name: 'Misc - Timeline Strategos', category: 'Misc', width: 5, height: 5,
    description: 'Armies with unicorns split across opposing timelines.',
    fen: ['[nbk*ur*/p*p*p*p*p*/5/5/5:-0:1:w]', '[5/5/5/P*P*P*P*P*/R*UK*BN:+0:1:w]'],
  },
  {
    id: 'misc_timeline_tactician', name: 'Misc - Timeline Tactician', category: 'Misc', width: 4, height: 4,
    description: 'Small armies split across opposing timelines, with no opposing pieces on either starting board.',
    fen: ['[k*bnr*/p*p*p*p*/4/4:-0:1:w]', '[4/4/P*P*P*P*/K*BNR*:+0:1:w]'],
    aliases: ['Misc - Timeline Tactitian'],
  },
  // --- Checkmate Practice ---------------------------------------------------
  {
    id: 'checkmate_practice_bishop', name: 'Checkmate Practice - Bishop', category: 'Checkmate Practice', width: 6, height: 6,
    description: 'A lone white king against a black bishop.',
    fen: ['[4b1/6/6/6/6/K*5:0:1:w]'],
  },
  {
    id: 'checkmate_practice_knight', name: 'Checkmate Practice - Knight', category: 'Checkmate Practice', width: 6, height: 6,
    description: 'A lone white king against a black knight.',
    fen: ['[5n/6/6/6/6/K*5:0:1:w]'],
  },
  {
    id: 'checkmate_practice_pawns', name: 'Checkmate Practice - Pawns', category: 'Checkmate Practice', width: 6, height: 6,
    description: 'A lone white king against three black pawns.',
    fen: ['[2p*p*p*1/6/6/6/6/3K*2:0:1:w]'],
  },
  {
    id: 'checkmate_practice_queen', name: 'Checkmate Practice - Queen', category: 'Checkmate Practice', width: 6, height: 6,
    description: 'A lone white king against a black queen.',
    fen: ['[4q1/6/6/6/6/K*5:0:1:w]'],
  },
  {
    id: 'checkmate_practice_rook', name: 'Checkmate Practice - Rook', category: 'Checkmate Practice', width: 6, height: 6,
    description: 'A lone white king against a black rook.',
    fen: ['[5r/6/6/6/6/K*5:0:1:w]'],
  },
]

const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Find a variant by id, display name or alias (case/punctuation-insensitive). */
export function findVariant(nameOrId: string): VariantDef | undefined {
  const n = norm(nameOrId)
  for (const v of VARIANTS) {
    if (norm(v.id) === n || norm(v.name) === n) return v
    if (v.aliases?.some((a) => norm(a) === n)) return v
  }
  // Short names used by the reference engine and loose matches ("Princess", "Turn Zero").
  for (const v of VARIANTS) {
    if (norm(v.name.replace(/^Standard - /, '')) === n) return v
  }
  return undefined
}
