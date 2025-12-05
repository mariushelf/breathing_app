// App State
const state = {
    isRunning: false,
    isPaused: false,
    currentPhase: 'ready', // ready, inhale, holdInhale, exhale, holdExhale
    elapsedSeconds: 0,
    animationFrame: null,
    phaseStartTime: null,
    timerInterval: null,
    lastIntervalNotification: 0
};

// Settings with defaults
let settings = {
    bpm: 6,
    exhaleRatio: 1.5,
    holdInhale: 0,
    holdExhale: 0,
    breathingSoundsEnabled: true,
    chimeEnabled: true,
    voiceEnabled: true,
    intervalMinutes: 1
};

// DOM Elements
const breathingCircle = document.getElementById('breathingCircle');
const phaseText = document.getElementById('phaseText');
const timerDisplay = document.getElementById('timerDisplay');
const instructionText = document.getElementById('instructionText');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
const settingsPanel = document.getElementById('settingsPanel');
const settingsToggle = document.getElementById('settingsToggle');
const notification = document.getElementById('notification');

// Sliders
const bpmSlider = document.getElementById('bpmSlider');
const ratioSlider = document.getElementById('ratioSlider');
const holdInhaleSlider = document.getElementById('holdInhaleSlider');
const holdExhaleSlider = document.getElementById('holdExhaleSlider');
const breathingSoundsToggle = document.getElementById('breathingSoundsToggle');
const chimeToggle = document.getElementById('chimeToggle');
const voiceToggle = document.getElementById('voiceToggle');
const intervalSlider = document.getElementById('intervalSlider');

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

// Calculate phase durations based on settings
function calculatePhaseDurations() {
    const breathCycleSeconds = 60 / settings.bpm;
    const totalHoldTime = settings.holdInhale + settings.holdExhale;
    const breathingTime = breathCycleSeconds - totalHoldTime;
    
    // Ensure we have positive breathing time
    const effectiveBreathingTime = Math.max(breathingTime, 2);
    
    const inhaleTime = effectiveBreathingTime / (1 + settings.exhaleRatio);
    const exhaleTime = inhaleTime * settings.exhaleRatio;
    
    return {
        inhale: inhaleTime,
        holdInhale: settings.holdInhale,
        exhale: exhaleTime,
        holdExhale: settings.holdExhale
    };
}

// Animation loop
function animate(timestamp) {
    if (!state.isRunning || state.isPaused) return;
    
    if (!state.phaseStartTime) {
        state.phaseStartTime = timestamp;
    }
    
    const durations = calculatePhaseDurations();
    const elapsed = (timestamp - state.phaseStartTime) / 1000;
    
    let phaseDuration;
    let nextPhase;
    let scale;
    
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
            scale = 1.8; // Stay expanded
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
            scale = 1; // Stay contracted
            break;
            
        default:
            scale = 1;
    }
    
    // Apply scale
    breathingCircle.style.transform = `scale(${scale})`;
    
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
    
    startBtn.textContent = 'Pause';
    breathingCircle.classList.add('animating');
    
    // Close settings panel when starting
    settingsPanel.classList.remove('open');
    
    transitionToPhase('inhale');
    state.animationFrame = requestAnimationFrame(animate);
    startTimer();
}

// Pause session
function pauseSession() {
    state.isPaused = true;
    startBtn.textContent = 'Resume';
    
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
    breathingCircle.classList.remove('animating');
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
    document.getElementById('ratioValue').textContent = settings.exhaleRatio;
    
    holdInhaleSlider.value = settings.holdInhale;
    document.getElementById('holdInhaleValue').textContent = settings.holdInhale;
    
    holdExhaleSlider.value = settings.holdExhale;
    document.getElementById('holdExhaleValue').textContent = settings.holdExhale;
    
    breathingSoundsToggle.checked = settings.breathingSoundsEnabled;
    chimeToggle.checked = settings.chimeEnabled;
    voiceToggle.checked = settings.voiceEnabled;
    
    intervalSlider.value = settings.intervalMinutes;
    document.getElementById('intervalValue').textContent = settings.intervalMinutes;
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
});

// Settings change handlers
bpmSlider.addEventListener('input', (e) => {
    settings.bpm = parseInt(e.target.value);
    document.getElementById('bpmValue').textContent = settings.bpm;
    saveSettings();
});

ratioSlider.addEventListener('input', (e) => {
    settings.exhaleRatio = parseFloat(e.target.value);
    document.getElementById('ratioValue').textContent = settings.exhaleRatio;
    saveSettings();
});

holdInhaleSlider.addEventListener('input', (e) => {
    settings.holdInhale = parseFloat(e.target.value);
    document.getElementById('holdInhaleValue').textContent = settings.holdInhale;
    saveSettings();
});

holdExhaleSlider.addEventListener('input', (e) => {
    settings.holdExhale = parseFloat(e.target.value);
    document.getElementById('holdExhaleValue').textContent = settings.holdExhale;
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
    
    // Preload voices for speech synthesis
    if ('speechSynthesis' in window) {
        speechSynthesis.getVoices();
        speechSynthesis.onvoiceschanged = () => {
            speechSynthesis.getVoices();
        };
    }
});

// Handle visibility change to pause when tab is hidden
document.addEventListener('visibilitychange', () => {
    if (document.hidden && state.isRunning && !state.isPaused) {
        // Optionally pause when tab is hidden
        // pauseSession();
    }
});
