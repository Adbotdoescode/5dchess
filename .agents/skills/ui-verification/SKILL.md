---
name: ui-verification
description: Use when you need to see or test the app in a real browser — Playwright scripts, screenshots, the renderer/cinematic dev harnesses, debug hooks, frame-time measurement, phone viewports, or two-browser online tests.
---

# Verifying the app in a browser

- **Dev server:** `npx vite --port <free port>`. Run it in the background and stop it afterwards.
- **Playwright:** 1.64 with Chromium is a devDependency. Write scripts **outside the repo** (a scratch folder) and run them with `node`, pointing `NODE_PATH` at the repo's `node_modules` if needed. Look at every screenshot you take.
- **Debug hook:** on the dev server, or on any deployed build with `?debug`, `window.__5d = { ctrl, renderer }` exposes the game controller and renderer. Use it for setup and assertions, not as a substitute for clicking through the real UI.
- **Harness pages (dev only):**
  - `/render-demo.html`: renderer fixtures, toggles, screenshot support (`src/render/demo/screenshot.mjs`).
  - `/cinematic-demo.html`: any piece or variant; `?t=` freezes a frame.
- **Online:** use two separate browser contexts (separate localStorage = separate seats) against the live backend. Record every game code and delete those rows afterwards.
- **Cover these:** desktop 1920×1080, phone 390×844 with touch (portrait and landscape), short viewports / 300 % zoom, both perspectives, 2D and both 3D views.
- **Smoothness:** measure `performance.now()` deltas per rAF during scripted pan/zoom/transitions, including at 4× CPU throttling (CDP `Emulation.setCPUThrottlingRate`). Report dropped frames, not just averages.
- **Never leave behind:** running servers, test rows in the database, or scripts and screenshots inside the repo.
