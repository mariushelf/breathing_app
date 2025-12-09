// Presets loaded from YAML
let loadedPresets = [];
let selectedPresetId = null;

function loadPresetsFromStorage() {
    if (Array.isArray(settings.savedPresets)) {
        loadedPresets = settings.savedPresets;
    }
}

async function loadPresetsFromYaml() {
    try {
        const response = await fetch('presets.yaml', { cache: 'no-store' });
        if (!response.ok) {
            throw new Error(`Failed to fetch presets.yaml: ${response.status}`);
        }
        const text = await response.text();
        const parsed = jsyaml.load(text);
        loadedPresets = (parsed && Array.isArray(parsed.presets)) ? parsed.presets : [];
        renderPresetButtons();

        // If a preset was previously selected (including composable ones like WHM),
        // re-apply it so the graph and session flow match the saved choice.
        if (selectedPresetId) {
            const previouslySelected = loadedPresets.find((p) => p.id === selectedPresetId);
            if (previouslySelected) {
                setSelectedPreset(previouslySelected.id, { save: false });
                applyPresetFromConfig(previouslySelected);
                syncSessionAfterSettingsChange();
            }
        }
    } catch (e) {
        console.error('Failed to load presets.yaml', e);
    }
}

function setSelectedPreset(presetId, { save = true } = {}) {
    selectedPresetId = presetId;
    settings.selectedPresetId = presetId;
    updatePresetSelectionHighlight();
    if (save) {
        saveSettings();
    }
}

function updatePresetSelectionHighlight() {
    if (presetButtonsContainer) {
        presetButtonsContainer.querySelectorAll('.preset-btn').forEach((btn) => {
            const id = btn.getAttribute('data-preset-id');
            if (id === selectedPresetId) {
                btn.classList.add('selected');
            } else {
                btn.classList.remove('selected');
            }
        });
    }

    // Update quick chips
    const quickChips = document.querySelectorAll('[data-quick-preset]');
    quickChips.forEach((chip) => {
        const id = chip.getAttribute('data-quick-preset');
        if (id === selectedPresetId) {
            chip.classList.add('selected');
        } else {
            chip.classList.remove('selected');
        }
    });
}

function applyPresetFromConfig(preset) {
    if (!preset) return;

    // If this is a composable preset, hand off to the composable handler and exit early
    if (Array.isArray(preset.steps)) {
        console.log('[DEBUG] Composable preset detected:', preset.id);
        if (typeof onComposablePresetSelected === 'function') {
            console.log('[DEBUG] Calling onComposablePresetSelected');
            onComposablePresetSelected(preset);
            console.log('[DEBUG] After onComposablePresetSelected, composableState.activePreset:', 
                typeof composableState !== 'undefined' ? !!composableState.activePreset : 'composableState undefined');
            if (typeof updateCustomizeModalForPreset === 'function') {
                updateCustomizeModalForPreset();
            }
        } else {
            console.log('[DEBUG] onComposablePresetSelected is NOT a function!');
        }
        return;
    }

    // Clear any active composable preset when selecting a simple preset
    if (typeof resetComposableState === 'function') {
        resetComposableState();
    }

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

    updateRatioDisplay();
    updateUIFromSettings();
    updateCurrentPresetDisplay();
    if (typeof updateCustomizeModalForPreset === 'function') {
        updateCustomizeModalForPreset();
    }
    saveSettings();
}

function syncSessionAfterSettingsChange() {
    if (state.isRunning && !state.isPaused) {
        state.currentPhase = 'inhale';
        const anchor = getElapsedSeconds();
        state.phaseAnchorSec = anchor;
        state.cycleAnchorSec = anchor;
        transitionToPhase('inhale', state.phaseAnchorSec);
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

    const createPresetButton = (preset, onClick) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-secondary preset-btn';
        btn.setAttribute('data-preset-id', preset.id || '');

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
            if (onClick) {
                onClick();
                return;
            }
            // Persist the selection so composable presets like WHM remain selected after reload
            setSelectedPreset(preset.id || '', { save: true });
            applyPresetFromConfig(preset);
            syncSessionAfterSettingsChange();
        });

        btn.addEventListener('blur', () => {
            btn.classList.remove('show-tooltip');
        });

        btn.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                btn.click();
            }
        });

        return btn;
    };

    byCategory.forEach((presets, category) => {
        const section = document.createElement('div');
        section.className = 'preset-section';

        const header = document.createElement('div');
        header.className = 'preset-section-header';
        header.textContent = category;
        section.appendChild(header);

        const group = document.createElement('div');
        group.className = 'preset-group';
        presets.forEach((preset) => {
            group.appendChild(createPresetButton(preset));
        });
        section.appendChild(group);

        presetButtonsContainer.appendChild(section);
    });

    // Custom preset button
    const customBtn = document.createElement('button');
    customBtn.type = 'button';
    customBtn.className = 'btn btn-secondary preset-btn';
    customBtn.textContent = 'Custom';
    customBtn.addEventListener('click', () => {
        setSelectedPreset('custom');
        openModal(customizeModal);
    });
    presetButtonsContainer.appendChild(customBtn);

    updatePresetSelectionHighlight();
}