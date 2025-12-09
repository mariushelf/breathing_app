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

// DOM Elements
const breathingCircle = document.getElementById('breathingCircle');
const phaseText = document.getElementById('phaseText');
const phaseCountdown = document.getElementById('phaseCountdown');
const timerDisplay = document.getElementById('timerDisplay');
const instructionText = document.getElementById('instructionText');
const startBtn = document.getElementById('startBtn');
const resetBtn = document.getElementById('resetBtn');
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
const notification = document.getElementById('notification');
const mainContainer = document.querySelector('.main-container');
const breathingGraph = document.getElementById('breathingGraph');
const breathingGraphDot = document.getElementById('breathingGraphDot');
const breathingGraphContainer = document.getElementById('breathingGraphContainer');
const graphCtx = breathingGraph ? breathingGraph.getContext('2d') : null;
const quickRhythmDisplay = document.getElementById('quickRhythmDisplay');

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

// Unified session clock: seconds since start excluding pauses
function getElapsedSeconds(nowTs = performance.now()) {
    if (!state.sessionStartTime) return 0;
    const pausedMs = state.totalPausedMs + (state.pauseStartedAt ? (nowTs - state.pauseStartedAt) : 0);
    const elapsedMs = nowTs - state.sessionStartTime - pausedMs;
    return Math.max(0, elapsedMs / 1000);
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
    const hasModal = (customizeModal?.classList.contains('open')) || (audioModal?.classList.contains('open')) || (settingsPanel?.classList.contains('open'));
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

// Session controls
function startSession() {
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
    state.totalPausedMs = 0;
    state.sessionStartTime = performance.now();
    state.pauseStartedAt = null;
    state.phaseAnchorSec = 0;
    state.cycleAnchorSec = 0;
    state.pausedPhaseElapsed = 0;

    startBtn.textContent = 'Pause';
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
}

function pauseSession() {
    state.isPaused = true;
    startBtn.textContent = 'Resume';
    breathingCircle.classList.remove('animating');
    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
    const now = performance.now();
    state.pauseStartedAt = now;
    state.pausedPhaseElapsed = getElapsedSeconds(now) - state.phaseAnchorSec;
    stopTimer();
    stopAllAudio();
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

    startBtn.textContent = 'Start';
    breathingCircle.classList.remove('animating');
    breathingCircle.style.transform = 'scale(1)';
    phaseText.textContent = 'Ready';
    instructionText.textContent = 'Press Start to begin your breathing journey';
    phaseCountdown.textContent = '';

    if (state.animationFrame) cancelAnimationFrame(state.animationFrame);
    state.animationFrame = null;
    stopTimer();
    stopAllAudio();
    updateTimerDisplay();

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
    setSelectedPreset('custom', { save: false });
    saveSettings();
    syncSessionAfterSettingsChange();
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
});