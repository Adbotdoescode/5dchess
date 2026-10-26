// Fairy pieces of 5D Chess drawn in the cburnett style (45x45 viewBox,
// 1.5 stroke, white fill / black fill with white detail lines).
// Unicorn, dragon, princess, common king and royal queen reuse outlines from
// the cburnett set (BSD option, (c) Colin M.L. Burnett) with new additions;
// the brawn is an original drawing. See ./README.md.

type Col = 'w' | 'b'

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="45" height="45" viewBox="0 0 45 45">${body}</svg>`

const fill = (c: Col) => (c === 'w' ? '#ffffff' : '#000000')
/** Colour of interior detail lines. */
const detail = (c: Col) => (c === 'w' ? '#000000' : '#ffffff')

// --- knight outline (cburnett) used by unicorn and dragon -------------------
const KNIGHT_BACK = 'M 22,10 C 32.5,11 38.5,18 38,39 L 15,39 C 15,30 25,32.5 23,18'
const KNIGHT_HEAD =
  'M 24,18 C 24.38,20.91 18.45,25.37 16,27 C 13,29 13.18,31.34 11,31 C 9.958,30.06 12.41,27.96 11,28 C 10,28 11.19,29.23 10,30 C 9,30 5.997,31 6,26 C 6,24 12,14 12,14 C 12,14 13.89,12.1 14,10.5 C 13.27,9.506 13.5,8.5 13.5,7.5 C 14.5,6.5 16.5,10 16.5,10 L 18.5,10 C 18.5,10 19.28,8.008 21,7 C 22,7 22,10 22,10'
const KNIGHT_EYE = 'M 15 15.5 A 0.5 1.5 0 1 1  14,15.5 A 0.5 1.5 0 1 1  15 15.5 z'
const KNIGHT_NOSTRIL = 'M 9.5 25.5 A 0.5 0.5 0 1 1 8.5,25.5 A 0.5 0.5 0 1 1 9.5 25.5 z'

const knightBase = (c: Col, extraBehind: string, extraFront: string) => `
<g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,0.3)">
  ${extraBehind}
  <path d="${KNIGHT_BACK}" fill="${fill(c)}"/>
  <path d="${KNIGHT_HEAD}" fill="${fill(c)}"/>
  <path d="${KNIGHT_NOSTRIL}" fill="${detail(c)}" stroke="${detail(c)}"/>
  <path d="${KNIGHT_EYE}" transform="matrix(0.866,0.5,-0.5,0.866,9.693,-5.173)" fill="${detail(c)}" stroke="${detail(c)}"/>
  ${c === 'b' ? '<path d="M 24.55,10.4 L 24.1,11.85 L 24.6,12 C 27.75,13 30.25,14.49 32.5,18.75 C 34.75,23.01 35.75,29.06 35.25,39 L 35.2,39.5 L 37.45,39.5 L 37.5,39 C 38,28.94 36.62,22.15 34.25,17.66 C 31.88,13.17 28.46,11.02 25.06,10.5 L 24.55,10.4 z" fill="#fff" stroke="none"/>' : ''}
  ${extraFront}
</g>`

function unicorn(c: Col): string {
  // long spiral horn rising from the forehead
  const horn = `<path d="M 12.2,12.6 L 4.2,2.6 L 15.6,10.2 z" fill="${fill(c)}" stroke="#000" stroke-linejoin="round"/>`
  const spiral = `<path d="M 8.3,6.1 L 10.2,5.2 M 10.4,8.6 L 12.5,7.3 M 12.2,11.0 L 14.2,9.4" stroke="${detail(c)}" stroke-width="1" fill="none"/>`
  const mane = `<path d="M 25.5,13.5 C 28,15 29.5,17 30.5,20 M 27,21 C 28.5,24 29,27 29,30" stroke="${detail(c)}" stroke-width="1" fill="none"/>`
  return svg(knightBase(c, '', horn + spiral + mane))
}

function dragon(c: Col): string {
  // dorsal spikes behind the neck, two short horns and a forked tongue
  const spikes = `<path d="M 26,10.6 L 30.5,5.5 L 30.6,12.2 L 35.8,9.6 L 34.2,16.2 L 40.2,15.5 L 36.8,22 L 41.8,23.5 L 37.8,28.5 z" fill="${fill(c)}" stroke="#000" stroke-linejoin="round"/>`
  const horns = `<path d="M 15.6,9.6 L 14.2,3.2 L 18.4,8.6 M 19.6,8.4 L 20.2,2.6 L 22,8.8" fill="${fill(c)}" stroke="#000" stroke-linejoin="round"/>`
  const tongue = `<path d="M 7,28.5 L 3.2,30.4 M 5,29.5 L 3.6,27.6" stroke="#000" stroke-width="1.2" fill="none"/>`
  const scales = `<path d="M 30,24 C 31.5,25 32.5,26.5 33,28.5 M 31,31 C 32.5,32 33.5,33.5 34,35.5 M 27.5,17 C 29,18 30,19.5 30.6,21.5" stroke="${detail(c)}" stroke-width="1" fill="none"/>`
  return svg(knightBase(c, spikes + horns, tongue + scales))
}

function princess(c: Col): string {
  // rook base and tower with a bishop's mitre on top
  const f = fill(c)
  const d = detail(c)
  return svg(`
<g fill="${f}" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(0,0.3)">
  <path d="M 9,39 L 36,39 L 36,36 L 9,36 z" stroke-linecap="butt"/>
  <path d="M 12,36 L 12,32 L 33,32 L 33,36 z" stroke-linecap="butt"/>
  <path d="M 12.5,32 L 14,29.5 L 31,29.5 L 32.5,32 z" stroke-linecap="butt"/>
  <path d="M 14,29.5 L 14,21 C 14,16 18,12.5 22.5,9.5 C 27,12.5 31,16 31,21 L 31,29.5 z"/>
  <circle cx="22.5" cy="7" r="2.5"/>
  <path d="M 22.5,14.5 L 22.5,21.5 M 19,18 L 26,18" fill="none" stroke="${d}" stroke-linejoin="miter"/>
  <path d="M 14,24.5 L 31,24.5" fill="none" stroke="${d}" stroke-width="1"/>
  ${c === 'b' ? '<path d="M 12,35.5 L 33,35.5 M 13,31.5 L 32,31.5 M 14,29.5 L 31,29.5" fill="none" stroke="#fff" stroke-width="1"/>' : ''}
</g>`)
}

function brawn(c: Col): string {
  // a broad-shouldered pawn
  const f = fill(c)
  const d = detail(c)
  return svg(`
<g fill="${f}" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M 11,39.5 C 11,33 14,29.5 17.5,28 C 15.5,27 14.5,25.5 14.5,24 L 14.5,21.5 L 30.5,21.5 L 30.5,24 C 30.5,25.5 29.5,27 27.5,28 C 31,29.5 34,33 34,39.5 z"/>
  <path d="M 12,21.5 C 12,18.5 15,17.5 18.6,17.5 L 26.4,17.5 C 30,17.5 33,18.5 33,21.5 z"/>
  <circle cx="22.5" cy="12" r="5"/>
  <path d="M 18.5,24.5 L 26.5,24.5" fill="none" stroke="${d}" stroke-width="1"/>
  <path d="M 16,33.5 L 29,33.5" fill="none" stroke="${d}" stroke-width="1"/>
</g>`)
}

function commonKing(c: Col): string {
  // cburnett king with a ring instead of the cross: a non-royal king
  const f = fill(c)
  const d = detail(c)
  return svg(`
<g fill="none" fill-rule="evenodd" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="22.5" cy="7.6" r="2.6" fill="${f}"/>
  <path d="M 22.5,25 C 22.5,25 27,17.5 25.5,14.5 C 25.5,14.5 24.5,12 22.5,12 C 20.5,12 19.5,14.5 19.5,14.5 C 18,17.5 22.5,25 22.5,25" fill="${f}" stroke-linecap="butt" stroke-linejoin="miter"/>
  <path d="M 12.5,37 C 18,40.5 27,40.5 32.5,37 L 32.5,30 C 32.5,30 41.5,25.5 38.5,19.5 C 34.5,13 25,16 22.5,23.5 L 22.5,27 L 22.5,23.5 C 20,16 10.5,13 6.5,19.5 C 3.5,25.5 12.5,30 12.5,30 L 12.5,37" fill="${f}"/>
  ${c === 'b' ? '<path d="M 32,29.5 C 32,29.5 40.5,25.5 38.03,19.85 C 34.15,14 25,18 22.5,24.5 L 22.5,26.6 L 22.5,24.5 C 20,18 10.85,14 6.97,19.85 C 4.5,25.5 13,29.5 13,29.5" stroke="#fff"/>' : ''}
  <path d="M 12.5,30 C 18,27 27,27 32.5,30 M 12.5,33.5 C 18,30.5 27,30.5 32.5,33.5 M 12.5,37 C 18,34 27,34 32.5,37" stroke="${d}"/>
</g>`)
}

function royalQueen(c: Col): string {
  // cburnett queen whose centre point carries the king's cross: a royal queen
  const f = fill(c)
  const d = detail(c)
  return svg(`
<g fill="${f}" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
  <path d="M 9,26 C 17.5,24.5 30,24.5 36,26 L 38.5,13.5 L 31,25 L 30.7,10.9 L 25.5,24.5 L 22.5,10 L 19.5,24.5 L 14.3,10.9 L 14,25 L 6.5,13.5 L 9,26 z"/>
  <path d="M 9,26 C 9,28 10.5,28 11.5,30 C 12.5,31.5 12.5,31 12,33.5 C 10.5,34.5 11,36 11,36 C 9.5,37.5 11,38.5 11,38.5 C 17.5,39.5 27.5,39.5 34,38.5 C 34,38.5 35.5,37.5 34,36 C 34,36 34.5,34.5 33,33.5 C 32.5,31 32.5,31.5 33.5,30 C 34.5,28 36,28 36,26 C 27.5,24.5 17.5,24.5 9,26 z"/>
  <path d="M 11.5,30 C 15,29 30,29 33.5,30 M 12,33.5 C 18,32.5 27,32.5 33,33.5" fill="none" stroke="${d}"/>
  <circle cx="6" cy="12" r="2"/>
  <circle cx="14" cy="9" r="2"/>
  <circle cx="31" cy="9" r="2"/>
  <circle cx="39" cy="12" r="2"/>
  <path d="M 22.5,10 L 22.5,2.5 M 19.5,5 L 25.5,5" fill="none" stroke="#000" stroke-linejoin="miter"/>
</g>`)
}

export const FAIRY: Record<string, string> = {
  wU: unicorn('w'),
  bU: unicorn('b'),
  wD: dragon('w'),
  bD: dragon('b'),
  wS: princess('w'),
  bS: princess('b'),
  wW: brawn('w'),
  bW: brawn('b'),
  wC: commonKing('w'),
  bC: commonKing('b'),
  wY: royalQueen('w'),
  bY: royalQueen('b'),
}
