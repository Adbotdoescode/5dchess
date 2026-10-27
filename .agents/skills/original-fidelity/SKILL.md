---
name: original-fidelity
description: Use when changing anything players see or feel — renderer visuals, HUD, menus, animations, camera, History/Parallel View, the time-travel cinematic, sounds, status text — or when deciding how the original game behaves. Holds the measured facts about the original and the comparison workflow.
---

# Matching the original game

The goal is a 1:1 replica of "5D Chess With Multiverse Time Travel" (Thunkspace, 2020). When unsure how something should look or behave, find out how the **original** does it; never guess.

## Evidence
The original game itself is the only authority. Learn its behaviour by observing it, from play or from footage or screenshots you capture yourself, and measure rather than eyeball. Write every confirmed fact into the "Established facts" list below, without links or citations: this repository is open source and must stand on its own.

## Established facts (don't regress)
- **History View / Parallel View** are animated 3D camera modes with one **orthographic** camera: elevation 37.5°, azimuth 153° / 111°, boards standing like cards, bands and the Present bar as slabs, 0.46 s ease-out transitions. Clicking the active tab returns to 2D. The 3D Flip darkens the screen during the swap. See `src/render/views.ts`.
- **Present bar:** light when white is to move at the present, dark for black. It slides and cross-fades when the present changes. Its circle markers show where each colour's next timeline appears: purple arrow = would be active, empty = inactive.
- **Time-travel cinematic** (`src/render/cinematic/`): the round button is a **one-shot switch**. When on, the player's next own travel plays the cinematic, then the button turns itself off; the opponent's travel never plays it. Hotkey I re-arms it.
- **Pieces:** the original places them instantly and slides only the board; our glides are a deliberate addition. The camera auto-follows new boards. Rubber-band camera bounds and zoom limits apply in every view.
- **Status strings and colours:** the exact HUD strings ("Your turn - White pieces", "Their turn - …") and the Undo pill colours (yellow move / blue travel / red check) are in `src/ui/GameScreen.tsx`. The font is Crimson Text.

## Workflow
- Extract frames from footage of the original with ffmpeg (installed), e.g. `ffmpeg -ss <t> -i <video> -frames:v 1 out.jpg`, or contact sheets with `-vf fps=2,scale=480:270,tile=4x4`. Keep footage and frames outside the repo.
- Reproduce the same position in our app, screenshot it in a browser, and compare side by side until they match.
- When new evidence changes a fact above, update this skill in the same change.
