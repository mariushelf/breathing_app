// App State
const state = {
    isRunning: false,
    isPaused: false,
    currentPhase: 'ready', // ready, inhale, holdInhale, exhale, holdExhale
    elapsedSeconds: 0,
    animationFrame: null,
    phaseAnchorSec: 0,
    cycleAnchorSec: 0,
    sessionStartTime: null,
    totalPausedMs: 0,
    pauseStartedAt: null,
    timerInterval: null,
    lastIntervalNotification: 0,
    pausedPhaseElapsed: 0
};

// Settings with defaults
let settings = {
    bpm: 6,
    exhaleRatio: 1.5,
    holdInhale: 0,
    holdExhale: 0,
    // configuration mode: 'bpm' or 'seconds'
    mode: 'bpm',
    // explicit durations (seconds) used when mode === 'seconds'
    inhaleSeconds: 4,
    exhaleSeconds: 6,
    breathingSoundsEnabled: true,
    chimeEnabled: true,
    voiceEnabled: true,
    intervalMinutes: 1
};

// Composable preset runtime state
const UNTIL_TAP = 'until_tap';
const UNTIL_TAP_DISPLAY_SECONDS = 10; // Display hold-until-tap as 10 seconds in graph
const composableState = {
    activePreset: null,
    rawPreset: null,            // Original preset from YAML (for configurable path access)
    stack: [],
    currentStep: null,
    currentStepDuration: null,
    awaitingTap: false,
    repeatStopFrame: null,
    // Graph timeline state
    graphTimeline: null,        // Flattened array of {type, duration, startTime, endTime, isUntilTap}
    graphTimelineDuration: 0,   // Total duration of the timeline
    graphPausedAt: null,        // Time when graph paused for until_tap (null if not paused)
    graphSkipToTime: null,      // Time to skip to when user taps (null if no skip pending)
    currentUntilTapIndex: 0     // Index of current until_tap step in timeline (for multi-round presets)
};

// DOM Elements
const breathingCircle = document.getElementById('breathingCircle');
const phaseText = document.getElementById('phaseText');
const phaseCountdown = document.getElementById('phaseCountdown');
const timerDisplay = document.getElementById('timerDisplay');
const timerIcon = document.getElementById('timerIcon');
const instructionText = document.getElementById('instructionText');
const settingsPanel = document.getElementById('settingsPanel');
const settingsOverlay = document.getElementById('settingsOverlay');
const presetsFab = document.getElementById('presetsFab');
const presetsCloseBtn = document.getElementById('presetsCloseBtn');
const quickPresetFunctional = document.getElementById('quickPresetFunctional');
const quickPresetBox = document.getElementById('quickPresetBox');
const morePresetsBtn = document.getElementById('morePresetsBtn');
const customizeBtn = document.getElementById('customizeBtn');
const customizeModal = document.getElementById('customizeModal');
const customizeCloseBtn = document.getElementById('customizeCloseBtn');
const customizeDoneBtn = document.getElementById('customizeDoneBtn');
const customizeSaveBtn = document.getElementById('customizeSaveBtn');
const presetsGoBtn = document.getElementById('presetsGoBtn');
const audioBtn = document.getElementById('audioBtn');
const audioModal = document.getElementById('audioModal');
const audioCloseBtn = document.getElementById('audioCloseBtn');
const disclaimerModal = document.getElementById('disclaimerModal');
const disclaimerContent = document.getElementById('disclaimerContent');
const disclaimerAgreeBtn = document.getElementById('disclaimerAgreeBtn');
const disclaimerSnoozeCheckbox = document.getElementById('disclaimerSnoozeCheckbox');
const notification = document.getElementById('notification');
const mainContainer = document.querySelector('.main-container');
const breathingGraph = document.getElementById('breathingGraph');
const breathingGraphDot = document.getElementById('breathingGraphDot');
const breathingGraphContainer = document.getElementById('breathingGraphContainer');
const graphCtx = breathingGraph ? breathingGraph.getContext('2d') : null;
const quickRhythmDisplay = document.getElementById('quickRhythmDisplay');
const currentPresetDisplay = document.getElementById('currentPresetDisplay');

// Wake Lock
let wakeLock = null;
let noSleepInstance = null;
let noSleepEnabled = false;
let noSleepScriptLoading = null;
const DISCLAIMER_KEY = 'breathing_app_disclaimer_ack_v1';
let disclaimerLoaded = false;
let disclaimerSessionAccepted = false;

function loadNoSleepScript() {
    if (noSleepScriptLoading) return noSleepScriptLoading;
    noSleepScriptLoading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdn.jsdelivr.net/npm/nosleep.js@0.12.0/dist/NoSleep.min.js';
        script.async = true;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('NoSleep failed to load'));
        document.head.appendChild(script);
    });
    return noSleepScriptLoading;
}

async function enableWakeLockFallback() {
    if (noSleepEnabled) return;
    try {
        await loadNoSleepScript();
        if (!noSleepInstance && typeof NoSleep !== 'undefined') {
            noSleepInstance = new NoSleep();
        }
        await noSleepInstance?.enable();
        noSleepEnabled = true;
    } catch (err) {
        console.warn('Wake lock fallback failed:', err);
    }
}

function disableWakeLockFallback() {
    try {
        if (noSleepInstance && noSleepEnabled) {
            noSleepInstance.disable();
        }
    } catch (err) {
        // ignore
    } finally {
        noSleepEnabled = false;
    }
}

async function requestWakeLock() {
    if ('wakeLock' in navigator) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
            wakeLock.addEventListener('release', () => {
                wakeLock = null;
            }, { once: true });
            return;
        } catch (err) {
            // Silently fall through to fallback
            wakeLock = null;
        }
    }

    // Fallback for browsers without the Screen Wake Lock API (e.g., iOS Safari)
    await enableWakeLockFallback();
}

async function releaseWakeLock() {
    if (wakeLock) {
        try {
            await wakeLock.release();
        } catch (err) {
            // ignore
        } finally {
            wakeLock = null;
        }
    }

    disableWakeLockFallback();
}

// Sliders
const bpmSlider = document.getElementById('bpmSlider');
const inhaleSecondsSlider = document.getElementById('inhaleSecondsSlider');
const exhaleSecondsSlider = document.getElementById('exhaleSecondsSlider');
const holdInhaleSlider = document.getElementById('holdInhaleSlider');
const holdExhaleSlider = document.getElementById('holdExhaleSlider');
const breathingSoundsToggle = document.getElementById('breathingSoundsToggle');
const chimeToggle = document.getElementById('chimeToggle');
const voiceToggle = document.getElementById('voiceToggle');
const intervalSlider = document.getElementById('intervalSlider');
const presetButtonsContainer = document.getElementById('presetButtonsContainer');
const ratioDisplay = document.getElementById('ratioDisplay');
const bpmSetting = document.querySelector('.bpm-setting');
const rhythmSetting = document.querySelector('.rhythm-inline');

// Configurable preset UI elements
const simplePresetControls = document.getElementById('simplePresetControls');
const composablePresetControls = document.getElementById('composablePresetControls');
const configurableControlsContainer = document.getElementById('configurableControlsContainer');
const composablePresetTitle = document.getElementById('composablePresetTitle');

// Layout: keep breathing bubble + controls vertically centered
// in the space not occupied by the settings panel
function updateLayoutForSettings() {
    if (!mainContainer) return;
    mainContainer.style.marginTop = '20px';
    mainContainer.style.marginBottom = '20px';
}

function formatSeconds(value) {
    const rounded = Math.round(value * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
        return Math.round(rounded).toString();
    }
    return rounded.toFixed(1);
}

function formatRatio(value) {
    const safe = Math.max(value || 0, 0.1);
    const rounded = Math.round(safe * 10) / 10;
    return rounded.toString().replace(/\.0$/, '');
}

function setAdvancedPresetVisibility(isAdvanced) {
    if (bpmSetting) {
        bpmSetting.style.display = isAdvanced ? 'none' : '';
    }
    if (rhythmSetting) {
        rhythmSetting.style.display = isAdvanced ? 'none' : '';
    }
}

// Unified session clock: seconds since start excluding pauses
function getElapsedSeconds(nowTs = performance.now()) {
    if (!state.sessionStartTime) return 0;
    const pausedMs = state.totalPausedMs + (state.pauseStartedAt ? (nowTs - state.pauseStartedAt) : 0);
    const elapsedMs = nowTs - state.sessionStartTime - pausedMs;
    return Math.max(0, elapsedMs / 1000);
}

// ---------- Composable preset helpers ----------
function resetComposableState() {
    composableState.activePreset = null;
    composableState.rawPreset = null;
    composableState.stack = [];
    composableState.currentStep = null;
    composableState.currentStepDuration = null;
    composableState.awaitingTap = false;
    composableState.repeatStopFrame = null;
    // Clear graph timeline state
    composableState.graphTimeline = null;
    composableState.graphTimelineDuration = 0;
    composableState.graphPausedAt = null;
    composableState.graphSkipToTime = null;
    composableState.currentUntilTapIndex = 0;

    // Ensure advanced-only controls are hidden when no composable preset is active
    setAdvancedPresetVisibility(false);

    updateCurrentPresetDisplay();
}

function normalizePrimitivePayload(key, rawVal, ancestorHasBpm) {
    const isObject = rawVal && typeof rawVal === 'object' && !Array.isArray(rawVal);

    const durationRaw = isObject ? (rawVal.duration ?? rawVal.value) : rawVal;

    if (key !== 'hold' && durationRaw === UNTIL_TAP) {
        throw new Error('until_tap only valid for hold');
    }

    const value = durationRaw === UNTIL_TAP ? UNTIL_TAP : Number(durationRaw);
    if (value !== UNTIL_TAP && (!Number.isFinite(value) || value < 0)) {
        throw new Error('Duration must be non-negative');
    }

    const cue = isObject && rawVal.cue ? String(rawVal.cue) : null;
    const voice = isObject && rawVal.voice !== undefined ? rawVal.voice : null;
    const chime = isObject && rawVal.chime !== undefined ? rawVal.chime : null;

    return { type: key, value, cue, voice, chime };
}

function normalizeComposableStep(step, ancestorHasBpm = false) {
    if (!step || typeof step !== 'object') {
        throw new Error('Invalid step');
    }

    const id = step.id || step.repeat?.id;

    if (step.repeat) {
        const repeat = step.repeat;
        const hasBpm = repeat.bpm !== undefined && repeat.bpm !== null;

        if (hasBpm && ancestorHasBpm) {
            throw new Error('Nested BPM repeat blocks are not allowed');
        }

        const nRaw = repeat.n;
        const untilTap = nRaw === UNTIL_TAP;
        const nVal = untilTap ? UNTIL_TAP : Number(nRaw);
        if (!untilTap && (!Number.isFinite(nVal) || nVal <= 0)) {
            throw new Error('Repeat n must be positive or until_tap');
        }

        const childSteps = Array.isArray(repeat.steps) ? repeat.steps : [];
        if (!childSteps.length) {
            throw new Error('Repeat block must contain steps');
        }

        const normalizedChildren = childSteps.map((s) => normalizeComposableStep(s, ancestorHasBpm || hasBpm));

        if (hasBpm) {
            const bpmVal = Number(repeat.bpm);
            if (!Number.isFinite(bpmVal) || bpmVal <= 0) {
                throw new Error('BPM must be a positive number');
            }

            // Validate children: no holds with until_tap and no nested BPM repeats
            normalizedChildren.forEach((c) => {
                if (c.type === 'hold' && c.value === UNTIL_TAP) {
                    throw new Error('BPM blocks cannot contain until_tap holds');
                }
                if (c.type === 'repeat' && c.bpm) {
                    throw new Error('Nested BPM blocks are not allowed');
                }
            });

            const ratioTotal = normalizedChildren.reduce((sum, c) => {
                if (c.type === 'repeat') return sum;
                const val = Number(c.value) || 0;
                return sum + val;
            }, 0);
            if (ratioTotal <= 0) {
                throw new Error('BPM blocks must have positive durations');
            }

            return {
                type: 'repeat',
                id,
                n: nVal,
                untilTap,
                bpm: bpmVal,
                ratioTotal,
                steps: normalizedChildren
            };
        }

        return {
            type: 'repeat',
            id,
            n: nVal,
            untilTap,
            bpm: null,
            ratioTotal: null,
            steps: normalizedChildren
        };
    }

    const key = ['inhale', 'exhale', 'hold'].find((k) => k in step);
    if (!key) {
        throw new Error('Step must be inhale, exhale, or hold');
    }

    const payload = normalizePrimitivePayload(key, step[key], ancestorHasBpm);
    return { id, ...payload };
}

function normalizeComposablePreset(preset) {
    if (!preset || !Array.isArray(preset.steps)) return null;
    const normalizedSteps = preset.steps.map((s) => normalizeComposableStep(s));
    return {
        ...preset,
        steps: normalizedSteps,
        configurable: Array.isArray(preset.configurable) ? preset.configurable : []
    };
}

function pushComposableFrame(frame) {
    composableState.stack.push(frame);
}

function createFrameForSteps(steps, options = {}) {
    const { bpm = null, ratioTotal = null, repeatTotal = 1, untilTap = false, id = null } = options;
    return {
        id,
        steps,
        index: 0,
        bpm,
        ratioTotal,
        cycleSeconds: bpm ? 60 / bpm : null,
        repeatTotal,
        repeatUntilTap: untilTap,
        iteration: 0
    };
}

function findTopUntilTapFrame() {
    for (let i = composableState.stack.length - 1; i >= 0; i--) {
        const frame = composableState.stack[i];
        if (frame.repeatUntilTap) return frame;
    }
    return null;
}

function nextComposablePrimitive() {
    while (composableState.stack.length) {
        const frame = composableState.stack[composableState.stack.length - 1];

        if (frame.index >= frame.steps.length) {
            // Finished one iteration
            if (frame.repeatUntilTap) {
                if (composableState.repeatStopFrame === frame) {
                    composableState.repeatStopFrame = null;
                    composableState.stack.pop();
                    continue;
                }
                frame.index = 0;
                frame.iteration += 1;
                continue;
            }

            if (frame.iteration + 1 < frame.repeatTotal) {
                frame.index = 0;
                frame.iteration += 1;
                continue;
            }

            composableState.stack.pop();
            continue;
        }

        const step = frame.steps[frame.index++];
        if (step.type === 'repeat') {
            const childFrame = createFrameForSteps(step.steps, {
                bpm: step.bpm,
                ratioTotal: step.ratioTotal,
                repeatTotal: step.untilTap ? 1 : step.n,
                untilTap: step.untilTap,
                id: step.id
            });
            pushComposableFrame(childFrame);
            continue;
        }

        const duration = frame.bpm
            ? (frame.cycleSeconds * (Number(step.value) || 0)) / (frame.ratioTotal || 1)
            : step.value;
        return { ...step, duration };
    }

    return null;
}

function beginComposableStep(step, anchorSec = getElapsedSeconds()) {
    composableState.currentStep = step;
    composableState.currentStepDuration = step.duration === UNTIL_TAP ? null : step.duration;
    composableState.awaitingTap = step.duration === UNTIL_TAP;

    state.currentPhase = step.type === 'hold' && composableState.awaitingTap ? 'holdUntilTap' : step.type;
    // Use provided anchor (scheduled start) to avoid drift from late frames
    state.phaseAnchorSec = anchorSec;
    state.pausedPhaseElapsed = 0;

    const phaseNames = {
        inhale: 'Inhale',
        exhale: 'Exhale',
        hold: 'Hold',
        holdUntilTap: 'Hold'
    };

    const phaseInstructions = {
        inhale: 'Breathe in',
        exhale: 'Breathe out',
        hold: 'Hold',
        holdUntilTap: 'Hold; tap when you are ready'
    };

    const prompt = step || {};
    const cueText = prompt.cue || phaseInstructions[state.currentPhase] || '';
    const voiceText = prompt.voice === 'disabled'
        ? null
        : (typeof prompt.voice === 'string' ? prompt.voice : cueText);
    const chimeAllowed = prompt.chime === 'disabled' ? false : true;

    phaseText.textContent = phaseNames[state.currentPhase] || 'Breath';
    instructionText.textContent = cueText;

    if (phaseCountdown) {
        if (composableState.currentStepDuration && step.type === 'hold') {
            phaseCountdown.textContent = formatCountdownSeconds(composableState.currentStepDuration);
        } else {
            phaseCountdown.textContent = '';
        }
    }

    if (state.currentPhase === 'inhale') {
        if (chimeAllowed) playChime(528, 0.5);
        if (voiceText) speak(voiceText);
        playInhaleSound(step.duration || 1);
    } else if (state.currentPhase === 'exhale') {
        if (chimeAllowed) playChime(396, 0.5);
        if (voiceText) speak(voiceText);
        playExhaleSound(step.duration || 1);
    } else if (state.currentPhase === 'holdUntilTap') {
        if (chimeAllowed) playChime(440, 0.3);
        if (voiceText) speak(voiceText);
        stopBreathingSound();
    } else if (state.currentPhase === 'hold') {
        if (chimeAllowed) playChime(440, 0.3);
        if (voiceText) speak(voiceText);
        stopBreathingSound();
    }
}

function advanceComposableStep() {
    const next = nextComposablePrimitive();
    if (!next) {
        endComposableSession();
        return;
    }
    // Anchor new step to scheduled time: previous anchor + duration (or now for until_tap)
    const scheduledAnchor = state.phaseAnchorSec + (composableState.currentStepDuration || 0);
    const nextAnchor = next.duration === UNTIL_TAP ? getElapsedSeconds() : scheduledAnchor;
    beginComposableStep(next, nextAnchor);
}

// Flatten a composable preset into a timeline of primitive steps for graph rendering
// Returns array of {type: 'inhale'|'exhale'|'hold', duration, startTime, endTime, isUntilTap}
function flattenComposablePreset(preset) {
    if (!preset || !Array.isArray(preset.steps)) return [];
    
    const timeline = [];
    let currentTime = 0;
    
    function flattenSteps(steps, bpm = null, ratioTotal = null) {
        const cycleSeconds = bpm ? 60 / bpm : null;
        
        for (const step of steps) {
            if (step.type === 'repeat') {
                // Handle repeat blocks
                const repeatCount = step.untilTap ? 1 : step.n; // For until_tap, just show 1 iteration in graph
                const childBpm = step.bpm || bpm;
                const childRatioTotal = step.ratioTotal || ratioTotal;
                
                for (let i = 0; i < repeatCount; i++) {
                    flattenSteps(step.steps, childBpm, childRatioTotal);
                }
            } else {
                // Primitive step: inhale, exhale, or hold
                let duration;
                const isUntilTap = step.value === UNTIL_TAP;
                
                if (isUntilTap) {
                    duration = UNTIL_TAP_DISPLAY_SECONDS;
                } else if (bpm && cycleSeconds && ratioTotal) {
                    // BPM-scaled duration
                    duration = (cycleSeconds * (Number(step.value) || 0)) / ratioTotal;
                } else {
                    // Absolute duration
                    duration = Number(step.value) || 0;
                }
                
                timeline.push({
                    type: step.type,
                    duration: duration,
                    startTime: currentTime,
                    endTime: currentTime + duration,
                    isUntilTap: isUntilTap
                });
                
                currentTime += duration;
            }
        }
    }
    
    flattenSteps(preset.steps);
    return timeline;
}

// Get the total duration of a flattened timeline
function getTimelineDuration(timeline) {
    if (!timeline || timeline.length === 0) return 0;
    return timeline[timeline.length - 1].endTime;
}

// Build and cache the graph timeline for the active composable preset
function buildComposableGraphTimeline() {
    if (!composableState.activePreset) {
        composableState.graphTimeline = null;
        composableState.graphTimelineDuration = 0;
        return;
    }
    
    composableState.graphTimeline = flattenComposablePreset(composableState.activePreset);
    composableState.graphTimelineDuration = getTimelineDuration(composableState.graphTimeline);
    composableState.graphPausedAt = null;
    composableState.graphSkipToTime = null;
}

// Get breath value (0-1) at a given time in the timeline
// Returns {value: 0-1, step: current step object or null if past end}
function getBreathValueAtTimeline(timeSec, timeline, totalDuration) {
    if (!timeline || timeline.length === 0) {
        return { value: 0, step: null };
    }
    
    // Clamp time to valid range - don't wrap around like simple presets
    if (timeSec < 0) {
        return { value: 0, step: timeline[0] };
    }
    if (timeSec >= totalDuration) {
        // Past the end - return the final state (exhaled, value 0)
        return { value: 0, step: null };
    }
    
    // Find the step that contains this time
    let step = null;
    for (const s of timeline) {
        if (timeSec >= s.startTime && timeSec < s.endTime) {
            step = s;
            break;
        }
    }
    
    if (!step) {
        return { value: 0, step: null };
    }
    
    const elapsed = timeSec - step.startTime;
    const progress = step.duration > 0 ? Math.min(elapsed / step.duration, 1) : 1;
    
    // Determine the breath value based on step type
    // We need to know if we're at top (1) or bottom (0) of breath
    // For proper visualization, track cumulative state
    let value = 0;
    
    if (step.type === 'inhale') {
        // Going from current level up to 1
        value = easeInOutSine(progress);
    } else if (step.type === 'exhale') {
        // Going from 1 down to 0
        value = 1 - easeInOutSine(progress);
    } else if (step.type === 'hold') {
        // Hold at current level - need to determine if at top or bottom
        // Look at the previous step to determine hold level
        const stepIndex = timeline.indexOf(step);
        if (stepIndex > 0) {
            const prevStep = timeline[stepIndex - 1];
            if (prevStep.type === 'inhale') {
                value = 1; // Hold after inhale = at top
            } else if (prevStep.type === 'exhale') {
                value = 0; // Hold after exhale = at bottom
            } else if (prevStep.type === 'hold') {
                // Consecutive holds - look further back
                for (let i = stepIndex - 1; i >= 0; i--) {
                    if (timeline[i].type === 'inhale') {
                        value = 1;
                        break;
                    } else if (timeline[i].type === 'exhale') {
                        value = 0;
                        break;
                    }
                }
            }
        } else {
            // First step is a hold - assume at bottom
            value = 0;
        }
    }
    
    return { value, step };
}

// Get the current graph time for composable presets
// This handles pausing at until_tap holds and fast-forwarding
function getComposableGraphTime(sessionTime) {
    const timeline = composableState.graphTimeline;
    const totalDuration = composableState.graphTimelineDuration;
    
    if (!timeline || timeline.length === 0) {
        return sessionTime;
    }
    
    // If graph is paused at an until_tap hold, return the pause time
    if (composableState.graphPausedAt !== null) {
        return composableState.graphPausedAt;
    }
    
    // Handle fast-forward: if user tapped before 10 seconds, skip to the next step
    // graphSkipToTime holds the timeline time we should skip to
    if (composableState.graphSkipToTime !== null) {
        // Calculate the offset: how much time to add to session time to align with skip target
        // This makes the graph jump to the next step after the until_tap hold
        const skipOffset = composableState.graphSkipToTime - sessionTime;
        if (skipOffset > 0) {
            // We're still behind the skip point, so fast-forward
            return composableState.graphSkipToTime;
        } else {
            // Session time has caught up, clear the skip and continue normally
            composableState.graphSkipToTime = null;
        }
    }
    
    // Check if we need to pause at an until_tap hold
    // Only check the current until_tap step (based on currentUntilTapIndex)
    let graphTime = sessionTime;
    
    // Find all until_tap steps and get the current one
    const untilTapSteps = timeline.filter(step => step.isUntilTap);
    const currentUntilTapStep = untilTapSteps[composableState.currentUntilTapIndex];
    
    if (currentUntilTapStep && sessionTime >= currentUntilTapStep.endTime) {
        // We've reached the end of the current until_tap hold's display (10 seconds)
        // Pause if we're still awaiting tap
        if (composableState.awaitingTap && composableState.currentStep?.type === 'hold') {
            composableState.graphPausedAt = currentUntilTapStep.endTime;
            return currentUntilTapStep.endTime;
        }
    }
    
    // Clamp to total duration
    return Math.min(graphTime, totalDuration);
}

// Called when user taps during an until_tap hold to advance the graph
function advanceGraphPastUntilTap() {
    const timeline = composableState.graphTimeline;
    if (!timeline) return;
    
    // Find all until_tap steps in timeline
    const untilTapSteps = timeline.filter(step => step.isUntilTap);
    const currentIndex = composableState.currentUntilTapIndex;
    const currentUntilTapStep = untilTapSteps[currentIndex];
    
    if (!currentUntilTapStep) return; // No more until_tap steps
    
    const targetTime = currentUntilTapStep.endTime;

    // Align graph time to the target step immediately, regardless of when the tap happens
    const sessionTime = getElapsedSeconds();
    state.cycleAnchorSec = sessionTime - targetTime;

    // Clear any pause or pending skip flags so graph resumes at the aligned time
    composableState.graphPausedAt = null;
    composableState.graphSkipToTime = null;
    
    // Move to the next until_tap step for the next round
    composableState.currentUntilTapIndex++;
}

// Extract current breathing cycle durations for the graph from composable state
function getComposableCycleDurations() {
    // Find the innermost frame that has breathing primitives (not just repeat wrappers)
    // We traverse the stack from top (innermost) to bottom to find a frame with primitives
    for (let i = composableState.stack.length - 1; i >= 0; i--) {
        const frame = composableState.stack[i];
        if (!frame || !frame.steps || !frame.steps.length) continue;

        // Check if this frame has primitive steps (inhale, exhale, hold)
        const primitives = frame.steps.filter(s => s.type === 'inhale' || s.type === 'exhale' || s.type === 'hold');
        if (primitives.length === 0) continue;

        // Calculate durations for each step in this frame
        const durations = { inhale: 0, holdInhale: 0, exhale: 0, holdExhale: 0 };
        let afterInhale = false;
        let afterExhale = false;

        for (const step of frame.steps) {
            if (step.type === 'repeat') continue; // Skip nested repeats for graph purposes

            let duration;
            if (frame.bpm && frame.cycleSeconds && frame.ratioTotal) {
                // BPM-scaled duration
                duration = (frame.cycleSeconds * (Number(step.value) || 0)) / frame.ratioTotal;
            } else {
                // Absolute duration (or until_tap which we treat as 0 for graph)
                duration = step.value === UNTIL_TAP ? 0 : (Number(step.value) || 0);
            }

            if (step.type === 'inhale') {
                durations.inhale += duration;
                afterInhale = true;
                afterExhale = false;
            } else if (step.type === 'exhale') {
                durations.exhale += duration;
                afterExhale = true;
                afterInhale = false;
            } else if (step.type === 'hold') {
                // Assign hold to holdInhale or holdExhale based on what came before
                if (afterInhale) {
                    durations.holdInhale += duration;
                } else if (afterExhale) {
                    durations.holdExhale += duration;
                } else {
                    // Hold at the start, treat as holdExhale (before first inhale)
                    durations.holdExhale += duration;
                }
            }
        }

        // Only return if we found at least inhale or exhale
        if (durations.inhale > 0 || durations.exhale > 0) {
            return durations;
        }
    }

    // Fallback: return minimal durations to avoid division by zero
    return { inhale: 1, holdInhale: 0, exhale: 1, holdExhale: 0 };
}

function startComposableSession() {
    state.isRunning = true;
    state.isPaused = false;
    state.currentPhase = 'inhale';
    state.elapsedSeconds = 0;
    state.lastIntervalNotification = 0;
    state.totalPausedMs = 0;
    state.sessionStartTime = performance.now();
    state.pauseStartedAt = null;
    state.phaseAnchorSec = 0;
    state.cycleAnchorSec = 0;
    state.pausedPhaseElapsed = 0;

    breathingCircle.classList.add('animating');

    closePresetsDrawer();
    closeModal(customizeModal);
    closeModal(audioModal);
    updateLayoutForSettings();

    state.animationFrame = requestAnimationFrame(animate);
    startTimer();
    instructionText.textContent = 'Tap to pause. Long-press to reset.';
    requestWakeLock();
    updateTimerIcon();

    // seed root frame and start first step
    composableState.stack = [];
    const rootFrame = createFrameForSteps(composableState.activePreset.steps);
    pushComposableFrame(rootFrame);
    advanceComposableStep();
}

function endComposableSession() {
    state.isRunning = false;
    composableState.currentStep = null;
    composableState.currentStepDuration = null;
    composableState.awaitingTap = false;
    composableState.stack = [];
    composableState.repeatStopFrame = null;

    breathingCircle.classList.remove('animating');
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
    stopTimer();
    stopAllAudio();
    releaseWakeLock();
    updateTimerIcon();

    phaseText.textContent = 'Done';
    instructionText.textContent = 'Session complete';
    phaseCountdown.textContent = '';
}

// Called from presets.js when a composable preset is selected
function onComposablePresetSelected(preset) {
    console.log('[DEBUG] onComposablePresetSelected called with preset:', preset?.id);
    try {
        const normalized = normalizeComposablePreset(preset);
        console.log('[DEBUG] Normalized preset:', !!normalized);
        if (!normalized) {
            console.error('Failed to normalize composable preset');
            return;
        }
        // Reset composable state first, then set the active preset
        resetComposableState();
        composableState.activePreset = normalized;
        // Store raw preset for configurable path access
        composableState.rawPreset = preset;
        updateCurrentPresetDisplay();
        // Build the graph timeline for visualization
        buildComposableGraphTimeline();
        console.log('[DEBUG] composableState.activePreset set:', !!composableState.activePreset);
        console.log('[DEBUG] Graph timeline built, duration:', composableState.graphTimelineDuration);
    } catch (e) {
        console.error('Error normalizing composable preset:', e);
    }
}

// ---------- Configurable UI helpers ----------

// Normalize configurable entry to { path, label }
function normalizeConfigurableEntry(entry) {
    if (typeof entry === 'string') {
        return { path: entry, label: null };
    }
    if (entry && typeof entry === 'object') {
        return { path: entry.path || '', label: entry.label || null };
    }
    return { path: '', label: null };
}

/**
 * Navigate a configurable path and get the value from the raw preset.
 * Path format: "repeat|steps|breaths|repeat|n" where segments are:
 * - "repeat" or "steps" navigate into that property
 * - An id value (like "breaths") finds a step with that id
 * - Final segment is the property name to get/set
 * @param {Object} preset - The raw preset object
 * @param {string|Object} entry - Configurable entry
 * @returns {*} The value at the path, or undefined if not found
 */
function getConfigurableValue(preset, entry) {
    const { path } = normalizeConfigurableEntry(entry);
    if (!preset || !path) return undefined;
    
    const segments = path.split('|');
    let current = preset;
    
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const isLast = i === segments.length - 1;
        
        if (current === null || current === undefined) {
            return undefined;
        }
        
        if (segment === 'repeat') {
            // Navigate into repeat block
            if (current.repeat) {
                current = current.repeat;
            } else if (Array.isArray(current)) {
                // Find first repeat in array
                const repeatStep = current.find(s => s.repeat);
                current = repeatStep?.repeat;
            } else if (Array.isArray(current.steps)) {
                // Find first repeat in steps
                const repeatStep = current.steps.find(s => s.repeat);
                current = repeatStep?.repeat;
            } else {
                return undefined;
            }
        } else if (segment === 'steps') {
            // Navigate into steps array
            if (Array.isArray(current.steps)) {
                current = current.steps;
            } else if (Array.isArray(current)) {
                current = current;
            } else {
                return undefined;
            }
        } else if (Array.isArray(current)) {
            // Look for a step with matching id
            const found = current.find(s => {
                const stepId = s.id || s.repeat?.id;
                return stepId === segment;
            });
            if (found) {
                current = found;
            } else {
                // Try numeric index as fallback
                const idx = parseInt(segment, 10);
                if (!isNaN(idx) && idx >= 0 && idx < current.length) {
                    current = current[idx];
                } else {
                    return undefined;
                }
            }
        } else if (isLast) {
            // Final segment - get the property value
            return current[segment];
        } else {
            // Navigate into property
            if (current[segment] !== undefined) {
                current = current[segment];
            } else {
                return undefined;
            }
        }
    }
    
    return current;
}

/**
 * Set a value at a configurable path in the raw preset.
 * @param {Object} preset - The raw preset object
 * @param {string|Object} entry - Configurable entry
 * @param {*} value - The value to set
 * @returns {boolean} True if successful
 */
function setConfigurableValue(preset, entry, value) {
    const { path } = normalizeConfigurableEntry(entry);
    if (!preset || !path) return false;
    
    const segments = path.split('|');
    const lastSegment = segments.pop();
    let current = preset;
    
    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        
        if (current === null || current === undefined) {
            return false;
        }
        
        if (segment === 'repeat') {
            if (current.repeat) {
                current = current.repeat;
            } else if (Array.isArray(current)) {
                const repeatStep = current.find(s => s.repeat);
                current = repeatStep?.repeat;
            } else if (Array.isArray(current.steps)) {
                const repeatStep = current.steps.find(s => s.repeat);
                current = repeatStep?.repeat;
            } else {
                return false;
            }
        } else if (segment === 'steps') {
            if (Array.isArray(current.steps)) {
                current = current.steps;
            } else if (Array.isArray(current)) {
                current = current;
            } else {
                return false;
            }
        } else if (Array.isArray(current)) {
            const found = current.find(s => {
                const stepId = s.id || s.repeat?.id;
                return stepId === segment;
            });
            if (found) {
                current = found;
            } else {
                const idx = parseInt(segment, 10);
                if (!isNaN(idx) && idx >= 0 && idx < current.length) {
                    current = current[idx];
                } else {
                    return false;
                }
            }
        } else {
            if (current[segment] !== undefined) {
                current = current[segment];
            } else {
                return false;
            }
        }
    }
    
    if (current && lastSegment) {
        current[lastSegment] = value;
        return true;
    }
    return false;
}

/**
 * Generate a human-readable label from a configurable path.
 * @param {string|Object} entry - Configurable entry (supports optional label)
 * @returns {string} Human-readable label
 */
function getConfigurableLabel(entry) {
    const normalized = normalizeConfigurableEntry(entry);
    if (!normalized.path) return 'Unknown';
    if (normalized.label) return normalized.label;
    const path = normalized.path;
    
    const segments = path.split('|');
    const lastSegment = segments[segments.length - 1];
    
    // Look for meaningful id in the path
    let contextId = null;
    for (const segment of segments) {
        if (segment !== 'repeat' && segment !== 'steps' && segment !== 'n' && segment !== 'bpm') {
            contextId = segment;
        }
    }
    
    // Map property names to friendly labels
    const propertyLabels = {
        'n': 'Count',
        'bpm': 'Breaths per Minute'
    };
    
    // Map context ids to friendly names
    const contextLabels = {
        'breaths': 'Breaths'
    };
    
    let label = propertyLabels[lastSegment] || lastSegment;
    
    if (contextId) {
        const contextLabel = contextLabels[contextId] || contextId;
        if (lastSegment === 'n') {
            // For 'n' (count), check if it's nested (breaths count) or top-level (cycles)
            if (segments.filter(s => s === 'repeat').length > 1) {
                label = `${contextLabel} per Cycle`;
            } else {
                label = 'Number of Cycles';
            }
        } else if (lastSegment === 'bpm') {
            label = `${contextLabel} BPM`;
        }
    } else {
        // No context - likely top-level repeat count
        if (lastSegment === 'n') {
            label = 'Number of Cycles';
        }
    }
    
    return label;
}

/**
 * Get input configuration for a configurable path.
 * @param {string|Object} entry - Configurable entry
 * @param {*} currentValue - Current value
 * @returns {Object} Input configuration {type, min, max, step, unit}
 */
function getConfigurableInputConfig(entry, currentValue) {
    const { path } = normalizeConfigurableEntry(entry);
    const lastSegment = path.split('|').pop();
    
    if (lastSegment === 'n') {
        return {
            type: 'range',
            min: 1,
            max: 60,
            step: 1,
            unit: ''
        };
    } else if (lastSegment === 'bpm') {
        return {
            type: 'range',
            min: 5,
            max: 60,
            step: 1,
            unit: ' BPM'
        };
    }
    
    // Default config for unknown types
    return {
        type: 'range',
        min: 0,
        max: 100,
        step: 1,
        unit: ''
    };
}

/**
 * Render the configurable controls UI for a composable preset.
 */
function renderConfigurableControls() {
    if (!configurableControlsContainer) return;
    
    // Clear existing controls
    configurableControlsContainer.innerHTML = '';
    
    const preset = composableState.rawPreset;
    if (!preset || !Array.isArray(preset.configurable) || preset.configurable.length === 0) {
        return;
    }
    
    // Update title with preset name
    if (composablePresetTitle) {
        composablePresetTitle.textContent = preset.label || 'Advanced Settings';
    }
    
    // Create controls for each configurable path
    preset.configurable.forEach((entry, index) => {
        const currentValue = getConfigurableValue(preset, entry);
        if (currentValue === undefined) {
            const { path } = normalizeConfigurableEntry(entry);
            console.warn(`Could not resolve configurable path: ${path}`);
            return;
        }

        const label = getConfigurableLabel(entry);
        const config = getConfigurableInputConfig(entry, currentValue);
        
        const settingItem = document.createElement('div');
        settingItem.className = 'setting-item';
        
        const labelEl = document.createElement('label');
        labelEl.textContent = label;
        labelEl.setAttribute('for', `configurable-${index}`);
        settingItem.appendChild(labelEl);
        
        const input = document.createElement('input');
        input.type = config.type;
        input.id = `configurable-${index}`;
        input.min = config.min;
        input.max = config.max;
        input.step = config.step;
        input.value = currentValue;
        const { path } = normalizeConfigurableEntry(entry);
        input.dataset.path = path;
        settingItem.appendChild(input);
        
        const valueDisplay = document.createElement('div');
        valueDisplay.className = 'setting-value';
        const valueSpan = document.createElement('span');
        valueSpan.id = `configurable-value-${index}`;
        valueSpan.textContent = currentValue;
        valueDisplay.appendChild(valueSpan);
        valueDisplay.appendChild(document.createTextNode(config.unit));
        settingItem.appendChild(valueDisplay);
        
        // Add input event listener
        input.addEventListener('input', (e) => {
            const newValue = parseFloat(e.target.value);
            valueSpan.textContent = newValue;
            
            // Update the raw preset
            setConfigurableValue(preset, entry, newValue);
            
            // Re-normalize and update the active preset
            try {
                const normalized = normalizeComposablePreset(preset);
                if (normalized) {
                    composableState.activePreset = normalized;
                    buildComposableGraphTimeline();
                    renderGraphWithCurrentSettings();
                }
            } catch (e) {
                console.error('Error updating composable preset:', e);
            }
        });
        
        configurableControlsContainer.appendChild(settingItem);
    });
}

/**
 * Update the customize modal to show appropriate controls based on preset type.
 */
function updateCustomizeModalForPreset() {
    const rawPreset = composableState.rawPreset || composableState.activePreset;
    const hasConfigurable = rawPreset && Array.isArray(rawPreset.configurable) && rawPreset.configurable.length > 0;
    const hasSteps = rawPreset && Array.isArray(rawPreset.steps);
    const isComposable = !!(rawPreset && (hasConfigurable || hasSteps));

    setAdvancedPresetVisibility(isComposable);

    if (simplePresetControls) {
        simplePresetControls.style.display = isComposable ? 'none' : 'block';
    }

    if (composablePresetControls) {
        composablePresetControls.style.display = isComposable ? 'block' : 'none';
        
        if (isComposable) {
            renderConfigurableControls();
        }
    }
}

function updateRatioDisplay() {
    if (!ratioDisplay) return;
    const ratio = settings.inhaleSeconds > 0 ? (settings.exhaleSeconds / settings.inhaleSeconds) : settings.exhaleRatio;
    ratioDisplay.textContent = `1:${formatRatio(ratio)}`;
}

function updateRhythmDisplay() {
    if (!quickRhythmDisplay) return;
    const parts = [
        formatSeconds(settings.inhaleSeconds),
        formatSeconds(settings.holdInhale),
        formatSeconds(settings.exhaleSeconds),
        formatSeconds(settings.holdExhale)
    ];
    quickRhythmDisplay.textContent = parts.join('/');
    updateCurrentPresetDisplay(parts.join('/'));
}

function updateCurrentPresetDisplay(rhythmStringOverride = null) {
    if (!currentPresetDisplay) return;

    // Prefer composable preset label if active
    if (composableState.rawPreset && composableState.rawPreset.label) {
        currentPresetDisplay.textContent = composableState.rawPreset.label;
        return;
    }

    // Try to find the selected simple preset label
    if (selectedPresetId && Array.isArray(loadedPresets)) {
        const preset = loadedPresets.find((p) => p.id === selectedPresetId);
        if (preset && preset.label) {
            currentPresetDisplay.textContent = preset.label;
            return;
        }
    }

    // Fallback: show configured rhythm string
    const rhythmString = rhythmStringOverride || [
        formatSeconds(settings.inhaleSeconds),
        formatSeconds(settings.holdInhale),
        formatSeconds(settings.exhaleSeconds),
        formatSeconds(settings.holdExhale)
    ].join('/');

    currentPresetDisplay.textContent = rhythmString;
}

// Timer functions
function startTimer() {
    stopTimer();
    state.timerInterval = setInterval(() => {
        state.elapsedSeconds++;
        updateTimerDisplay();
        checkIntervalNotification();
    }, 1000);
}

function stopTimer() {
    if (state.timerInterval) {
        clearInterval(state.timerInterval);
        state.timerInterval = null;
    }
}

function updateTimerDisplay() {
    const minutes = Math.floor(state.elapsedSeconds / 60);
    const seconds = state.elapsedSeconds % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function updateTimerIcon() {
    if (!timerIcon) return;
    const isActive = state.isRunning && !state.isPaused;
    timerIcon.textContent = isActive ? '⏸' : '▶';
    timerIcon.classList.toggle('is-running', isActive);
}

// Interval notification
function checkIntervalNotification() {
    if (settings.intervalMinutes === 0) return;
    
    const intervalSeconds = settings.intervalMinutes * 60;
    const currentInterval = Math.floor(state.elapsedSeconds / intervalSeconds);
    
    if (currentInterval > state.lastIntervalNotification && state.elapsedSeconds > 0) {
        state.lastIntervalNotification = currentInterval;
        showNotification(`${settings.intervalMinutes * currentInterval} minute${currentInterval > 1 ? 's' : ''} completed!`);
        playGong();
    }
}

function showNotification(message) {
    notification.textContent = message;
    notification.classList.add('show');
    
    setTimeout(() => {
        notification.classList.remove('show');
    }, 3000);
}

// Settings persistence using cookies
function saveSettings() {
    const cookieValue = JSON.stringify(settings);
    const expiryDate = new Date();
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
    document.cookie = `breathworkSettings=${encodeURIComponent(cookieValue)};expires=${expiryDate.toUTCString()};path=/;SameSite=Lax`;

    renderGraphWithCurrentSettings();
}

function loadSettings() {
    const cookies = document.cookie.split(';');
    for (let cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'breathworkSettings') {
            try {
                const saved = JSON.parse(decodeURIComponent(value));
                settings = { ...settings, ...saved };
                selectedPresetId = settings.selectedPresetId || null;
            } catch (e) {
                console.log('Could not parse saved settings');
            }
            break;
        }
    }
}

function updateUIFromSettings() {
    bpmSlider.value = settings.bpm;
    document.getElementById('bpmValue').textContent = settings.bpm;
    inhaleSecondsSlider.value = settings.inhaleSeconds;
    document.getElementById('inhaleSecondsValue').textContent = formatSeconds(settings.inhaleSeconds);

    exhaleSecondsSlider.value = settings.exhaleSeconds;
    document.getElementById('exhaleSecondsValue').textContent = formatSeconds(settings.exhaleSeconds);
    
    holdInhaleSlider.value = settings.holdInhale;
    document.getElementById('holdInhaleValue').textContent = formatSeconds(settings.holdInhale);
    
    holdExhaleSlider.value = settings.holdExhale;
    document.getElementById('holdExhaleValue').textContent = formatSeconds(settings.holdExhale);
    
    breathingSoundsToggle.checked = settings.breathingSoundsEnabled;
    chimeToggle.checked = settings.chimeEnabled;
    voiceToggle.checked = settings.voiceEnabled;

    intervalSlider.value = settings.intervalMinutes;
    document.getElementById('intervalValue').textContent = settings.intervalMinutes;

    updateRatioDisplay();
    updateRhythmDisplay();
}

// Modal + drawer helpers
function updateBodyModalState() {
    const hasModal = (customizeModal?.classList.contains('open')) || (audioModal?.classList.contains('open')) || (settingsPanel?.classList.contains('open')) || (disclaimerModal?.classList.contains('open'));
    document.body.classList.toggle('has-modal', !!hasModal);
    document.body.classList.toggle('modal-open', !!hasModal);
}

function openPresetsDrawer() {
    settingsPanel?.classList.add('open');
    settingsOverlay?.classList.add('show');
    morePresetsBtn?.setAttribute('aria-expanded', 'true');
    updateBodyModalState();
}

function closePresetsDrawer() {
    settingsPanel?.classList.remove('open');
    settingsOverlay?.classList.remove('show');
    morePresetsBtn?.setAttribute('aria-expanded', 'false');
    updateBodyModalState();
}

function openModal(modalEl) {
    if (modalEl) modalEl.classList.add('open');
    updateBodyModalState();
}

function closeModal(modalEl) {
    if (modalEl) modalEl.classList.remove('open');
    updateBodyModalState();
}

// Disclaimer handling
async function loadDisclaimer() {
    if (disclaimerLoaded) return;
    try {
        const res = await fetch('DISCLAIMER.md');
        const text = await res.text();
        disclaimerContent.textContent = text;
        disclaimerLoaded = true;
    } catch (e) {
        console.error('Failed to load disclaimer', e);
        disclaimerContent.textContent = 'Unable to load disclaimer text. Please refresh and ensure you can view the disclaimer.';
    }
}

function showDisclaimer() {
    openModal(disclaimerModal);
    if (disclaimerSnoozeCheckbox) {
        disclaimerSnoozeCheckbox.checked = false;
    }
    disclaimerAgreeBtn?.focus({preventScroll: true});
}

function hideDisclaimer() {
    closeModal(disclaimerModal);
}

function isDisclaimerAccepted() {
    if (disclaimerSessionAccepted) return true;
    try {
        const raw = localStorage.getItem(DISCLAIMER_KEY);
        if (!raw) return false;
        const parsed = JSON.parse(raw);
        if (!parsed?.expiresAt) return false;
        const now = Date.now();
        if (now < parsed.expiresAt) {
            return true;
        } else {
            localStorage.removeItem(DISCLAIMER_KEY);
            return false;
        }
    } catch (e) {
        return false;
    }
}

function acceptDisclaimer() {
    disclaimerSessionAccepted = true;
    const snoozeChecked = disclaimerSnoozeCheckbox?.checked;
    if (snoozeChecked) {
        const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
        try {
            localStorage.setItem(DISCLAIMER_KEY, JSON.stringify({ expiresAt }));
        } catch (e) {
            console.warn('Unable to persist disclaimer acceptance', e);
        }
    } else {
        try {
            localStorage.removeItem(DISCLAIMER_KEY);
        } catch (e) {
            // ignore
        }
    }
    hideDisclaimer();
}

function ensureDisclaimerAccepted() {
    if (isDisclaimerAccepted()) return true;
    showDisclaimer();
    return false;
}

// Session controls
function startSession() {
    if (!ensureDisclaimerAccepted()) {
        return;
    }
    console.log('[DEBUG] startSession called');
    console.log('[DEBUG] composableState.activePreset:', !!composableState.activePreset);
    initAudioContext();

    if (state.isPaused) {
        // Resume from pause
        state.isPaused = false;
        const now = performance.now();
        if (state.pauseStartedAt) {
            state.totalPausedMs += now - state.pauseStartedAt;
            state.pauseStartedAt = null;
        }
        state.pausedPhaseElapsed = 0;
        breathingCircle.classList.add('animating');
        state.animationFrame = requestAnimationFrame(animate);
        startTimer();
        instructionText.textContent = 'Tap to pause. Long-press to reset.';
        requestWakeLock();
        updateTimerIcon();
        return;
    }

    // If a composable preset is active, use the composable session flow
    if (composableState.activePreset) {
        startComposableSession();
        return;
    }
    
    state.isRunning = true;
    state.isPaused = false;
    state.currentPhase = 'inhale';
    state.elapsedSeconds = 0;
    state.lastIntervalNotification = 0;
    state.totalPausedMs = 0;
    state.sessionStartTime = performance.now();
    state.pauseStartedAt = null;
    state.phaseAnchorSec = 0;
    state.cycleAnchorSec = 0;
    state.pausedPhaseElapsed = 0;

    breathingCircle.classList.add('animating');

    // Close any open sheets/modals when starting
    closePresetsDrawer();
    closeModal(customizeModal);
    closeModal(audioModal);
    updateLayoutForSettings();

    renderGraphWithCurrentSettings();

    transitionToPhase('inhale', 0);
    state.animationFrame = requestAnimationFrame(animate);
    startTimer();
    instructionText.textContent = 'Tap to pause. Long-press to reset.';
    requestWakeLock();
    updateTimerIcon();
}

function pauseSession() {
    state.isPaused = true;
    breathingCircle.classList.remove('animating');
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
    const now = performance.now();
    state.pauseStartedAt = now;
    state.pausedPhaseElapsed = getElapsedSeconds(now) - state.phaseAnchorSec;
    stopTimer();
    stopAllAudio();
    instructionText.textContent = 'Tap to resume. Long-press to reset.';
    releaseWakeLock();
    updateTimerIcon();
}

function resetSession() {
    state.isRunning = false;
    state.isPaused = false;
    state.currentPhase = 'ready';
    state.elapsedSeconds = 0;
    state.lastIntervalNotification = 0;
    state.totalPausedMs = 0;
    state.sessionStartTime = null;
    state.pauseStartedAt = null;
    state.phaseAnchorSec = 0;
    state.cycleAnchorSec = 0;
    state.pausedPhaseElapsed = 0;

    // Clear composable preset state
    resetComposableState();

    breathingCircle.classList.remove('animating');
    breathingCircle.style.transform = 'scale(1)';
    phaseText.textContent = 'Ready';
    instructionText.textContent = 'Tap the circle or graph to begin.';
    phaseCountdown.textContent = '';

    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
    stopTimer();
    stopAllAudio();
    updateTimerDisplay();
    releaseWakeLock();
    updateTimerIcon();

    renderGraphWithCurrentSettings();
}

// Tap + long-press controls on primary surfaces
const TAP_TARGETS = [breathingCircle, breathingGraphContainer];
const LONG_PRESS_MS = 700;
let resetTimer = null;
let resetTriggered = false;

function clearResetTimer() {
    if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
    }
}

function scheduleReset() {
    resetTriggered = false;
    clearResetTimer();
    resetTimer = setTimeout(() => {
        resetTriggered = true;
        resetSession();
    }, LONG_PRESS_MS);
}

function handleTapToggle() {
    if (resetTriggered) {
        resetTriggered = false;
        return;
    }

    // Handle tap during composable holdUntilTap phase
    if (state.isRunning && !state.isPaused && composableState.awaitingTap) {
        composableState.awaitingTap = false;
        advanceGraphPastUntilTap();
        advanceComposableStep();
        return;
    }

    if (!state.isRunning || state.isPaused) {
        startSession();
    } else {
        pauseSession();
    }
}

TAP_TARGETS.forEach((el) => {
    el?.addEventListener('click', handleTapToggle);
    el?.addEventListener('pointerdown', scheduleReset);
    el?.addEventListener('pointerup', () => {
        clearResetTimer();
    });
    el?.addEventListener('pointerleave', clearResetTimer);
    el?.addEventListener('pointercancel', clearResetTimer);
});

// Timer icon controls
timerIcon?.addEventListener('click', handleTapToggle);
timerIcon?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTapToggle();
    }
});

// Keyboard shortcuts for start/stop (Enter) and tap (Space)
document.addEventListener('keydown', (e) => {
    const targetTag = e.target?.tagName;
    const isEditableTarget = (e.target?.isContentEditable) || targetTag === 'INPUT' || targetTag === 'TEXTAREA' || targetTag === 'SELECT' || targetTag === 'BUTTON';
    if (isEditableTarget) return;

    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        handleTapToggle();
    }
});
morePresetsBtn?.addEventListener('click', () => {
    const isOpen = settingsPanel?.classList.contains('open');
    if (isOpen) {
        closePresetsDrawer();
    } else {
        openPresetsDrawer();
    }
});

presetsCloseBtn?.addEventListener('click', () => {
    closePresetsDrawer();
});

settingsOverlay?.addEventListener('click', () => {
    closePresetsDrawer();
});

settingsPanel?.addEventListener('click', (e) => {
    if (e.target === settingsPanel) {
        closePresetsDrawer();
    }
});

customizeBtn?.addEventListener('click', () => {
    openPresetsDrawer();
    openModal(customizeModal);
    if (typeof updateCustomizeModalForPreset === 'function') {
        updateCustomizeModalForPreset();
    }
});

customizeCloseBtn?.addEventListener('click', () => {
    closeModal(customizeModal);
    openPresetsDrawer();
});
customizeDoneBtn?.addEventListener('click', () => {
    closeModal(customizeModal);
    openPresetsDrawer();
});
customizeSaveBtn?.addEventListener('click', () => {
    // Keep the currently active preset selected, even after tweaking advanced/composable presets.
    // For simple presets, the selectedPresetId will already be set; for composable presets, keep their id.
    // Avoid forcing the selection to the generic "custom" slot so users see the same preset highlighted.
    saveSettings();
    syncSessionAfterSettingsChange();
    updateUIFromSettings();
    showNotification('Custom settings saved');
    closeModal(customizeModal);
    openPresetsDrawer();
});
customizeModal?.addEventListener('click', (e) => {
    if (e.target === customizeModal) {
        closeModal(customizeModal);
        openPresetsDrawer();
    }
});

audioBtn?.addEventListener('click', () => openModal(audioModal));
audioCloseBtn?.addEventListener('click', () => closeModal(audioModal));
audioModal?.addEventListener('click', (e) => {
    if (e.target === audioModal) {
        closeModal(audioModal);
    }
});

presetsGoBtn?.addEventListener('click', () => {
    closePresetsDrawer();
    startSession();
});

quickPresetFunctional?.addEventListener('click', () => {
    const preset = loadedPresets?.find((p) => p.id === 'functional');
    if (preset) {
        applyPresetFromConfig(preset);
        setSelectedPreset('functional');
        syncSessionAfterSettingsChange();
        closePresetsDrawer();
        startSession();
    }
});

quickPresetBox?.addEventListener('click', () => {
    const preset = loadedPresets?.find((p) => p.id === 'box');
    if (preset) {
        applyPresetFromConfig(preset);
        setSelectedPreset('box');
        syncSessionAfterSettingsChange();
        closePresetsDrawer();
        startSession();
    }
});

// Settings change handlers
bpmSlider.addEventListener('input', (e) => {
    settings.bpm = parseInt(e.target.value);
    document.getElementById('bpmValue').textContent = settings.bpm;
    // When BPM is adjusted, prefer BPM mode and keep relative phase ratios
    settings.mode = 'bpm';

    const currentTotal = settings.inhaleSeconds + settings.holdInhale + settings.exhaleSeconds + settings.holdExhale;
    if (currentTotal > 0) {
        const targetTotal = 60 / settings.bpm;
        const scale = targetTotal / currentTotal;

        settings.inhaleSeconds *= scale;
        settings.holdInhale *= scale;
        settings.exhaleSeconds *= scale;
        settings.holdExhale *= scale;
    }

    inhaleSecondsSlider.value = settings.inhaleSeconds;
    document.getElementById('inhaleSecondsValue').textContent = formatSeconds(settings.inhaleSeconds);
    holdInhaleSlider.value = settings.holdInhale;
    document.getElementById('holdInhaleValue').textContent = formatSeconds(settings.holdInhale);
    exhaleSecondsSlider.value = settings.exhaleSeconds;
    document.getElementById('exhaleSecondsValue').textContent = formatSeconds(settings.exhaleSeconds);
    holdExhaleSlider.value = settings.holdExhale;
    document.getElementById('holdExhaleValue').textContent = formatSeconds(settings.holdExhale);

    // keep exhaleRatio in sync with seconds
    if (settings.inhaleSeconds > 0) {
        settings.exhaleRatio = settings.exhaleSeconds / settings.inhaleSeconds;
    }

    updateRatioDisplay();
    updateRhythmDisplay();
    saveSettings();
});

inhaleSecondsSlider.addEventListener('input', (e) => {
    settings.inhaleSeconds = parseFloat(e.target.value);
    document.getElementById('inhaleSecondsValue').textContent = formatSeconds(settings.inhaleSeconds);

    // When explicit seconds are adjusted, prefer seconds mode
    settings.mode = 'seconds';

    if (settings.inhaleSeconds > 0) {
        settings.exhaleRatio = settings.exhaleSeconds / settings.inhaleSeconds;
    }

    updateRatioDisplay();
    updateRhythmDisplay();
    saveSettings();
});

exhaleSecondsSlider.addEventListener('input', (e) => {
    settings.exhaleSeconds = parseFloat(e.target.value);
    document.getElementById('exhaleSecondsValue').textContent = formatSeconds(settings.exhaleSeconds);

    // When explicit seconds are adjusted, prefer seconds mode
    settings.mode = 'seconds';

    if (settings.inhaleSeconds > 0) {
        settings.exhaleRatio = settings.exhaleSeconds / settings.inhaleSeconds;
    }

    updateRatioDisplay();
    updateRhythmDisplay();
    saveSettings();
});

holdInhaleSlider.addEventListener('input', (e) => {
    settings.holdInhale = parseFloat(e.target.value);
    document.getElementById('holdInhaleValue').textContent = formatSeconds(settings.holdInhale);
    settings.mode = 'seconds';
    updateRhythmDisplay();
    saveSettings();
});

holdExhaleSlider.addEventListener('input', (e) => {
    settings.holdExhale = parseFloat(e.target.value);
    document.getElementById('holdExhaleValue').textContent = formatSeconds(settings.holdExhale);
    settings.mode = 'seconds';
    updateRhythmDisplay();
    saveSettings();
});

breathingSoundsToggle.addEventListener('change', (e) => {
    settings.breathingSoundsEnabled = e.target.checked;
    if (!e.target.checked) {
        stopBreathingSound(); // Stop any playing breathing sound when disabled
    }
    saveSettings();
});

chimeToggle.addEventListener('change', (e) => {
    settings.chimeEnabled = e.target.checked;
    saveSettings();
});

voiceToggle.addEventListener('change', (e) => {
    settings.voiceEnabled = e.target.checked;
    saveSettings();
});

intervalSlider.addEventListener('input', (e) => {
    settings.intervalMinutes = parseInt(e.target.value);
    document.getElementById('intervalValue').textContent = settings.intervalMinutes;
    saveSettings();
});

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    loadSettings();
    updateUIFromSettings();
    updateLayoutForSettings();
    resizeGraphCanvas();
    renderGraphWithCurrentSettings();
    updateTimerIcon();

    // Disclaimer
    loadDisclaimer();
    if (!isDisclaimerAccepted()) {
        showDisclaimer();
    }

    disclaimerAgreeBtn?.addEventListener('click', () => {
        acceptDisclaimer();
    });

    // Keep presets drawer closed on initial load; user can open via the toggle
    closePresetsDrawer();

    // Load breathing presets from YAML and render buttons
    loadPresetsFromYaml();

    // Preload voices for speech synthesis
    if ('speechSynthesis' in window) {
        speechSynthesis.getVoices();
        speechSynthesis.onvoiceschanged = () => {
            speechSynthesis.getVoices();
        };
    }
});

window.addEventListener('resize', () => {
    updateLayoutForSettings();
    resizeGraphCanvas();
    renderGraphWithCurrentSettings();
});

// Handle visibility change to pause when tab is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.isRunning && !state.isPaused) {
        // Optionally pause when tab is hidden
        // pauseSession();
    }

    if (!document.hidden && state.isRunning && !state.isPaused) {
        // Re-request wake lock when returning to the tab
        requestWakeLock();
    }
});

// Release wake lock when leaving the page
window.addEventListener('beforeunload', () => {
    releaseWakeLock();
});