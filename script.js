// App State
const state = {
    isRunning: false,
    isPaused: false,
    currentPhase: 'ready', // ready, inhale, holdInhale, exhale, holdExhale
    elapsedSeconds: 0,
    animationFrame: null,
    phaseStartTime: null,
    timerInterval: null,
    lastIntervalNotification: 0,
    graphStartTime: null,
    graphAccumulated: 0
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

// DOM Elements
const breathingCircle = document.getElementById('breathingCircle');
const phaseText = document.getElementById('phaseText');
const phaseCountdown = document.getElementById('phaseCountdown');
const timerDisplay = document.getElementById('timerDisplay');
const instructionText = document.getElementById('instructionText');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const settingsPanel = document.getElementById('settingsPanel');
const settingsToggle = document.getElementById('settingsToggle');
const notification = document.getElementById('notification');
const mainContainer = document.querySelector('.main-container');
const breathingGraph = document.getElementById('breathingGraph');
const breathingGraphDot = document.getElementById('breathingGraphDot');
const breathingGraphContainer = document.getElementById('breathingGraphContainer');
const graphCtx = breathingGraph ? breathingGraph.getContext('2d') : null;

// Sliders
const bpmSlider = document.getElementById('bpmSlider');
const ratioSlider = document.getElementById('ratioSlider');
const inhaleSecondsSlider = document.getElementById('inhaleSecondsSlider');
const exhaleSecondsSlider = document.getElementById('exhaleSecondsSlider');
const holdInhaleSlider = document.getElementById('holdInhaleSlider');
const holdExhaleSlider = document.getElementById('holdExhaleSlider');
const breathingSoundsToggle = document.getElementById('breathingSoundsToggle');
const chimeToggle = document.getElementById('chimeToggle');
const voiceToggle = document.getElementById('voiceToggle');
const intervalSlider = document.getElementById('intervalSlider');
const presetButtonsContainer = document.getElementById('presetButtonsContainer');

// Presets loaded from YAML
let loadedPresets = [];

// Graph config
const GRAPH_ANCHOR_TARGET = 0.2;
const GRAPH_ANCHOR_RAMP_SECONDS = 1.2;
const GRAPH_CYCLES_VISIBLE = 2;
const GRAPH_PADDING = 12;
const graphCanvasSize = { width: 0, height: 0 };

// Pattern display removed; mode is now internal-only

// Audio Context for generating sounds
let audioContext = null;
let breathingSound = null; // Track current breathing sound for cleanup

function initAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioContext.state === 'suspended') {
        audioContext.resume();
    }
}

// Create filtered noise for breathing sounds
function createNoiseBuffer(duration) {
    const sampleRate = audioContext.sampleRate;
    const bufferSize = sampleRate * duration;
    const buffer = audioContext.createBuffer(1, bufferSize, sampleRate);
    const data = buffer.getChannelData(0);
    
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    return buffer;
}

// Play inhale breathing sound - soft "shhhhee" suction-like noise
function playInhaleSound(duration) {
    if (!settings.breathingSoundsEnabled) return;

    initAudioContext();
    stopBreathingSound(); // Stop any existing breathing sound

    const noiseSource = audioContext.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(duration + 0.5);

    // Dual-filter chain for a softer, more focused breath tone
    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    // Gentle rising centre frequency for subtle "ee" character
    bandpass.frequency.setValueAtTime(220, audioContext.currentTime);
    bandpass.frequency.linearRampToValueAtTime(420, audioContext.currentTime + duration);
    bandpass.Q.value = 1.2;

    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = 'lowpass';
    // Roll off harsher highs so it stays pleasant on headphones
    lowpass.frequency.setValueAtTime(1500, audioContext.currentTime);

    // Softer gain envelope with rounded attack/release — slightly louder overall
    const gainNode = audioContext.createGain();
    const now = audioContext.currentTime;
    const attackEnd = now + duration * 0.25;
    const sustainEnd = now + duration * 0.85;

    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    // Increase peak and sustain for better audibility
    gainNode.gain.linearRampToValueAtTime(0.5, attackEnd);
    gainNode.gain.setValueAtTime(0.5, sustainEnd);
    gainNode.gain.linearRampToValueAtTime(0.02, now + duration);

    noiseSource.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(gainNode);
    gainNode.connect(audioContext.destination);

    noiseSource.start(now);
    noiseSource.stop(now + duration + 0.1);

    breathingSound = { source: noiseSource, gain: gainNode };
}

// Play exhale breathing sound - soft "sshuuu" release
function playExhaleSound(duration) {
    if (!settings.breathingSoundsEnabled) return;

    initAudioContext();
    stopBreathingSound(); // Stop any existing breathing sound

    const noiseSource = audioContext.createBufferSource();
    noiseSource.buffer = createNoiseBuffer(duration + 0.5);

    // Slightly lower, widening band for a warm "uuu" quality
    const bandpass = audioContext.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime(260, audioContext.currentTime);
    bandpass.frequency.linearRampToValueAtTime(180, audioContext.currentTime + duration);
    bandpass.Q.value = 0.9;

    const lowpass = audioContext.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(1300, audioContext.currentTime);

    // Exhale starts slightly stronger then gently fades out — overall louder
    const gainNode = audioContext.createGain();
    const now = audioContext.currentTime;
    const peakTime = now + duration * 0.15;
    const tailTime = now + duration * 0.8;

    gainNode.gain.cancelScheduledValues(now);
    gainNode.gain.setValueAtTime(0, now);
    // Increase levels ~2x while keeping the same contour
    gainNode.gain.linearRampToValueAtTime(0.6, peakTime);
    gainNode.gain.linearRampToValueAtTime(0.36, tailTime);
    gainNode.gain.linearRampToValueAtTime(0.01, now + duration);

    noiseSource.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(gainNode);
    gainNode.connect(audioContext.destination);

    noiseSource.start(now);
    noiseSource.stop(now + duration + 0.1);

    breathingSound = { source: noiseSource, gain: gainNode };
}

// Stop current breathing sound
function stopBreathingSound() {
    if (breathingSound) {
        try {
            breathingSound.gain.gain.cancelScheduledValues(audioContext.currentTime);
            breathingSound.gain.gain.setValueAtTime(0, audioContext.currentTime);
            breathingSound.source.stop(audioContext.currentTime);
        } catch (e) {
            // Sound may have already stopped
        }
        breathingSound = null;
    }
}

// Generate chime sound using Web Audio API
function playChime(frequency = 528, duration = 0.5) {
    if (!settings.chimeEnabled) return;
    
    initAudioContext();
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = frequency;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + duration);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + duration);
}

// Play gong sound for interval notifications
function playGong() {
    initAudioContext();
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 150;
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0.4, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 2);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 2);
}

// Voice synthesis
function speak(text) {
    if (!settings.voiceEnabled) return;
    
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 0.8;
    utterance.pitch = 1;
    utterance.volume = 0.7;
    
    // Try to find a calm, soothing voice
    const voices = speechSynthesis.getVoices();
    const preferredVoice = voices.find(v => v.name.includes('Female') || v.name.includes('Samantha')) || voices[0];
    if (preferredVoice) {
        utterance.voice = preferredVoice;
    }
    
    speechSynthesis.speak(utterance);
}

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

// Layout: keep breathing bubble + controls vertically centered
// in the space not occupied by the settings panel
function updateLayoutForSettings() {
    if (!mainContainer || !settingsPanel || !settingsToggle) return;

    const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
    const isOpen = settingsPanel.classList.contains('open');

    let occupiedHeight;
    if (isOpen) {
        occupiedHeight = settingsPanel.getBoundingClientRect().height;
    } else {
        occupiedHeight = settingsToggle.getBoundingClientRect().height;
    }

    const availableHeight = Math.max(viewportHeight - occupiedHeight, 0);
    const mainRect = mainContainer.getBoundingClientRect();
    const mainHeight = mainRect.height;

    const marginTop = Math.max((availableHeight - mainHeight) / 2, 20);
    mainContainer.style.marginTop = `${marginTop}px`;
    mainContainer.style.marginBottom = '20px';
}

function formatSeconds(value) {
    const rounded = Math.round(value * 10) / 10;
    if (Math.abs(rounded - Math.round(rounded)) < 0.05) {
        return Math.round(rounded).toString();
    }
    return rounded.toFixed(1);
}

function formatCountdownSeconds(value) {
    return Math.max(0, Math.ceil(value)).toString();
}

function getCurrentGraphTime(timestamp = performance.now()) {
    let time = state.graphAccumulated;
    if (state.graphStartTime != null) {
        time += (timestamp - state.graphStartTime) / 1000;
    }
    return time;
}

function resizeGraphCanvas() {
    if (!breathingGraph || !breathingGraphContainer || !graphCtx) return;

    const rect = breathingGraphContainer.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const targetWidth = Math.max(rect.width, 0);
    const targetHeight = Math.max(rect.height, 0);

    if (graphCanvasSize.width === targetWidth && graphCanvasSize.height === targetHeight && breathingGraph.width === targetWidth * dpr) {
        return;
    }

    graphCanvasSize.width = targetWidth;
    graphCanvasSize.height = targetHeight;

    breathingGraph.width = targetWidth * dpr;
    breathingGraph.height = targetHeight * dpr;
    graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    graphCtx.clearRect(0, 0, targetWidth, targetHeight);
}

function getBreathValueAt(timeSec, durations, totalCycle) {
    if (!durations) {
        durations = calculatePhaseDurations();
    }

    if (!totalCycle) {
        totalCycle = durations.inhale + durations.holdInhale + durations.exhale + durations.holdExhale;
    }

    if (totalCycle <= 0) return 0.5;

    let t = ((timeSec % totalCycle) + totalCycle) % totalCycle;

    if (t < durations.inhale) {
        return easeInOutSine(t / Math.max(durations.inhale, 0.001));
    }

    t -= durations.inhale;
    if (t < durations.holdInhale) {
        return 1;
    }

    t -= durations.holdInhale;
    if (t < durations.exhale) {
        return 1 - easeInOutSine(t / Math.max(durations.exhale, 0.001));
    }

    return 0; // hold exhale
}

function updateBreathingGraph(durations, timestamp = performance.now()) {
    if (!graphCtx || !breathingGraphContainer) return;

    resizeGraphCanvas();
    const width = graphCanvasSize.width;
    const height = graphCanvasSize.height;
    if (width === 0 || height === 0) return;

    if (!durations) {
        durations = calculatePhaseDurations();
    }

    const totalCycle = durations.inhale + durations.holdInhale + durations.exhale + durations.holdExhale;
    graphCtx.clearRect(0, 0, width, height);

    if (totalCycle <= 0) {
        if (breathingGraphDot) {
            breathingGraphDot.style.top = `${height / 2}px`;
        }
        return;
    }

    const currentTime = getCurrentGraphTime(timestamp);
    const anchorRatio = GRAPH_ANCHOR_TARGET;
    const anchorX = width * anchorRatio;
    if (breathingGraphDot) {
        breathingGraphDot.style.left = `${anchorRatio * 100}%`;
    }

    const secondsPerPixel = (totalCycle * GRAPH_CYCLES_VISIBLE) / Math.max(width, 1);
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

// Easing function for smooth animation
function easeInOutSine(t) {
    return -(Math.cos(Math.PI * t) - 1) / 2;
}

// Transition to a new phase
function transitionToPhase(phase) {
    state.currentPhase = phase;
    state.phaseStartTime = null;
    
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

// Start breathing session
function startSession() {
    initAudioContext();

    if (state.isPaused) {
        // Resume from pause
        state.isPaused = false;
        state.phaseStartTime = null;
        state.graphStartTime = null;
        startBtn.textContent = 'Pause';
        breathingCircle.classList.add('animating');
        state.animationFrame = requestAnimationFrame(animate);
        startTimer();
        return;
    }
    
    state.isRunning = true;
    state.isPaused = false;
    state.currentPhase = 'inhale';
    state.elapsedSeconds = 0;
    state.lastIntervalNotification = 0;
    state.graphAccumulated = 0;
    state.graphStartTime = null;

    startBtn.textContent = 'Pause';
    breathingCircle.classList.add('animating');
    
    // Close settings panel when starting
    settingsPanel.classList.remove('open');
    updateLayoutForSettings();

    renderGraphWithCurrentSettings();

    transitionToPhase('inhale');
    state.animationFrame = requestAnimationFrame(animate);
    startTimer();
}

// Pause session
function pauseSession() {
    state.isPaused = true;
    startBtn.textContent = 'Resume';

    state.graphAccumulated = getCurrentGraphTime();
    state.graphStartTime = null;
    
    if (state.animationFrame) {
        cancelAnimationFrame(state.animationFrame);
    }
    stopTimer();
    stopBreathingSound();
}

// Reset session
function resetSession() {
    state.isRunning = false;
    state.isPaused = false;
    state.currentPhase = 'ready';
    state.elapsedSeconds = 0;
    state.phaseStartTime = null;
    state.lastIntervalNotification = 0;
    state.graphStartTime = null;
    state.graphAccumulated = 0;
    
    if (state.animationFrame) {
        cancelAnimationFrame(state.animationFrame);
    }
    stopTimer();
    stopBreathingSound();
    
    startBtn.textContent = 'Start';
    phaseText.textContent = 'Ready';
    timerDisplay.textContent = '00:00';
    instructionText.textContent = 'Press Start to begin your breathing journey';
    breathingCircle.style.transform = 'scale(1)';
    if (phaseCountdown) {
        phaseCountdown.textContent = '';
    }
    breathingCircle.classList.remove('animating');

    renderGraphWithCurrentSettings();
}

// Timer functions
function startTimer() {
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
            } catch (e) {
                console.log('Could not parse saved settings');
            }
            break;
        }
    }
}

// Update UI from settings
function updateUIFromSettings() {
    bpmSlider.value = settings.bpm;
    document.getElementById('bpmValue').textContent = settings.bpm;
    
    ratioSlider.value = settings.exhaleRatio;
    document.getElementById('ratioValue').textContent = settings.exhaleRatio.toFixed(1).replace(/\.0$/, '');

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

    renderGraphWithCurrentSettings();
}

// Event Listeners
startBtn.addEventListener('click', () => {
    if (!state.isRunning || state.isPaused) {
        startSession();
    } else {
        pauseSession();
    }
});

resetBtn.addEventListener('click', resetSession);

settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('open');
    updateLayoutForSettings();
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
        ratioSlider.value = settings.exhaleRatio;
        document.getElementById('ratioValue').textContent = settings.exhaleRatio.toFixed(1).replace(/\.0$/, '');
    }

    saveSettings();
});

ratioSlider.addEventListener('input', (e) => {
    settings.exhaleRatio = parseFloat(e.target.value);
    document.getElementById('ratioValue').textContent = settings.exhaleRatio.toFixed(1).replace(/\.0$/, '');
    // When ratio is adjusted, prefer BPM mode and recompute inhale/exhale while keeping total cycle
    settings.mode = 'bpm';

    const totalCycle = settings.inhaleSeconds + settings.exhaleSeconds + settings.holdInhale + settings.holdExhale;
    const breathingTime = Math.max(totalCycle - (settings.holdInhale + settings.holdExhale), 0.5);
    const safeRatio = Math.max(settings.exhaleRatio, 0.1);
    const inhaleTime = breathingTime / (1 + safeRatio);
    const exhaleTime = inhaleTime * safeRatio;

    settings.inhaleSeconds = inhaleTime;
    settings.exhaleSeconds = exhaleTime;

    inhaleSecondsSlider.value = settings.inhaleSeconds;
    document.getElementById('inhaleSecondsValue').textContent = formatSeconds(settings.inhaleSeconds);
    exhaleSecondsSlider.value = settings.exhaleSeconds;
    document.getElementById('exhaleSecondsValue').textContent = formatSeconds(settings.exhaleSeconds);

    if (totalCycle > 0) {
        const newTotal = settings.inhaleSeconds + settings.exhaleSeconds + settings.holdInhale + settings.holdExhale;
        settings.bpm = Math.round(60 / newTotal);
        bpmSlider.value = settings.bpm;
        document.getElementById('bpmValue').textContent = settings.bpm;
    }

    saveSettings();
});

inhaleSecondsSlider.addEventListener('input', (e) => {
    settings.inhaleSeconds = parseFloat(e.target.value);
    document.getElementById('inhaleSecondsValue').textContent = formatSeconds(settings.inhaleSeconds);

    // When explicit seconds are adjusted, prefer seconds mode
    settings.mode = 'seconds';

    // Derive BPM and ratio from explicit seconds and holds
    const totalCycle = settings.inhaleSeconds + settings.exhaleSeconds + settings.holdInhale + settings.holdExhale;
    if (totalCycle > 0) {
        settings.bpm = Math.round(60 / totalCycle);
        if (settings.inhaleSeconds > 0) {
            settings.exhaleRatio = settings.exhaleSeconds / settings.inhaleSeconds;
            bpmSlider.value = settings.bpm;
            document.getElementById('bpmValue').textContent = settings.bpm;
            ratioSlider.value = settings.exhaleRatio;
            document.getElementById('ratioValue').textContent = settings.exhaleRatio.toFixed(1).replace(/\.0$/, '');
        } else {
            bpmSlider.value = settings.bpm;
            document.getElementById('bpmValue').textContent = settings.bpm;
        }
    }
    saveSettings();
});

exhaleSecondsSlider.addEventListener('input', (e) => {
    settings.exhaleSeconds = parseFloat(e.target.value);
    document.getElementById('exhaleSecondsValue').textContent = formatSeconds(settings.exhaleSeconds);

    // When explicit seconds are adjusted, prefer seconds mode
    settings.mode = 'seconds';

    // Derive BPM and ratio from explicit seconds and holds
    const totalCycle = settings.inhaleSeconds + settings.exhaleSeconds + settings.holdInhale + settings.holdExhale;
    if (totalCycle > 0) {
        settings.bpm = Math.round(60 / totalCycle);
        if (settings.inhaleSeconds > 0) {
            settings.exhaleRatio = settings.exhaleSeconds / settings.inhaleSeconds;
            bpmSlider.value = settings.bpm;
            document.getElementById('bpmValue').textContent = settings.bpm;
            ratioSlider.value = settings.exhaleRatio;
            document.getElementById('ratioValue').textContent = settings.exhaleRatio.toFixed(1).replace(/\.0$/, '');
        } else {
            bpmSlider.value = settings.bpm;
            document.getElementById('bpmValue').textContent = settings.bpm;
        }
    }
    saveSettings();
});

holdInhaleSlider.addEventListener('input', (e) => {
    settings.holdInhale = parseFloat(e.target.value);
    document.getElementById('holdInhaleValue').textContent = formatSeconds(settings.holdInhale);
    // In BPM mode, keep inhale/exhale seconds in sync with effective pattern
    if (settings.mode === 'bpm') {
        const bpmDurations = calculateDurationsFromBpmRatio(
            settings.bpm,
            settings.exhaleRatio,
            settings.holdInhale,
            settings.holdExhale
        );
        settings.inhaleSeconds = bpmDurations.inhaleTime;
        settings.exhaleSeconds = bpmDurations.exhaleTime;
        inhaleSecondsSlider.value = settings.inhaleSeconds;
        document.getElementById('inhaleSecondsValue').textContent = formatSeconds(settings.inhaleSeconds);
        exhaleSecondsSlider.value = settings.exhaleSeconds;
        document.getElementById('exhaleSecondsValue').textContent = formatSeconds(settings.exhaleSeconds);
    }
    saveSettings();
});

holdExhaleSlider.addEventListener('input', (e) => {
    settings.holdExhale = parseFloat(e.target.value);
    document.getElementById('holdExhaleValue').textContent = formatSeconds(settings.holdExhale);
    // In BPM mode, keep inhale/exhale seconds in sync with effective pattern
    if (settings.mode === 'bpm') {
        const bpmDurations = calculateDurationsFromBpmRatio(
            settings.bpm,
            settings.exhaleRatio,
            settings.holdInhale,
            settings.holdExhale
        );
        settings.inhaleSeconds = bpmDurations.inhaleTime;
        settings.exhaleSeconds = bpmDurations.exhaleTime;
        inhaleSecondsSlider.value = settings.inhaleSeconds;
        document.getElementById('inhaleSecondsValue').textContent = formatSeconds(settings.inhaleSeconds);
        exhaleSecondsSlider.value = settings.exhaleSeconds;
        document.getElementById('exhaleSecondsValue').textContent = formatSeconds(settings.exhaleSeconds);
    }
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
});

// -----------------------------
// Preset configuration (YAML)
// -----------------------------

function parseYamlValue(raw) {
    if (!raw) return '';
    // Strip surrounding quotes if present
    if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
        return raw.slice(1, -1);
    }
    if (/^-?\d+(\.\d+)?$/.test(raw)) {
        return parseFloat(raw);
    }
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return raw;
}

// Very small, purpose-built YAML reader for the presets.yaml format used here.
// It supports a single top-level key `presets:` with a list of `- key: value` maps.
function parsePresetsYaml(yamlText) {
    const lines = yamlText.split(/\r?\n/);
    const presets = [];
    let inPresetsList = false;
    let current = null;

    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        if (!rawLine) continue;

        const trimmedStart = rawLine.trimStart();
        const trimmed = rawLine.trim();

        // Skip comments and blank lines
        if (!trimmed || trimmedStart.startsWith('#')) continue;

        if (!inPresetsList) {
            if (trimmed === 'presets:' || trimmed.startsWith('presets:')) {
                inPresetsList = true;
            }
            continue;
        }

        // New item in list
        if (trimmedStart.startsWith('- ')) {
            if (current) {
                presets.push(current);
            }
            current = {};

            const rest = trimmedStart.slice(2).trim();
            if (rest) {
                const idx = rest.indexOf(':');
                if (idx !== -1) {
                    const key = rest.slice(0, idx).trim();
                    const val = rest.slice(idx + 1).trim();
                    current[key] = parseYamlValue(val);
                }
            }
            continue;
        }

        // Continuation key/value lines for current item (indented)
        if (current && (rawLine.startsWith('  ') || rawLine.startsWith('\t'))) {
            const line = trimmedStart; // remove leading base indentation
            const idx = line.indexOf(':');
            if (idx !== -1) {
                const key = line.slice(0, idx).trim();
                const val = line.slice(idx + 1).trim();
                current[key] = parseYamlValue(val);
            }
            continue;
        }

        // Any other top-level content ends the presets section
        if (current) {
            presets.push(current);
            current = null;
        }
        break;
    }

    if (current) {
        presets.push(current);
    }

    return presets;
}

function applyPresetFromConfig(preset) {
    if (!preset) return;

    const inhale = Number(preset.inhale) || 0;
    const holdInhale = Number(preset.holdInhale) || 0;
    const exhale = Number(preset.exhale) || 0;
    const holdExhale = Number(preset.holdExhale) || 0;

    settings.inhaleSeconds = inhale;
    settings.holdInhale = holdInhale;
    settings.exhaleSeconds = exhale;
    settings.holdExhale = holdExhale;

    const total = inhale + holdInhale + exhale + holdExhale;
    if (total > 0) {
        settings.bpm = Math.round(60 / total);
    }

    if (inhale > 0) {
        settings.exhaleRatio = exhale > 0 ? exhale / inhale : 1;
    }

    // Allow YAML to force a mode, otherwise infer from pattern
    if (preset.mode === 'bpm' || preset.mode === 'seconds') {
        settings.mode = preset.mode;
    } else {
        settings.mode = 'seconds';
    }

    updateUIFromSettings();
    saveSettings();
}

function syncSessionAfterSettingsChange() {
    if (state.isRunning && !state.isPaused) {
        state.currentPhase = 'inhale';
        state.phaseStartTime = null;
        state.graphAccumulated = 0;
        state.graphStartTime = null;
        transitionToPhase('inhale');
    }

    renderGraphWithCurrentSettings();
}

function renderPresetButtons() {
    if (!presetButtonsContainer || !Array.isArray(loadedPresets)) return;

    // Group by category for a bit of structure
    const byCategory = new Map();
    loadedPresets.forEach((p) => {
        const cat = p.category || 'Presets';
        if (!byCategory.has(cat)) {
            byCategory.set(cat, []);
        }
        byCategory.get(cat).push(p);
    });

    presetButtonsContainer.innerHTML = '';

    const closeAllTooltips = () => {
        presetButtonsContainer.querySelectorAll('.preset-btn.show-tooltip').forEach((btn) => {
            btn.classList.remove('show-tooltip');
        });
    };

    byCategory.forEach((presets, category) => {
        const groupWrapper = document.createElement('div');
        groupWrapper.className = 'preset-category-group';

        const heading = document.createElement('div');
        heading.className = 'preset-category-label';
        heading.textContent = category;
        groupWrapper.appendChild(heading);

        const row = document.createElement('div');
        row.className = 'preset-category-row';

        presets.forEach((preset) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn btn-secondary preset-btn';
            btn.setAttribute('data-preset-id', preset.id || '');
            if (preset.description) {
                btn.title = preset.description; // native tooltip fallback
            }

            const labelSpan = document.createElement('span');
            labelSpan.className = 'preset-label';
            labelSpan.textContent = preset.label || preset.id;
            btn.appendChild(labelSpan);

            const tooltip = document.createElement('span');
            tooltip.className = 'preset-tooltip';
            tooltip.textContent = preset.description || '';
            btn.appendChild(tooltip);

            const infoIcon = document.createElement('span');
            infoIcon.className = 'preset-info-icon';
            infoIcon.setAttribute('role', 'button');
            infoIcon.setAttribute('tabindex', '0');
            infoIcon.setAttribute('aria-label', `More info about ${preset.label || preset.id}`);
            infoIcon.textContent = 'i';

            infoIcon.addEventListener('click', (event) => {
                event.stopPropagation();
                const isOpen = btn.classList.contains('show-tooltip');
                closeAllTooltips();
                if (!isOpen) {
                    btn.classList.add('show-tooltip');
                    if (btn._tooltipTimeout) {
                        clearTimeout(btn._tooltipTimeout);
                    }
                    btn._tooltipTimeout = setTimeout(() => {
                        btn.classList.remove('show-tooltip');
                    }, 4000);
                }
            });

            infoIcon.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    infoIcon.click();
                }
            });

            btn.appendChild(infoIcon);

            btn.addEventListener('click', () => {
                closeAllTooltips();
                applyPresetFromConfig(preset);
                syncSessionAfterSettingsChange();
                updateLayoutForSettings();
            });

            row.appendChild(btn);
        });

        groupWrapper.appendChild(row);
        presetButtonsContainer.appendChild(groupWrapper);
    });
}

async function loadPresetsFromYaml() {
    try {
        const response = await fetch('presets.yaml', { cache: 'no-store' });
        if (!response.ok) {
            return;
        }
        const text = await response.text();
        loadedPresets = parsePresetsYaml(text) || [];
        renderPresetButtons();
    } catch (e) {
        // Fail silently; manual controls still work if presets cannot be loaded.
        console.error('Failed to load presets.yaml', e);
    }
}
