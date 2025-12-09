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
    gainNode.gain.linearRampToValueAtTime(0.45, peakTime);
    gainNode.gain.setValueAtTime(0.45, tailTime);
    gainNode.gain.linearRampToValueAtTime(0.01, now + duration);

    noiseSource.connect(bandpass);
    bandpass.connect(lowpass);
    lowpass.connect(gainNode);
    gainNode.connect(audioContext.destination);

    noiseSource.start(now);
    noiseSource.stop(now + duration + 0.1);

    breathingSound = { source: noiseSource, gain: gainNode };
}

// Stop any ongoing breathing sound
function stopBreathingSound() {
    if (breathingSound) {
        breathingSound.gain.gain.cancelScheduledValues(audioContext.currentTime);
        breathingSound.gain.gain.setValueAtTime(0, audioContext.currentTime);
        breathingSound.source.stop(audioContext.currentTime);
        breathingSound = null;
    }
}

// Stop all audio outputs used by the app (breathing noise + speech)
function stopAllAudio() {
    stopBreathingSound();
    if (typeof speechSynthesis !== 'undefined' && speechSynthesis.speaking) {
        speechSynthesis.cancel();
    }
}

// Generate chime sound using Web Audio API
function playChime(frequency = 440, duration = 0.4) {
    if (!settings || !settings.chimeEnabled) return;

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