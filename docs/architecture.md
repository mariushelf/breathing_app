# Breathing App – Architecture Overview

## What this app is
A single-page, client-only web app that runs entirely in the browser. It renders a breathing circle, timer, graph, presets drawer, and optional audio/voice cues. There is no backend; all state lives in JavaScript objects and the DOM.

## Main building blocks
- `index.html`: Declares the UI structure (circle, graph canvas, timer, preset drawer, modals, sliders, audio toggles). Also loads js-yaml from CDN and the app scripts.
- `styles.css`: Visual styling, layout, animations for the circle and sheets/modals.
- `js/app.js`: The central controller. Holds UI state, wires all event handlers, coordinates session lifecycle (start/pause/reset), drives timers/animation frames, and orchestrates audio, graph rendering, presets, and modals.
- `js/breathing.js`: Pure-ish rendering and math helpers for the breathing graph and timing calculations (phase durations, easing curves, canvas drawing, resizing).
- `js/audio.js`: Web Audio helpers for breathing noise, chime/gong, and voice prompts. Reads global `settings` to respect user toggles.
- `js/presets.js`: Loads presets from `presets.yaml` (via js-yaml), builds preset buttons, and manages “composable” presets (structured sequences with until-tap steps, repeats, etc.). Exposes helpers used by `app.js`.
- `presets.yaml`: Source of preset definitions (simple ratios/seconds and composable flows).
- `docs/preset_development.md`: Notes on how presets are structured and parsed.

## Architecture style
- Pragmatic front-end SPA: modular script files sharing global state; no framework, no build step.
- Not hexagonal or DDD. Responsibilities are separated by concern (controller vs. visualization vs. audio vs. presets/data), but everything lives in the browser and shares globals.
- Event-driven UI: DOM events (click/tap/keyboard), timers (`setInterval`), animation frames (`requestAnimationFrame`), and document visibility drive state updates and rendering.

## Key states
- `state` (`js/app.js`): runtime session state (isRunning, isPaused, currentPhase, timers, anchors, wake lock handle, etc.).
- `settings` (`js/app.js`): user-configurable options (BPM vs seconds mode, inhale/exhale ratios, holds, audio toggles, voice/chime, interval minutes).
- `composableState` (`js/app.js` + `js/presets.js`): active composable preset, its stack, current step/duration, graph timeline, until-tap handling, repeat info.

## How a breath session flows (simple presets)
1) User taps the circle/graph/timer icon → `handleTapToggle` in `js/app.js` decides start/pause.
2) `startSession` sets initial phase anchors, starts `requestAnimationFrame(animate)` and `startTimer` (`setInterval`).
3) `animate` reads elapsed time, figures which phase the user is in, updates the circle scale/text, calls `updateBreathingGraph` (from `breathing.js`) to redraw the canvas, and schedules the next frame.
4) `startTimer` updates the mm:ss display and handles interval chimes/voice notifications.
5) Audio cues: `transitionToPhase` (in `app.js`) triggers `playInhaleSound` / `playExhaleSound` / `speak` / `playChime` from `js/audio.js` based on phase and user toggles.
6) Pause or reset stops timers/RAF, audio, and updates UI; reset also clears composable state.

## How composable presets flow (multi-step YAML-driven)
- Presets from `presets.yaml` are parsed in `js/presets.js` into a structured flow. They can include steps like inhale/exhale durations, holds, repeats, and `until_tap` holds.
- When a composable preset is active, `startComposableSession` (in `app.js`) takes over instead of the simple BPM/seconds loop. It advances through the preset stack, updates `composableState.currentStep`, and drives the graph timeline so the canvas reflects the scripted sequence.
- `awaitingTap` and `graphPausedAt` handle `until_tap` steps: the app pauses progression and waits for user input to continue.

## Event model (where events are emitted/handled)
- **User input (DOM events)** – wired in `js/app.js` near the bottom:
  - Tap/click on circle/graph/timer icon → `handleTapToggle` (start/pause) and long-press reset handlers (`scheduleReset`, `clearResetTimer`).
  - Keyboard: Space/Enter toggles start/pause; `R` resets.
  - Preset buttons (`data-quick-preset`, preset list) → load preset into `settings` or `composableState`, then render graph/update UI.
  - Sliders/toggles (BPM, inhale/exhale seconds, holds, interval, audio/chime/voice) → update `settings`, recompute phase durations, rerender graph.
  - Drawer/modal open/close buttons → show/hide panels (`openPresetsDrawer`, `closePresetsDrawer`, `openModal`, `closeModal`).
  - Customize/Save in the modal → persists the current custom rhythm to `settings` and refreshes displays.
- **Timers**:
  - `startTimer` uses `setInterval` to update the timer display and fire interval notifications (gong/voice) based on `settings.intervalMinutes`.
- **Animation frame**:
  - `animate` via `requestAnimationFrame` drives smooth circle scaling, phase changes, and graph drawing; canceled on pause/reset.
- **Visibility/Wake Lock**:
  - `visibilitychange` pauses audio/timers and releases wake lock when tab is hidden.
  - Wake lock `release` event toggles flag; app re-requests on resume.
- **Audio/voice** (indirect events): Web Audio nodes are started/stopped inside phase transitions; Speech Synthesis is started by `speak` when voice is enabled.

## Data flow and coupling
- Preset selection → updates `settings` or `composableState` → triggers `renderGraphWithCurrentSettings` (`app.js` + `breathing.js`) → UI shows new rhythm and graph.
- Session start → `state` initialized → `animate` + `startTimer` loop → circle/graph/text/audio reflect elapsed time and phase.
- Sliders/toggles → mutate `settings` → recompute phase durations (`breathing.js`) → re-render graph; if session running, the anchor keeps graph stable.
- Audio functions consume `settings` flags; they do not own state.
- All modules share globals; no pub/sub bus—communication is via direct function calls and shared objects.

## Files and responsibilities (quick reference)
- `js/app.js`: glue + controller (events, session lifecycle, UI updates, wake lock, disclaimer modal, tap-to-start/pause/reset logic).
- `js/breathing.js`: timing math and canvas drawing for the breathing graph (easing, sampling, sizing, redrawing on resize and preset change).
- `js/audio.js`: Web Audio + Speech Synthesis utilities; invoked from phase transitions and interval notifications.
- `js/presets.js`: preset parsing/loading, button generation, composable preset runtime helpers.
- `index.html`: DOM skeleton + script includes; event targets live here (circle, graph, sliders, modals, buttons).
- `presets.yaml`: canonical preset definitions consumed by `js/presets.js`.

## Why this structure works for this app
- Small, offline-first, zero-backend app: direct DOM + modular scripts are simple and fast to load.
- Separation by concern keeps code findable: controller vs. graph vs. audio vs. presets.
- Globals keep wiring simple for a lightweight site (trade-off: less formal isolation/testing).

## If you’re new to web event handling, here’s the mental model
1) The HTML exposes elements with IDs (e.g., `breathingCircle`, `timerIcon`, sliders, buttons).
2) `app.js` grabs those elements once (`document.getElementById(...)`).
3) `addEventListener` registers handlers (e.g., `click`, `pointerdown`, `keydown`). When the user acts, the browser calls those functions.
4) Handlers update in-memory state (`state`, `settings`, `composableState`) and call helpers to re-render UI (text, circle scale, canvas) and play sounds.
5) Timers (`setInterval`) and animation frames (`requestAnimationFrame`) are also “events” that the browser emits on a schedule; those callbacks keep the timer ticking and the graph smooth.

## Notable UX/behavior details
- Tap anywhere on the circle or graph to start/pause; long-press to reset.
- Wake Lock: the app requests a screen wake lock during a running session to avoid dimming/sleep; released on pause/reset/visibility change.
- Disclaimer gate: `startSession` checks acceptance; shows modal if needed.
- Accessibility: Timer icon is keyboard-focusable; space/enter toggles; ARIA labels on controls.

## Extending safely (suggestions)
- Keep concerns split: session control in `app.js`, math/graph in `breathing.js`, audio in `audio.js`, data/preset parsing in `presets.js`.
- Avoid adding more globals; pass data into helpers when practical.
- For larger changes, consider a small event bus or state container to decouple modules, but for current size the direct-call approach is fine.