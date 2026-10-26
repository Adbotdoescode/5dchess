// Contract between the app/UI layer and the Three.js multiverse renderer.
// The renderer is a "dumb" view: the app hands it a RenderModel and receives
// input events back. It never imports the rules engine (only engine types).

import type { Color, MultiverseSnapshot, Pos, Check } from '../engine/types'

export type ArrowKind =
  /** Submitted move on the last turn (blue/purple travel arrow in the game). */
  | 'last-move'
  /** Tentative move in the current action. */
  | 'pending'
  /** Red arrow: a piece attacking a royal piece. */
  | 'check'

export interface BoardArrow {
  from: Pos
  to: Pos
  kind: ArrowKind
}

export type SquareHighlight =
  /** Yellow: a piece moved here/from here on that board's last move. */
  | 'moved'
  /** Blue: time-travel departure/arrival square. */
  | 'travel'
  /** Selected piece. */
  | 'selected'
  /** Green: a legal destination for the selected piece. */
  | 'destination'
  /** Green, darker: destination that is a capture. */
  | 'capture'
  /** Red tint: a royal piece in check. */
  | 'check'
  /** Hover preview. */
  | 'hover'

export interface HighlightedSquare {
  pos: Pos
  kind: SquareHighlight
}

/** Which boards to fade, mirroring the in-game toggles. */
export type ViewFilter =
  /** Everything at full opacity. */
  | 'all'
  /** "History View": fade boards of the opponent's color (only show boards `forColor` could move on/into). */
  | 'history'
  /** "Parallel View": show only boards at the same half-turn parity as the selected piece's board, packed. */
  | 'parallel'

export interface RenderModel {
  snapshot: MultiverseSnapshot
  /** Which side is at the bottom ("Flip Persp." toggles this). */
  perspective: Color
  highlights: HighlightedSquare[]
  arrows: BoardArrow[]
  checks: Check[]
  /** Boards with a tentative move this action (blue border), keyed "l:t". */
  pendingBoards: string[]
  /** Board that must still be moved on (pulsing border), keyed "l:t". */
  requiredBoards: string[]
  viewFilter: ViewFilter
  /** Color used for the view filter, normally the local player. */
  filterColor: Color
  /** Animate travel/board creation. */
  animations: boolean
  /** 2D top-down (default) or tilted 3D camera. */
  cameraMode: '2d' | '3d'
  /** Optional background tint: darker once the game is over (as in the original). Default 'default'. */
  background?: 'default' | 'ended'
}

export interface RendererEvents {
  /** Primary click/tap on a square of an existing board. */
  onSquareClick?(pos: Pos): void
  /** Pointer moved onto a square (null when leaving all boards). */
  onSquareHover?(pos: Pos | null): void
  /** Click on empty space (deselect). */
  onBackgroundClick?(): void
}

export interface MultiverseRenderer {
  /** Replace the displayed model; renderer diffs and animates as needed. */
  setModel(model: RenderModel): void
  /** Smoothly pan the camera to centre a board. */
  focusBoard(l: number, t: number): void
  /** Pan/zoom so the present and all active timelines are visible. */
  focusPresent(): void
  setEvents(events: RendererEvents): void
  /**
   * Optional: CSS pixel position (relative to the container's top-left) of the
   * centre of a square, or null if that board is not displayed. Useful for
   * anchoring DOM popups (e.g. a promotion picker) to a square.
   */
  projectSquare?(pos: Pos): { x: number; y: number } | null
  /** Optional: pan the camera by a screen-space offset in CSS pixels (keyboard panning). */
  panBy?(dxPx: number, dyPx: number): void
  /** Optional: zoom by `factor` (>1 zooms in) around the viewport centre (keyboard zoom). */
  zoomBy?(factor: number): void
  /** Must be called when the container resizes (renderer may also observe itself). */
  resize(): void
  dispose(): void
}

/** Factory signature implemented in ./index.ts */
export type CreateRenderer = (container: HTMLElement) => MultiverseRenderer
