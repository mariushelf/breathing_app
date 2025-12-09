## Preset Design Specification (YAML presets & runtime behavior)

This document defines the contract for authoring and running presets in `presets.yaml`. It covers the schema, timing rules, configurable fields (now supporting labels), runtime semantics, and UI binding expectations.

### Goals
- Support two preset shapes: simple presets (the current inhale/hold/exhale loop) and fully composable, nested presets defined in YAML.
- Allow scripted sequences with nested repeats, BPM-driven ratios, and interactive holds / loops controlled by taps.
- Keep the four simple timings implicitly configurable without forcing them into a `configurable` list.
- Expose only the fields listed in `configurable` in the Customize UI, rendering controls dynamically. Configurables can be strings *or* objects with an optional `label` for UI text.

### Preset schema (YAML)
- Top-level: `presets:` (array). Each entry includes metadata (`id`, `label`, `category`, `description`) and one of two bodies:
  - **Simple preset**
    - Fields: `inhale`, `holdInhale`, `exhale`, `holdExhale`
    - Optional: `mode` (defaults to seconds)
    - Configurability: all four timings remain implicitly editable; `configurable` is not required for them to appear in UI sliders.
  - **Composable preset**
    - Fields: `steps` (array of primitives or nested repeats)
    - Optional: `configurable` (list of YAML paths targeting fields inside `steps`)

#### Step primitives (used in `steps` or nested `repeat.steps`)
- `inhale: <secondsOrRatio>`
- `exhale: <secondsOrRatio>`
- `hold: <secondsOrRatio | until_tap>` — `until_tap` pauses until the user taps to resume.
- `repeat:` object with:
  - `n: <number | until_tap>` — `until_tap` loops until a tap signals to exit. The current iteration completes before moving on.
  - Optional `bpm: <number>` — when present, child timing values are treated as ratios within the BPM cycle.
  - `steps: []` — array of primitives and/or nested repeats.
- Any step may include an optional `id` to allow stable targeting from `configurable` paths.

#### Timing rules
- A `repeat` with `bpm` treats child `inhale` / `exhale` / `hold` values as ratios. The sum of these ratios defines one cycle of length `60 / bpm` seconds.
- Without `bpm`, timing values are absolute seconds.
- Nested `repeat` blocks that also set `bpm` are **invalid** (no nested BPM values).
- `bpm` is incompatible with `hold: until_tap` inside the same `repeat` block.

#### Configurable paths
- Purpose: declare which underlying values surface in the Customize UI for composable presets.
- Entry shapes:
  - String path: `repeat|steps|breaths|repeat|n`
  - Object with label: `- path: repeat|n\n  label: Number of rounds`
- Paths are pipe-delimited and may reference step `id` values: e.g., `repeat|steps|whm_cycle|repeat|n` or `repeat|steps|breaths|repeat|bpm`.
- If no `id` is present for a level, ordinal position is used.
- Simple presets do **not** need `configurable`; their four timings are automatically editable.

### Runtime behavior
- The player walks steps in order, supporting nested repeats and `until_tap` interactions.
- `hold: until_tap`: show/announce “Hold; tap when you are ready”; resume on tap.
- `repeat.n = until_tap`: loop until a tap signals to advance; finish the current iteration before exiting.
- Existing inhale/hold/exhale sounds are reused. Only the `until_tap` hold uses the new prompt.
- Simple presets continue to play as today (single-loop inhale/hold/exhale based on settings).

### UI / Customize panel binding
- When a preset is selected:
  - **Simple**: show the four legacy sliders (inhale, holdInhale, exhale, holdExhale).
  - **Composable**: generate controls only for entries in `configurable`, mapping to the referenced step fields. Use `label` when provided; otherwise, derive a name from the path.
- Persist user edits back into the active preset instance (and settings where applicable) prior to playback.

### Data application
- **Simple preset**: hydrate settings directly from inhale/holdInhale/exhale/holdExhale; BPM/ratio handling remains as today.
- **Composable preset**: maintain a play cursor through scripted steps; compute concrete durations for BPM-aware blocks via ratio scaling.

### Example: WHM intent
- Top-level repeat of `n` cycles (default 4), each containing:
  - Breathing block: `repeat n=30` breaths at `bpm=20` with inhale/exhale ratios (e.g., 4/6 units)
  - Recovery: `hold: until_tap`
  - Finisher: inhale (e.g., 6s), `hold: 15`, exhale (e.g., 8s)
- Configurable paths (with labels):
  - `- path: repeat|steps|breaths|repeat|n\n  label: Breaths per cycle`
  - `- path: repeat|steps|breaths|repeat|bpm\n  label: Breath BPM`
  - `- path: repeat|n\n  label: Number of cycles`
  - 