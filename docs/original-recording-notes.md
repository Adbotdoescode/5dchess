# Notes from the owner's screen recording of the original game

Source: a 77 s, 1920×1080, 75 fps screen recording of the real game (macOS), made by the project owner to show what our version gets wrong. Original file: `~/Desktop/5dchessdemo.mov` on the owner's machine (not in the repo). These notes are **primary evidence** and override docs/ui-spec.md where they conflict.

In scope (the owner reversed an earlier decision): the full-screen blue "vortex" time-travel cinematic at ≈ 38.3–44.2 s must be replicated in full. When it plays, how it looks frame by frame and how ours is built are in "Time-travel cinematic" below.

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
| 37–46 s | Knight sent back in time ((0T2)Ng1>>(0T1)g3) → the time-travel cinematic (see "Time-travel cinematic"). The new timeline appears below the main line with the curved purple branch band; the board has a blue (travel) pending frame; a lavender move arrow spans the boards. |
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

## Time-travel cinematic

The original's full-screen time-travel animation. Implemented in `src/render/cinematic/` (overlay player, timing model, vortex shader, floor), triggered from `src/ui/controller.ts` (`startCinematic`), with the dev harness `cinematic-demo.html`.

### When it plays: the rule

**The round checkered button on the right edge (under "*") is a one-shot switch.**
- **Icon:** a blue swirl when on, a grey floor checker when off.
- **Plays:** while it is on, the next time travel *the player makes on their own screen* plays the cinematic, the moment the move is made (not on Submit).
- **Turns itself off:** the button switches off as soon as the cinematic starts.
- **Opponent's moves:** the opponent's travel never plays it and does not use it up.
- **Scope:** the state is global, not per game, per piece type or per player.
  - Later games in the same session keep it off until the player clicks it (or presses the hidden hotkey I) to arm it for one more travel.

The owner's fallback guess (the first travel of each piece type per colour) is **contradicted** by the evidence below, so it is not used.

**Evidence**
1. **The owner's recording.**
   - The button shows the blue swirl from 0 s to 38.37 s. The HUD fades out with the swirl still showing (38.37–38.60 s).
   - When the HUD fades back in after the cinematic (42.70–42.83 s), the button is the grey checker. The cursor never goes near it: it stays at (745, 527) from the click at 38.33 s until the end of the cinematic.
   - The second travel in the video, a **white queen** jumping from +1L onto a non-end board of 0L at ≈ 52.2 s and branching +2L, plays **no** cinematic, and the button is off. A different piece type, so the fallback guess would have played it.
   - The CPU's replies contain no travel.
   - Frames: `.../scratchpad/cinematic/btn/btn_strip.png`, `btn2_strip.png`, `t52.png`.
2. **Steam discussion** "Round button???" (app 1349230, 25 Jul 2020):
   - Falc: "I click it, it just turns into a spinner or something. Doesn't seem to do anything?"
   - Patashu: "I think it determines whether the time travel animation plays or not, but it turns itself off after it plays once".
3. **TV Tropes:**
   - "the travel animation button, a circular button under the pause button that contains either a gray checkerboard pattern when off … or a blue swirl when on".
   - The I key toggles it.
   - "the toggleable animation for traveling back in time or between timelines".
4. **A survey of every cinematic in 9 YouTube videos plus Northernlion** (contact sheets and button crops in `.../scratchpad/cinematic/survey/`).
   - **Videos with a cinematic:** BrodieOnGames 12:49, Tyyros 2:27, Jdebruez987 2:21, GMHikaru 8:38, profRI17 6:13, RTGame 0:02 and Triple S 4:49 (edited).
   - **What all 7 share:**
     - It was the recording player's first travel, and a branching move into the past.
     - The button was on just before and off just after, with no click.
     - It stayed off for the rest of the video.
   - **Later games stay off:** Tyyros games 2 and 3, Hikaru's later puzzles and two CPU games, and RTGame's second game all started with it off. It does not reset per game.
   - **The opponent's travel:** in Tyyros 1:32, an online opponent's knight branched into the past. Nothing played and the button stayed on. Tyyros's own travel at 2:27 then played it.
5. **Settings** (Tyyros 19:10, v1.1.0.0e): the main Settings screen has no option for it. The button is the only control.

**Confidence**
- **High:** it plays once and turns itself off; global, not per game or per piece type; plays when the move is made.
- **Medium-high:** the opponent's travel does not play it (one clear case).
- **Medium:** it starts on for a new player. Every first session seen started on, but whether it re-arms on every relaunch is unknown.
  - Our choice: it is persisted in localStorage (default on), so it survives reloads, local saves and online resume, and never replays on a reload.
- **Unknown:**
  - Whether a non-branching jump onto another timeline's playable board plays it. No footage shows it.
  - TV Tropes says "traveling back in time or between timelines", so ours plays for every non-spatial move (jump or branch).
- **Unexplained:** Northernlion (launch week) had it on in his CPU games but off in his first puzzle, with no cinematic and no visible click. Possibly a mode default in that early build.
- **Local play:** both sides are played on the same screen, so the first travel by either colour plays it.

### What it looks like, beat by beat

Measured at 75 fps from the owner's recording and cross-checked with BrodieOnGames 12:47–13:00 (a 5×5 queen, 7 cards).
- **Clock:** times are seconds after the move (the click is at 38.333 s). The recorder froze for 0.2 s at 38.735 s (an encoder hitch: motion resumes with no jump), so frames after it are at *raw − 38.533 s*.
- **Sizes:** in a 1920×1022 view; the code scales them with the view height.

1. **0.02–0.27 s: the HUD fades out.**
2. **0.07–1.58 s: orthographic orbit.**
   - **Camera path:** the camera is a lookAt with up = +z.
     - Its elevation and look azimuth are lerped together from (90°, 90°) (the 2D view) to (0°, 180°), looking back along time from the future side. That is, elevation θ and azimuth 180° − θ.
     - The easing is easeInOutSine: fitted to 21 frames, RMS 0.9°.
     - The orthographic view height is interpolated with the same easing, from the current zoom to a fixed framing: the front card is 281 px; the view height is 0.358 × the view height in world units.
     - The camera target slides to the source board, which stays centred.
   - **Why orthographic:** every edge of the Present bar stays parallel (Hough lines within 0.1° in a frame), and all cards are the same size in every frame.
   - **Why this camera model:** it predicts the bar angles 66.9° / 57.9° / 38.0° against the measured 67.3° / 57.0° / 39.0°.
   - **The cards:** the boards of the trip become camera-facing cards (billboards, always upright on screen) that rise from the floor.
     - Their shadows slide down-left on the floor: height × the 2D light.
     - They fold into a diagonal stack, the past towards the upper left. In the footage the per-board offset goes from (−443, 0) to (−14, −14) px.
3. **0.53–1.16 s: the floor cross-fades to the vortex** (smoothstep). The cards stay opaque on top.
4. **1.50 s: the stack is cut to the flight layout** (a 14 px snap in the footage). The front card rests until 1.74 s.
5. **1.74 s: the flight.**
   - **Projection:** perspective. A board at depth d (in board spacings) has a squares area of 100/d px. The front card starts at d = 0.355.
   - **Camera motion:** the camera accelerates at 2.7 spacings/s² up to one board per second, then cruises.
     - Boards pass at exactly 1.000 s intervals (40.70, 41.70 s), and the destination stops dead at d = 0.127, i.e. 786 px.
     - BrodieOnGames passes 6 boards in 6 s, so short trips are not compressed. Trips longer than 6 boards cruise faster in ours (≤ 6 s); the original's behaviour for very long trips is unknown.
   - **Passing boards:** a board fades out between d = 0.127 and ≈ 0.035, i.e. as it passes the piece.
   - **The travelling piece:**
     - It is the source board's own piece. It detaches when its board reaches d = 0.127 (40.68 s).
     - It then rides at that depth, at a constant size, moving in a straight line at constant speed on screen from its source square to its destination square: x = 1204, y from 910 to 716 at 98 px/s. The BrodieOnGames queen also moves in a straight line, not a spiral.
     - It is always drawn on top.
   - **The piece's shadow:**
     - An opaque #303030 silhouette on the board behind it, clipped to that board.
     - Offset (−3.2, +3.1) board widths per spacing of depth between the board and the piece.
6. **The vortex**, measured in a screen-space unwrap (angle vs 1 / radius).
   - **Shape:** a tunnel centred on the view (it stays centred during the orbit too).
   - **Pattern:** a checker of 8 sectors × rings 0.25 apart in u = (half view height) / r.
     - The sector borders are helices: θ − 0.806 u is constant along them, clockwise deeper in.
   - **Colour:** a radial gradient from (111,129,164) at the edges to (153,162,180) at the centre, with a checker contrast of ~10 → ~4 levels.
   - **Motion:** static while the camera is still. While flying, the rings stream inwards by 8 rings per board passed; the sector helices stay put.
   - The menu backdrop uses the same tunnel with flying pieces (not yet unified with ours).
7. **On landing:**
   - The destination card swaps to the new board: the moved piece plus the blue travel square. It keeps the destination board's own (cream, thin) frame.
   - The HUD fades in (0.13 s, with the button now off).
   - The vortex dissolves into the game (0.9 s, between linear and smoothstep). The game is already framed on the new board at the same size.
   - The game's new board shows only its shadow until the overlay goes: our renderer hides it via `RenderModel.hiddenBoards`.
8. **≈ 1.0 s after landing: the overlay is removed** and the camera zooms out to the standard framing (281 px) in 0.44 s, easeOutSine. The Present bar slides afterwards; ours jumps at landing, a known small difference.

**Sound:** the owner's recording has no audio track. The BrodieOnGames stream is mostly speech and music, with only a broadband block at the landing. Ours plays our own synthesized "travel" whoosh on the move and a knock on landing, as cues from the player.

**Comparison images** (original above, ours below, same timestamps): `.../scratchpad/cinematic/cmp/sbs_<t>.jpg` and `cmp/grid_*.jpg`.
