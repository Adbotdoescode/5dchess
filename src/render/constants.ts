// Visual constants for the multiverse renderer.
//
// World units: one board slot (one half-turn column) is 1 unit wide and one
// timeline row is 1 unit tall. All proportions and colours below were measured
// from screenshots of the original game (1920x1080, where one slot = 203 px).

/** Horizontal distance between consecutive half-turn columns. */
export const SLOT = 1
/** Vertical distance between timelines. */
export const ROW = 1

/** Side length of the square area of an 8x8 board (156 px / 203 px). */
export const BOARD_INNER = 0.768
/** Frame width of ordinary (non-end) boards. */
export const FRAME_THIN = 0.016
/** Frame width of a timeline's end board. */
export const FRAME_THICK = 0.057
/** Darker/lighter outline drawn around thick frames. */
export const FRAME_RIM = 0.0075
export const CORNER_THIN = 0.006
export const CORNER_THICK = 0.034

/** Shadow offsets (world units, y up): boards cast the longest shadow. */
export const BOARD_SHADOW = { x: -0.098, y: -0.074 }
export const BAND_SHADOW = { x: -0.033, y: -0.025 }
export const BAR_SHADOW = { x: -0.034, y: 0 }

/** Timeline band ("arrow") geometry. */
export const BAND_HALF = 0.131
export const BAND_RIM = 0.0075
/** Arrowhead base and tip, measured from the end board's centre. */
export const HEAD_BASE = 0.7
export const HEAD_TIP = 1.0
export const HEAD_HALF = 0.256
/** Corner radius of the branch curve (centre line). */
export const BRANCH_RADIUS = 0.3
/** How far left of the first board a starting timeline's band begins. */
export const BAND_LEAD = 3

/** "The Present" bar. */
export const BAR_WIDTH = 0.62
export const BAR_EDGE = 0.02
/** Gap between repeats of the "The Present" text in open stretches of the bar (rows). */
export const BAR_TEXT_GAP = 1.5
/** Clearance between the text and a marker's edge (01.png: ~0.32 rows) or a board. */
export const LABEL_MARGIN_MARKER = 0.32
export const LABEL_MARGIN_BOARD = 0.12
export const BAR_TEXT_SIZE = 0.56

/** Present markers (where the next timeline of each colour appears). */
export const MARKER_RADIUS = 0.148
export const MARKER_RIM = 0.018

/** Move arrows, as fractions of one square. */
export const ARROW_HALF = 0.11
export const ARROW_OUTLINE = 0.05
export const ARROW_HEAD_LEN = 0.7
export const ARROW_HEAD_HALF = 0.42

export const COLORS = {
  bgLight: '#c8c8c3',
  bgDark: '#c0c0bb',
  shadow: '#383838',

  squareLight: '#fad4a4',
  squareDark: '#d3a973',

  frameWhiteThin: '#f4f5ed',
  frameWhiteBody: '#e1e2d8',
  frameWhiteRim: '#f4f5ed',
  frameBlackThin: '#272727',
  frameBlackBody: '#40404a',
  frameBlackRim: '#272727',
  framePendingBody: '#8b86db',
  framePendingRim: '#756ade',
  frameCheckBody: '#d46950',
  frameCheckRim: '#b8543d',

  bandActive: '#9971a9',
  bandActiveRim: '#845d9c',
  bandWhite: '#e1e2d8',
  bandWhiteRim: '#f4f5ed',
  bandBlack: '#40404a',
  bandBlackRim: '#272727',

  barLight: '#e1e2d8',
  barLightEdge: '#f4f5ed',
  barLightText: '#272727',
  barDark: '#3a3a44',
  barDarkEdge: '#272727',
  barDarkText: '#f4f5ed',

  markerWhiteFill: '#e1e2d8',
  markerWhiteRim: '#f4f5ed',
  markerBlackFill: '#40404a',
  markerBlackRim: '#272727',

  arrowMove: '#9690df',
  arrowPending: '#8b84e6',
  arrowCheck: '#d46b54',
  arrowOutline: '#f4f5ed',

  // Square highlights: [on light square, on dark square]
  moved: ['#edde7c', '#dcce60'],
  travel: ['#9e99e2', '#928de0'],
  selected: ['#9db070', '#8aa063'],
  destination: ['#95aa6a', '#859c60'],
  capture: ['#86a05e', '#7a9356'],
  check: ['#ec8a6c', '#dc775b'],
} as const

/** History View fade (measured from 04.png): white veil over frame and squares, piece opacity. */
export const FADE_FRAME = 0.68
export const FADE_SQUARES = 0.56
export const FADE_PIECES = 0.3
