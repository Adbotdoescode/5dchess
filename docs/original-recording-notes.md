# Notes from the owner's screen recording of the original game

Source: a 77 s, 1920×1080, 75 fps screen recording of the real game (macOS), made by the project owner to show what our version gets wrong. Original file: `~/Desktop/5dchessdemo.mov` on the owner's machine (not in the repo). These notes are **primary evidence** and override docs/ui-spec.md where they conflict.

Out of scope (owner's instruction): the full-screen blue "vortex" time-travel animation that plays the first time a piece travels back in time (≈ 37–46 s). Don't implement it.

## Timeline of the recording

| Time | What happens |
|---|---|
| 0–6 s | 2D top-down view, standard start, a single board on the Present bar. Wheel zoom out/in, which is smooth. |
| ≈ 6.5 s | **History View** clicked: its right-edge tab turns green and the camera animates (≈ 0.4–0.6 s, ease-out with a soft settle) into the History camera. |
| 7–10 s | In History View: pan and zoom. |
| ≈ 10.5 s | **Parallel View** clicked while in History View. The camera animates directly from History to Parallel; the Parallel tab turns green and History goes back to normal. |
| 12–15 s | Parallel View: hovering a board tints the whole board green. Wheel zoom works in 3D. |
| ≈ 16–19 s | **Flip Persp.** in a 3D view: the screen fades towards dark (≈ 70–85 % darkening) while the camera swings 180° to the other side, then fades back. Flipping again reverses it. |
| 20–32 s | Repeated toggling: clicking the active view's tab again returns to the flat 2D view (animated); clicking the other tab switches views. Only one of History/Parallel is active (green) at a time; neither green = 2D. |
| 32–36 s | Moves in 2D: select a pawn (tan "Deselect ♙" pill, green destination squares), move. The new tentative board slides out from behind the source board to the right; the timeline arrow extends as a translucent grey ghost and turns purple when the board lands. The camera eases to follow. The Undo pill turns yellow; Submit turns green-ish when enabled. |
| 36–37 s | Submit: the Present bar slides to the next column and cross-fades light ↔ dark (white ↔ black to move). The opponent's (CPU) reply plays the same slide-in animation. |
| 37–46 s | Knight sent back in time → vortex animation (ignore). The new timeline appears below the main line with the curved purple branch band; the board has a blue (travel) pending frame; a lavender move arrow spans the boards. |
| 46–62 s | More moves with 2–3 timelines; zoomed in close the boards and pieces stay crisp; inactive timeline arrow is light/white. |
| 62–72 s | History View and Parallel View with the larger multiverse (see the descriptions below). |
| 72–77 s | Back to 2D. |

Frame grabs (session scratchpad, may not persist): `.../scratchpad/demo/sheet_01..10.jpg` (2 fps contact sheets, 16 frames per sheet, 8 s per sheet, row-major), `full_<t>.jpg` (full-resolution stills at t seconds: 1.0, 7.5, 11.5, 18.5, 33.5, 41.0, 50.0, 57.5, 65.0, 71.0, 72.0, 76.0), `trans_history.jpg` / `trans_parallel.jpg` / `trans_newboard.jpg` (8 fps transition strips).

## History View (3D camera mode)

Key frames: t = 7.5 s (single board), 65 s (big multiverse).

- Perspective camera, elevated about 35–45° above the floor and yawed so the **time axis runs from the far upper-left (past) towards the viewer at the lower-right (future)**. You look back along history: each timeline's boards recede into the distance, with the present boards closest. Timeline end arrows point towards the viewer (down-right on screen).
- The Present bar runs diagonally from lower-left to upper-right across the screen. Its "The Present" text faces the viewer and is readable from this angle; it reads upside-down only because the bar is seen from the "future" side, so render it as the original does: the text runs along the bar, oriented as in the 65 s frame.
- **Boards stand up**: each board is rotated up from the floor to nearly vertical (≈ 70–80°), like cards facing the camera, with visible thickness (frame edge) and a dark drop shadow cast on the floor. Timeline bands and the Present bar become **raised slabs with dark sides**, not flat decals.
- Branch curves, inactive (white) bands and move arrows are all drawn in this 3D space.

## Parallel View (3D camera mode)

Key frames: t = 11.5 s (single board), 72 s (big multiverse).

- Perspective camera, elevated about 30–40° and yawed so that **timelines recede in depth**: you look across the stack of parallel timelines from the side of white's timelines (from the bottom of the 2D view, for perspective white). The main line (0L) is furthest back, +1L in front of it, and so on. The time axis runs left (past) → right (future) with a slight upward slant; timeline arrows point right.
- The Present bar runs steeply from lower-middle to upper-right, with "The Present" readable along it.
- Boards stand up facing the camera (same card style, thickness and floor shadows as in History View), so rows of boards stack like theatre seats.
- Timeline labels ("0L", "+1L", "+2L") sit on the floor near the right, and turn labels ("T1", ...) on the floor at the bottom.

## Behaviour in both 3D views

- Hovering a board tints the entire board green (translucent green overlay over the squares).
- Clicking squares still selects and moves pieces normally.
- Pan by drag and wheel zoom work; the camera keeps its view angle while panning.
- Transitions between 2D, History and Parallel are smooth camera animations (position, target, FOV/ortho blend and board tilt all interpolate together), about 0.4–0.6 s with easing. The boards rise from flat to standing during the transition into a 3D view and lie back down when returning to 2D.
- Flip Persp. in 3D: darken, swing the camera 180° around the multiverse, then undarken. In 2D, Flip Persp. flips the view (boards rotate 180°).

## 2D details our version is missing or differs on

- **Timeline labels** in faint grey along the right edge of the screen, one per timeline row: "-1L", "0L", "+1L", "+2L" (5D notation names, horizontally fixed to the right edge, vertically anchored to the row). Turn labels "T1", "T2", ... along the bottom (we have these).
- **The main timeline's band has a soft fading tail** to the left of its first board (a gradient from purple to transparent over about one board width), rather than running solid off the screen.
- **New board animation**: the board slides out from behind its predecessor to its slot (≈ 0.3–0.5 s ease-out), and the extending arrow is drawn as a translucent grey ghost until it settles, then purple.
- **The Present bar** slides to its new column and cross-fades between light and dark when the side to move changes.
- **The camera** follows new boards and the opponent's moves with smooth easing.
- Tentative-board frames: yellow for normal moves and blue for travel (already done).

## Piece animation and camera follow (owner feedback)

- Pieces must animate when they move: they glide to the destination as the new board slides out, captures disappear, and travel/jump moves follow the move arrow between boards. This applies to your own moves, the opponent's incoming moves and undo, and respects the animations toggle.
- After every move (tentative move, submit, opponent action) the camera automatically eases "forward" (to the right, and into new timelines) to keep the new boards and the boards you must move on in view. The player shouldn't have to pan manually. Don't fight an active drag.

## Camera bounds (owner feedback)

The original doesn't let you zoom out very far, or pan far away from the multiverse. If you drag away, it pulls you back. Ours must have a minimum and maximum zoom, plus soft (rubber-band) pan bounds around the multiverse's bounding box that spring back on release. This applies in 2D and in both 3D views.

## "Jitter": owner feedback on our version

The owner says our version feels jittery and needs smoothing. Targets:
- All camera motion (pan, wheel/pinch zoom, focus, view transitions) eased and interpolated every frame, with no instant jumps. Wheel zoom should be smoothed (animate towards a target zoom).
- Frames rendered continuously while anything is animating, at a stable 60 fps. No texture re-generation hitches when zooming: keep the old texture until a sharper one is ready, and spread uploads across frames.
- React HUD updates (clocks, hover) must not cause layout thrash or dropped frames.
