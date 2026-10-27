// Contract between the app/UI layer and the Three.js multiverse renderer.
// The renderer is a "dumb" view: the app hands it a RenderModel and receives
// input events back. It never imports the rules engine (only engine types).

import type { Color, MultiverseSnapshot, Pos, Check } from '../engine/types'

/**
 * Camera view, as the original's right-edge tabs: the flat top-down view, or one of
 * the two animated 3D views (boards stand up like cards on raised tracks).
 */
export type ViewMode = '2d' | 'history' | 'parallel'

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

/** Which boards to fade (independent of the camera view, see ViewMode). */
export type ViewFilter =
  /** Everything at full opacity. */
  | 'all'
  /** Fade boards of the opponent's color (a piece is selected: only boards `filterColor` can move on/into stay). */
  | 'history'
  /** Legacy: show only boards at the half-turn parity of `filterColor`, packed into full-turn columns. */
  | 'parallel'

/**
 * One move to animate: the piece glides from `from` to `to` while the boards the move
 * created slide out from behind their predecessors (time-travel moves fly along the
 * move arrow between boards).
 */
export interface PieceMotion {
  /** Square the piece leaves, on the board it moved from (before the move). */
  from: Pos
  /** Square it lands on, on the board it moved to (before the move). */
  to: Pos
  /** Board created on the source timeline (from.l, from.t + 1). */
  fromBoard: { l: number; t: number }
  /** Board created by the arrival of a time-travel / cross-timeline move (absent for spatial moves). */
  toBoard?: { l: number; t: number }
}

/** A batch of moves to animate once (identified by `id`). */
export interface MotionBatch {
  /** Changes whenever there is something new to animate; a batch is played once. */
  id: number
  moves: PieceMotion[]
  /** Undo: play the moves backwards (the boards they created are already gone from the model). */
  reverse?: boolean
}

export interface RenderModel {
  snapshot: MultiverseSnapshot
  /** Which side is at the bottom ("Flip Persp." toggles this). */
  perspective: Color
  highlights: HighlightedSquare[]
  arrows: BoardArrow[]
  checks: Check[]
  /** Boards with a tentative move this action (blue border), keyed "l:t". */
  pendingBoards: string[]
  /**
   * Optional: what kind of tentative move created each pending board (keyed "l:t").
   * 'move' boards get the original's yellow frame, 'travel' (time-travel / cross-board
   * departure or arrival) the blue-violet one. Boards missing here use blue-violet.
   */
  pendingBoardKinds?: Record<string, 'move' | 'travel'>
  /** Board that must still be moved on (pulsing border), keyed "l:t". */
  requiredBoards: string[]
  viewFilter: ViewFilter
  /** Color used for the view filter, normally the local player. */
  filterColor: Color
  /** Animate travel/board creation. */
  animations: boolean
  /**
   * Camera view (default '2d'). Changing it animates the camera (and the boards standing
   * up / lying down) into the new view, as the original's History / Parallel View tabs.
   */
  viewMode?: ViewMode
  /** @deprecated Use `viewMode`. '3d' maps to 'parallel' when `viewMode` is absent. */
  cameraMode?: '2d' | '3d'
  /** Optional: moves to animate (piece glides, board slides); see MotionBatch. */
  motion?: MotionBatch
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

/** Screen-space margins (CSS px) covered by HUD elements along each edge of the view. */
export interface ViewInsets {
  top: number
  right: number
  bottom: number
  left: number
}

/** A screen rectangle in CSS px, relative to the container's top-left. */
export interface ScreenRect {
  x: number
  y: number
  w: number
  h: number
}

/** Where the app's HUD sits on top of the view. */
export interface HudLayout {
  /** Framing (focusPresent / focusBoard) keeps boards out of these margins. */
  insets: ViewInsets
  /** Legacy: screen areas covered by HUD text (labels are now world-anchored, as in the original). */
  avoid?: ScreenRect[]
}

/** The camera as it is right now (see MultiverseRenderer.getView). */
export interface ViewState {
  /** View the camera rests in or is moving to. */
  mode: ViewMode
  /** True while moving between views. */
  transitioning: boolean
  /** Camera target on the floor (world units) and zoom (CSS px per world unit). */
  cx: number
  cy: number
  zoom: number
  /** Camera elevation above the floor and look direction (radians; 2D: PI/2 and PI/2). */
  elevation: number
  azimuth: number
  /** View size in CSS px. */
  width: number
  height: number
  /** Column-major 4x4 view-projection matrix (world -> clip space), orthographic. */
  viewProjection: number[]
}

export interface MultiverseRenderer {
  /** Replace the displayed model; renderer diffs and animates as needed. */
  setModel(model: RenderModel): void
  /** Smoothly pan the camera to centre a board (`instant`: jump there). */
  focusBoard(l: number, t: number, opts?: { instant?: boolean }): void
  /** Pan/zoom so the present and all active timelines are visible. */
  focusPresent(): void
  /**
   * Optional: ease the camera just enough (pan first, zoom out only if needed) to keep the
   * boards the player must move on next comfortably in view. Gentler than focusPresent.
   */
  followPresent?(): void
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
  /** Optional: tell the renderer which screen areas the HUD covers (see HudLayout). */
  setHud?(hud: HudLayout): void
  /** Optional: the current camera (e.g. for a full-screen overlay that takes over for a while). */
  getView?(): ViewState
  /**
   * Optional: pause (false) / resume (true) pointer and wheel input on the view, e.g. while
   * an overlay plays. Paused input is ignored (no clicks, hover, pan or zoom).
   */
  setInputEnabled?(enabled: boolean): void
  /** Must be called when the container resizes (renderer may also observe itself). */
  resize(): void
  dispose(): void
}

/** Factory signature implemented in ./index.ts */
export type CreateRenderer = (container: HTMLElement) => MultiverseRenderer
