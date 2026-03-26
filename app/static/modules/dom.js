// ─── DOM element references ───────────────────────────────────────────────────
// Collected once at module evaluation time (scripts are deferred with type="module").

export const fileInput          = document.getElementById('file-input');
export const btnUpload          = document.getElementById('btn-upload');
export const btnConvertSvg      = document.getElementById('btn-convert-svg');
export const btnOptimize        = document.getElementById('btn-optimize');
export const btnCompare         = document.getElementById('btn-compare');
export const btnDownload        = document.getElementById('btn-download');
export const terminal           = document.getElementById('terminal');
export const statusText         = document.getElementById('status-text');
export const statusDot          = document.getElementById('status-dot');

export const canvas             = document.getElementById('viz-canvas');
export const ctx                = canvas.getContext('2d');

export const statPaths          = document.getElementById('stat-paths');
export const statOpt            = document.getElementById('stat-opt');
export const statPhase          = document.getElementById('stat-phase');
export const statOrigTime       = document.getElementById('stat-orig-time');
export const statTime           = document.getElementById('stat-time');
export const statTimeSaved      = document.getElementById('stat-time-saved');
export const statIter           = document.getElementById('stat-iter');

export const graphContainer     = document.getElementById('graph-container');
export const graphCanvas        = document.getElementById('graph-canvas');
export const graphCtx           = graphCanvas.getContext('2d');

export const svgPreviewPane     = document.getElementById('svg-preview-pane');
export const svgPreviewImg      = document.getElementById('svg-preview-img');
export const svgProgressContainer = document.getElementById('svg-progress-container');
export const svgProgressBar     = document.getElementById('svg-progress-bar');

export const filterPanel        = document.getElementById('filter-panel');
export const filterBarKept      = document.getElementById('filter-bar-kept');
export const filterBarRemoved   = document.getElementById('filter-bar-removed');
export const filterRemovedEl    = document.getElementById('filter-removed');
export const filterKeptEl       = document.getElementById('filter-kept');
export const filterTimeSavedEl  = document.getElementById('filter-time-saved');
export const filterPenEl        = document.getElementById('filter-pen');
export const filterVisEl        = document.getElementById('filter-vis');
export const removedLinesBox    = document.getElementById('removed-lines-box');
export const removedLinesCanvas = document.getElementById('removed-lines-canvas');
export const removedLinesCtx    = document.getElementById('removed-lines-canvas')
                                      ? document.getElementById('removed-lines-canvas').getContext('2d')
                                      : null;

export const btnSettingsOpen    = document.getElementById('btn-settings');
export const btnSettingsClose   = document.getElementById('btn-settings-close');
export const btnSettingsSave    = document.getElementById('btn-settings-save');
export const btnSettingsReset   = document.getElementById('btn-settings-reset');
export const settingsOverlay    = document.getElementById('settings-overlay');

export const btnAboutOpen       = document.getElementById('btn-about');
export const btnAboutClose      = document.getElementById('btn-about-close');
export const aboutOverlay       = document.getElementById('about-overlay');

export const quickFeedrate      = document.getElementById('quick-feedrate');
export const quickTravelSpeed   = document.getElementById('quick-travel-speed');
export const quickPenWidth      = document.getElementById('quick-pen-width');
