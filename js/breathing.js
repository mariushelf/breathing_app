// Graph config
const GRAPH_ANCHOR_TARGET = 0.2;
const GRAPH_ANCHOR_RAMP_SECONDS = 1.2;
const GRAPH_SECONDS_VISIBLE = 30;
const GRAPH_PADDING = 12;
const graphCanvasSize = { width: 0, height: 0 };

function calculateDurationsFromBpmRatio(bpm, exhaleRatio, holdInhale, holdExhale) {
    const breathCycleSeconds = 60 / bpm;
    const totalHoldTime = holdInhale + holdExhale;
    const breathingTime = Math.max(breathCycleSeconds - totalHoldTime, 0.5);

    // Ensure exhaleRatio stays positive to avoid division issues
    const safeRatio = Math.max(exhaleRatio, 0.1);

    const inhaleTime = breathingTime / (1 + safeRatio);
    const exhaleTime = inhaleTime * safeRatio;

    return { inhaleTime, exhaleTime };
}

// Calculate phase durations based on settings
function calculatePhaseDurations() {
    let inhaleTime;
    let exhaleTime;

    if (settings.mode === 'seconds') {
        // Use explicit seconds for inhale/exhale
        inhaleTime = settings.inhaleSeconds;
        exhaleTime = settings.exhaleSeconds;
    } else {
        const result = calculateDurationsFromBpmRatio(
            settings.bpm,
            settings.exhaleRatio,
            settings.holdInhale,
            settings.holdExhale
        );
        inhaleTime = result.inhaleTime;
        exhaleTime = result.exhaleTime;
    }
    
    return {
        inhale: inhaleTime,
        holdInhale: settings.holdInhale,
        exhale: exhaleTime,
        holdExhale: settings.holdExhale
    };
}

function formatCountdownSeconds(value) {
    const clamped = Math.max(0, value || 0);
    if (clamped >= 3) {
        return Math.round(clamped).toString();
    }
    return clamped.toFixed(1);
}

// Breath graph sampling helper
function getBreathValueAt(timeSec, durations, totalCycle) {
    const t = ((timeSec % totalCycle) + totalCycle) % totalCycle; // handle negative times gracefully

    const { inhale, holdInhale, exhale, holdExhale } = durations;

    if (t < inhale) {
        return easeInOutSine(t / inhale);
    }

    if (t < inhale + holdInhale) {
        return 1;
    }

    const afterHoldInhale = t - (inhale + holdInhale);
    if (afterHoldInhale < exhale) {
        return 1 - easeInOutSine(afterHoldInhale / exhale);
    }

    // hold after exhale
    return 0;
}

function updateBreathingGraph(durations, timestamp) {
    if (!graphCtx || !breathingGraph || !breathingGraphDot) return;

    const { inhale, holdInhale, exhale, holdExhale } = durations;
    const totalCycle = inhale + holdInhale + exhale + holdExhale;

    // Keep graph time aligned with a stable cycle anchor so we don't jump
    // on every phase change. The anchor is reset only when the session starts
    // or when presets change mid-session.
    const sessionTime = getElapsedSeconds(timestamp);
    const cycleAnchor = state.cycleAnchorSec || 0;
    const currentTime = Math.max(0, sessionTime - cycleAnchor);

    const width = graphCanvasSize.width;
    const height = graphCanvasSize.height;

    graphCtx.clearRect(0, 0, width, height);

    const visibleSeconds = GRAPH_SECONDS_VISIBLE || totalCycle;
    const secondsPerPixel = visibleSeconds / Math.max(width, 1);
    const anchorX = width * GRAPH_ANCHOR_TARGET;
    const anchorTargetTime = currentTime + (anchorX - width) * secondsPerPixel;
    const ramp = Math.min(Math.max(sessionTime - cycleAnchor, 0) / GRAPH_ANCHOR_RAMP_SECONDS, 1);
    const currentAnchorTarget = anchorTargetTime * ramp;

    const graphOffset = currentAnchorTarget;
    const visibleStart = currentTime - graphOffset;

    const secondsSpan = secondsPerPixel * width;
    const startTime = visibleStart - secondsSpan * GRAPH_ANCHOR_TARGET;
    const endTime = startTime + secondsSpan;

    // Draw axes
    graphCtx.lineWidth = 1;
    graphCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    graphCtx.beginPath();
    graphCtx.moveTo(0, GRAPH_PADDING);
    graphCtx.lineTo(width, GRAPH_PADDING);
    graphCtx.moveTo(0, height - GRAPH_PADDING);
    graphCtx.lineTo(width, height - GRAPH_PADDING);
    graphCtx.stroke();

    // Plot the waveform
    const innerHeight = Math.max(height - GRAPH_PADDING * 2, 1);

    graphCtx.lineWidth = 2;
    graphCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    graphCtx.beginPath();

    const step = 2;
    for (let x = 0; x <= width; x += step) {
        const sampleTime = currentTime + (x - anchorX) * secondsPerPixel;
        const value = getBreathValueAt(sampleTime, durations, totalCycle);
        const y = GRAPH_PADDING + (1 - value) * innerHeight;

        if (x === 0) {
            graphCtx.moveTo(x, y);
        } else {
            graphCtx.lineTo(x, y);
        }
    }
    graphCtx.stroke();

    // Anchor line at the dot
    graphCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    graphCtx.setLineDash([4, 8]);
    graphCtx.beginPath();
    graphCtx.moveTo(anchorX, 0);
    graphCtx.lineTo(anchorX, height);
    graphCtx.stroke();
    graphCtx.setLineDash([]);

    const dotValue = getBreathValueAt(currentTime, durations, totalCycle);
    const dotY = GRAPH_PADDING + (1 - dotValue) * innerHeight;
    if (breathingGraphDot) {
        breathingGraphDot.style.top = `${dotY}px`;
    }
}

// Update breathing graph for composable presets using flattened timeline
function updateComposableBreathingGraph(timestamp) {
    if (!graphCtx || !breathingGraph || !breathingGraphDot) return;
    
    const timeline = composableState.graphTimeline;
    const totalDuration = composableState.graphTimelineDuration;
    
    if (!timeline || timeline.length === 0 || totalDuration <= 0) {
        // Fallback to simple graph if no timeline
        const durations = getComposableCycleDurations();
        updateBreathingGraph(durations, timestamp);
        return;
    }
    
    const sessionTime = getElapsedSeconds(timestamp);
    const cycleAnchor = state.cycleAnchorSec || 0;
    
    // Get graph time (handles pausing at until_tap holds)
    let graphTime = getComposableGraphTime(sessionTime - cycleAnchor);
    
    const width = graphCanvasSize.width;
    const height = graphCanvasSize.height;
    
    graphCtx.clearRect(0, 0, width, height);
    
    const visibleSeconds = GRAPH_SECONDS_VISIBLE;
    const secondsPerPixel = visibleSeconds / Math.max(width, 1);
    const anchorX = width * GRAPH_ANCHOR_TARGET;
    
    // Ramp for smooth start
    const ramp = Math.min(Math.max(sessionTime - cycleAnchor, 0) / GRAPH_ANCHOR_RAMP_SECONDS, 1);
    const anchorTargetTime = graphTime + (anchorX - width) * secondsPerPixel;
    const currentAnchorTarget = anchorTargetTime * ramp;
    
    // Draw axes
    graphCtx.lineWidth = 1;
    graphCtx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    graphCtx.beginPath();
    graphCtx.moveTo(0, GRAPH_PADDING);
    graphCtx.lineTo(width, GRAPH_PADDING);
    graphCtx.moveTo(0, height - GRAPH_PADDING);
    graphCtx.lineTo(width, height - GRAPH_PADDING);
    graphCtx.stroke();
    
    // Plot the waveform using timeline
    const innerHeight = Math.max(height - GRAPH_PADDING * 2, 1);
    
    graphCtx.lineWidth = 2;
    graphCtx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    graphCtx.beginPath();
    
    const step = 2;
    for (let x = 0; x <= width; x += step) {
        const sampleTime = graphTime + (x - anchorX) * secondsPerPixel;
        const { value } = getBreathValueAtTimeline(sampleTime, timeline, totalDuration);
        const y = GRAPH_PADDING + (1 - value) * innerHeight;
        
        if (x === 0) {
            graphCtx.moveTo(x, y);
        } else {
            graphCtx.lineTo(x, y);
        }
    }
    graphCtx.stroke();
    
    // Draw a subtle indicator for timeline end if visible
    const endX = anchorX + (totalDuration - graphTime) / secondsPerPixel;
    if (endX > 0 && endX < width) {
        graphCtx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
        graphCtx.setLineDash([2, 4]);
        graphCtx.beginPath();
        graphCtx.moveTo(endX, 0);
        graphCtx.lineTo(endX, height);
        graphCtx.stroke();
        graphCtx.setLineDash([]);
    }
    
    // Anchor line at the dot
    graphCtx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    graphCtx.setLineDash([4, 8]);
    graphCtx.beginPath();
    graphCtx.moveTo(anchorX, 0);
    graphCtx.lineTo(anchorX, height);
    graphCtx.stroke();
    graphCtx.setLineDash([]);
    
    // Position the dot
    const { value: dotValue } = getBreathValueAtTimeline(graphTime, timeline, totalDuration);
    const dotY = GRAPH_PADDING + (1 - dotValue) * innerHeight;
    if (breathingGraphDot) {
        breathingGraphDot.style.top = `${dotY}px`;
    }
}

function renderGraphWithCurrentSettings(timestamp = performance.now()) {
    // Use composable timeline graph if a composable preset is active with a timeline
    if (composableState.activePreset !== null && composableState.graphTimeline) {
        updateComposableBreathingGraph(timestamp);
    } else {
        const durations = calculatePhaseDurations();
        updateBreathingGraph(durations, timestamp);
    }
}

function resizeGraphCanvas() {
    if (!breathingGraph || !breathingGraphContainer) return;

    const rect = breathingGraphContainer.getBoundingClientRect();
    breathingGraph.width = rect.width;
    breathingGraph.height = rect.height;
    graphCanvasSize.width = rect.width;
    graphCanvasSize.height = rect.height;
}

// Easing function for smooth animation
function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Transition to a new phase
function transitionToPhase(phase, anchorSec = getElapsedSeconds()) {
    state.currentPhase = phase;
    state.phaseAnchorSec = anchorSec;
    state.pausedPhaseElapsed = 0;
    
    const phaseNames = {
        inhale: 'Inhale',
        holdInhale: 'Hold',
        exhale: 'Exhale',
        holdExhale: 'Hold'
    };
    
    const phaseInstructions = {
        inhale: 'Breathe in slowly through your nose',
        holdInhale: 'Hold your breath gently',
        exhale: 'Release slowly through your mouth',
        holdExhale: 'Rest before the next breath'
    };
    
    phaseText.textContent = phaseNames[phase];
    instructionText.textContent = phaseInstructions[phase];
    
    // Get phase durations for breathing sounds
    const durations = calculatePhaseDurations();
    if (phaseCountdown) {
        if (phase === 'holdInhale' || phase === 'holdExhale') {
            const phaseDurationMap = {
                holdInhale: durations.holdInhale,
                holdExhale: durations.holdExhale
            };
            const initialCountdown = phaseDurationMap[phase];
            phaseCountdown.textContent = initialCountdown !== undefined ? formatCountdownSeconds(initialCountdown) : '';
        } else {
            phaseCountdown.textContent = '';
        }
    }
    
    // Play sounds and voice
    if (phase === 'inhale') {
        playChime(528, 0.5); // C note
        speak('Breathe in');
        playInhaleSound(durations.inhale);
    } else if (phase === 'exhale') {
        playChime(396, 0.5); // G note
        speak('Breathe out');
        playExhaleSound(durations.exhale);
    } else if (phase === 'holdInhale' || phase === 'holdExhale') {
        playChime(440, 0.3); // A note
        speak('Hold');
        stopBreathingSound(); // Stop breathing sound during hold phases
    }
}

// Animation loop
function animate(timestamp) {
    if (!state.isRunning || state.isPaused) return;

    const elapsed = getElapsedSeconds(timestamp) - (state.phaseAnchorSec || 0);
    
    let phaseDuration;
    let nextPhase;
    let scale;
    let remaining = 0;

    // Check if we're running a composable preset
    const isComposable = composableState.activePreset !== null;

    if (isComposable) {
        // Composable preset animation
        const step = composableState.currentStep;
        phaseDuration = composableState.currentStepDuration;

        switch (state.currentPhase) {
            case 'inhale': {
                const progress = phaseDuration > 0 ? Math.min(elapsed / phaseDuration, 1) : 1;
                const eased = easeInOutSine(progress);
                scale = 1 + eased * 0.8;
                break;
            }
            case 'exhale': {
                const progress = phaseDuration > 0 ? Math.min(elapsed / phaseDuration, 1) : 1;
                const eased = easeInOutSine(progress);
                scale = 1.8 - eased * 0.8;
                break;
            }
            case 'hold': {
                const oscillation = 0.02 * Math.sin(timestamp / 400);
                scale = 1.8 * (1 + oscillation);
                remaining = phaseDuration > 0 ? Math.max(phaseDuration - elapsed, 0) : 0;
                if (phaseCountdown && phaseDuration > 0) {
                    phaseCountdown.textContent = formatCountdownSeconds(remaining);
                }
                break;
            }
            case 'holdUntilTap': {
                const oscillation = 0.02 * Math.sin(timestamp / 400);
                scale = 1 * (1 + oscillation);
                // No countdown for until_tap
                break;
            }
            default:
                scale = 1;
        }

        breathingCircle.style.transform = `scale(${scale})`;

        // Update the breathing graph for composable presets using timeline
        updateComposableBreathingGraph(timestamp);

        // Check for phase transition (not for holdUntilTap - that waits for user tap)
        if (state.currentPhase !== 'holdUntilTap' && phaseDuration !== null && elapsed >= phaseDuration) {
            advanceComposableStep();
        }
    } else {
        // Simple preset animation (original logic)
        const durations = calculatePhaseDurations();
        
        switch (state.currentPhase) {
            case 'inhale':
                phaseDuration = durations.inhale;
                nextPhase = settings.holdInhale > 0 ? 'holdInhale' : 'exhale';
                const inhaleProgress = Math.min(elapsed / phaseDuration, 1);
                const easedInhale = easeInOutSine(inhaleProgress);
                scale = 1 + easedInhale * 0.8;
                break;
                
            case 'holdInhale':
                phaseDuration = durations.holdInhale;
                nextPhase = 'exhale';
                const inhaleHoldOscillation = 0.02 * Math.sin(timestamp / 400);
                scale = 1.8 * (1 + inhaleHoldOscillation);
                break;
                
            case 'exhale':
                phaseDuration = durations.exhale;
                nextPhase = settings.holdExhale > 0 ? 'holdExhale' : 'inhale';
                const exhaleProgress = Math.min(elapsed / phaseDuration, 1);
                const easedExhale = easeInOutSine(exhaleProgress);
                scale = 1.8 - easedExhale * 0.8;
                break;
                
            case 'holdExhale':
                phaseDuration = durations.holdExhale;
                nextPhase = 'inhale';
                const exhaleHoldOscillation = 0.02 * Math.sin(timestamp / 400);
                scale = 1 * (1 + exhaleHoldOscillation);
                break;
                
            default:
                scale = 1;
        }

        const isHoldPhase = state.currentPhase === 'holdInhale' || state.currentPhase === 'holdExhale';
        if (typeof phaseDuration === 'number' && isFinite(phaseDuration)) {
            remaining = Math.max(phaseDuration - elapsed, 0);
            if (phaseCountdown) {
                phaseCountdown.textContent = isHoldPhase ? formatCountdownSeconds(remaining) : '';
            }
        } else if (phaseCountdown) {
            phaseCountdown.textContent = '';
        }
        
        breathingCircle.style.transform = `scale(${scale})`;

        updateBreathingGraph(durations, timestamp);
        
        // Check for phase transition
        if (elapsed >= phaseDuration) {
            transitionToPhase(nextPhase);
        }
    }
    
    state.animationFrame = requestAnimationFrame(animate);
}