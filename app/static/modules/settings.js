// ─── Settings management ──────────────────────────────────────────────────────

import {
    btnSettingsOpen, btnSettingsClose, btnSettingsSave, btnSettingsReset,
    settingsOverlay,
    btnAboutOpen, btnAboutClose, aboutOverlay,
    quickFeedrate, quickTravelSpeed, quickPenWidth,
} from './dom.js';
import { log } from './utils.js';

export const SETTINGS_KEY = 'cyberplotter_settings';

export const DEFAULT_SETTINGS = {
    z_up: 2.0,
    z_down: 0.0,
    feedrate: 1000,
    travel_speed: 3000,
    z_speed: 500,
    curve_tolerance: 0.1,
    pen_width: 0,
    visibility_threshold: 50,
    offset_closed_paths: false,
    merge_threshold: 0.5,
    gcode_header: 'G28',
    gcode_footer: 'G0 Z5\nG0 X10 Y10\nM84',
};

export function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...DEFAULT_SETTINGS };
}

export function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function applySettingsToForm(s) {
    document.getElementById('set-z-up').value = s.z_up;
    document.getElementById('set-z-down').value = s.z_down;
    document.getElementById('set-feedrate').value = s.feedrate;
    document.getElementById('set-travel-speed').value = s.travel_speed;
    document.getElementById('set-z-speed').value = s.z_speed;
    document.getElementById('set-curve-tolerance').value = s.curve_tolerance;
    document.getElementById('set-pen-width').value = s.pen_width;
    document.getElementById('set-visibility-threshold').value = s.visibility_threshold;
    document.getElementById('set-offset-closed-paths').checked = s.offset_closed_paths;
    document.getElementById('set-merge-threshold').value = s.merge_threshold;
    document.getElementById('set-gcode-header').value = s.gcode_header;
    document.getElementById('set-gcode-footer').value = s.gcode_footer;

    quickFeedrate.value = s.feedrate;
    quickTravelSpeed.value = s.travel_speed;
    quickPenWidth.value = s.pen_width;
}

export function readSettingsFromForm() {
    return {
        z_up: parseFloat(document.getElementById('set-z-up').value),
        z_down: parseFloat(document.getElementById('set-z-down').value),
        feedrate: parseFloat(document.getElementById('set-feedrate').value),
        travel_speed: document.getElementById('set-travel-speed').value
            ? parseFloat(document.getElementById('set-travel-speed').value) : null,
        z_speed: document.getElementById('set-z-speed').value
            ? parseFloat(document.getElementById('set-z-speed').value) : null,
        curve_tolerance: parseFloat(document.getElementById('set-curve-tolerance').value),
        pen_width: parseFloat(document.getElementById('set-pen-width').value),
        visibility_threshold: parseFloat(document.getElementById('set-visibility-threshold').value),
        offset_closed_paths: document.getElementById('set-offset-closed-paths').checked,
        merge_threshold: parseFloat(document.getElementById('set-merge-threshold').value),
        gcode_header: document.getElementById('set-gcode-header').value,
        gcode_footer: document.getElementById('set-gcode-footer').value,
    };
}

function syncQuickSettings() {
    const s = loadSettings();
    s.feedrate = parseFloat(quickFeedrate.value);
    s.travel_speed = parseFloat(quickTravelSpeed.value);
    s.pen_width = parseFloat(quickPenWidth.value);
    saveSettings(s);
    applySettingsToForm(s);
}

// ─── Settings panel event listeners ──────────────────────────────────────────

export function initSettings() {
    applySettingsToForm(loadSettings());

    quickFeedrate.addEventListener('change', syncQuickSettings);
    quickTravelSpeed.addEventListener('change', syncQuickSettings);
    quickPenWidth.addEventListener('change', syncQuickSettings);

    btnSettingsOpen.addEventListener('click', () => {
        applySettingsToForm(loadSettings());
        settingsOverlay.classList.remove('hidden');
    });

    btnSettingsClose.addEventListener('click', () => settingsOverlay.classList.add('hidden'));

    settingsOverlay.addEventListener('click', (e) => {
        if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
    });

    btnSettingsSave.addEventListener('click', () => {
        const s = readSettingsFromForm();
        saveSettings(s);
        applySettingsToForm(s);
        log('SETTINGS SAVED TO LOCAL STORAGE.', 'accent');
        settingsOverlay.classList.add('hidden');
    });

    btnSettingsReset.addEventListener('click', () => {
        applySettingsToForm(DEFAULT_SETTINGS);
    });

    // ─── About panel ──────────────────────────────────────────────────────────

    btnAboutOpen.addEventListener('click', () => {
        aboutOverlay.classList.remove('hidden');
    });

    btnAboutClose.addEventListener('click', () => aboutOverlay.classList.add('hidden'));

    aboutOverlay.addEventListener('click', (e) => {
        if (e.target === aboutOverlay) aboutOverlay.classList.add('hidden');
    });
}
