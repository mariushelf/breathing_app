// Graph config
const GRAPH_ANCHOR_TARGET = 0.2;
const GRAPH_ANCHOR_RAMP_SECONDS = 1.2;
const GRAPH_CYCLES_VISIBLE = 2;
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
    if (clamped >= 10) {
        return Math.round(clamped).toString();
    }
    return clamped.toFixed(1).replace(/\.0$/, '');
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
    const currentTime = ((timestamp - (state.graphStartTime || 0)) / 1000) + (state.graphAccumulated || 0);

    const width = graphCanvasSize.width;
    const height = graphCanvasSize.height;

    graphCtx.clearRect(0, 0, width, height);

    const secondsPerPixel = totalCycle / (GRAPH_CYCLES_VISIBLE * width);
    const anchorX = width * GRAPH_ANCHOR_TARGET;
    const anchorTargetTime = currentTime + (anchorX - width) * secondsPerPixel;
    const ramp = Math.min((timestamp - (state.graphStartTime || 0)) / 1000 / GRAPH_ANCHOR_RAMP_SECONDS, 1);
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

function renderGraphWithCurrentSettings(timestamp = performance.now()) {
    updateBreathingGraph(calculatePhaseDurations(), timestamp);
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
function transitionToPhase(phase) {
    state.currentPhase = phase;
    state.phaseStartTime = null;
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

    if (state.graphStartTime == null) {
        state.graphStartTime = timestamp;
    }

    if (!state.phaseStartTime) {
        state.phaseStartTime = timestamp;
    }
    
    const durations = calculatePhaseDurations();
    const elapsed = (timestamp - state.phaseStartTime) / 1000;
    
    let phaseDuration;
    let nextPhase;
    let scale;
    let remaining = 0;
    
    switch (state.currentPhase) {
        case 'inhale':
            phaseDuration = durations.inhale;
            nextPhase = settings.holdInhale > 0 ? 'holdInhale' : 'exhale';
            // Ease-in-out animation for smooth breathing
            const inhaleProgress = Math.min(elapsed / phaseDuration, 1);
            const easedInhale = easeInOutSine(inhaleProgress);
            scale = 1 + easedInhale * 0.8; // Scale from 1 to 1.8
            break;
            
        case 'holdInhale':
            phaseDuration = durations.holdInhale;
            nextPhase = 'exhale';
            const inhaleHoldOscillation = 0.02 * Math.sin(timestamp / 400);
            scale = 1.8 * (1 + inhaleHoldOscillation); // Stay expanded with gentle movement
            break;
            
        case 'exhale':
            phaseDuration = durations.exhale;
            nextPhase = settings.holdExhale > 0 ? 'holdExhale' : 'inhale';
            const exhaleProgress = Math.min(elapsed / phaseDuration, 1);
            const easedExhale = easeInOutSine(exhaleProgress);
            scale = 1.8 - easedExhale * 0.8; // Scale from 1.8 to 1
            break;
            
        case 'holdExhale':
            phaseDuration = durations.holdExhale;
            nextPhase = 'inhale';
            const exhaleHoldOscillation = 0.02 * Math.sin(timestamp / 400);
            scale = 1 * (1 + exhaleHoldOscillation); // Stay contracted with gentle movement
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
    
    // Apply scale
    breathingCircle.style.transform = `scale(${scale})`;

    updateBreathingGraph(durations, timestamp);
    
    // Check for phase transition
    if (elapsed >= phaseDuration) {
        transitionToPhase(nextPhase);
    }
    
    state.animationFrame = requestAnimationFrame(animate);
}