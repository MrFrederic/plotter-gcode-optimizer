// ─── File handling and SVG conversion ────────────────────────────────────────

import { state } from './state.js';
import {
    fileInput, btnUpload, btnConvertSvg, btnOptimize, btnCompare, btnDownload,
    canvas, ctx,
    statPaths, statPhase,
    graphContainer,
    svgPreviewPane, svgPreviewImg,
    svgProgressContainer, svgProgressBar,
    filterPanel, removedLinesBox,
} from './dom.js';
import { log, setStatus } from './utils.js';
import { loadSettings } from './settings.js';
import { calculateBounds, resizeCanvas, draw } from './visualization.js';
import { resetStats, finalizeUI } from './animation.js';
import { connectWebSocket } from './websocket.js';

// Fake tech log messages shown during SVG conversion (cosmetic UX only)
const SVG_CONVERSION_MESSAGES = [
    'INITIALIZING SVG PARSER...',
    'LOADING BEZIER DECOMPOSITION MODULE...',
    'SCANNING SVG STRUCTURE FOR PATH PRIMITIVES...',
    'PARSING PATH DATA [d="M..."]...',
    'APPLYING VIEWPORT COORDINATE TRANSFORMS...',
    'RESOLVING INHERITED STYLE ATTRIBUTES...',
    'FLATTENING TRANSFORM MATRIX STACK...',
    'TESSELLATING CUBIC BEZIER CURVES...',
    'INTERPOLATING ARC SEGMENTS...',
    'APPLYING CURVE TOLERANCE FILTER...',
    'COMPUTING LINE SEGMENT CHAINS...',
    'GENERATING INTERMEDIATE G-CODE...',
    'POST-PROCESSING: M3->Z_DOWN, M5->Z_UP...',
    'FINALIZING PLOTTER COMMAND SEQUENCE...',
];

// ─── SVG preview ──────────────────────────────────────────────────────────────

function showSvgPreview(file) {
    if (state.svgObjectUrl) URL.revokeObjectURL(state.svgObjectUrl);
    state.svgObjectUrl = URL.createObjectURL(file);
    svgPreviewImg.src = state.svgObjectUrl;
    canvas.classList.add('hidden');
    svgPreviewPane.classList.remove('hidden');
}

function hideSvgPreview() {
    svgPreviewPane.classList.add('hidden');
    canvas.classList.remove('hidden');
    if (state.svgObjectUrl) {
        URL.revokeObjectURL(state.svgObjectUrl);
        state.svgObjectUrl = null;
    }
}

// ─── State reset on new file ──────────────────────────────────────────────────

function resetFileState() {
    state.animationToken++;
    state.greedyAnimToken++;
    state.fakeBurndownToken++;
    state.currentJobId = null;
    state.originalPaths = [];
    state.optimizedPaths = [];
    state.distHistory = [];
    state.currentPhase = 0;
    state.graphAnimating = false;
    state.greedyAnimating = false;
    state.greedyHistory = [];
    state.greedyOriginalDist = 0;
    state.greedyPhase1Dist = 0;
    state.fakeBurndownActive = false;
    state.fakeBurndownData = [];
    state.fakeBurndownStartTime = null;
    state.twoOptCompleted = false;
    state.pendingTwoOptResult = null;
    state.twoOptStartDist = 0;
    state.pendingComplete = null;
    state.pendingSvgFile = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    graphContainer.classList.remove('visible');
    filterPanel.classList.remove('visible');
    filterPanel.classList.remove('scanning');
    state.removedPaths = [];
    state.removedPathsInCorner = false;
    removedLinesBox.classList.remove('visible');
    state.filterAnimStart = null;
    btnDownload.classList.add('hidden');
    btnCompare.classList.add('hidden');
    btnOptimize.classList.add('disabled');
    btnOptimize.disabled = true;
    btnConvertSvg.classList.add('hidden');
    hideSvgPreview();
}

// ─── File input handler ───────────────────────────────────────────────────────

export function initFileHandler() {
    btnUpload.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const isSvg = file.name.toLowerCase().endsWith('.svg');

        resetFileState();
        log(`FILE SELECTED: ${file.name}`, 'highlight');

        if (isSvg) {
            state.pendingSvgFile = file;
            showSvgPreview(file);
            log('SVG DETECTED. PREVIEW RENDERED.', 'accent');
            log('PRESS [CONVERT AND OPTIMIZE] TO BEGIN G-CODE CONVERSION.', 'normal');
            btnConvertSvg.classList.remove('hidden');
            setStatus('AWAITING CONVERSION', false);
        } else {
            setStatus('PARSING FILE', true);
            log('UPLOADING AND PARSING G-CODE...', 'normal');

            const settings = loadSettings();
            const formData = new FormData();
            formData.append('file', file);
            formData.append('settings', JSON.stringify(settings));

            try {
                const response = await fetch('upload', { method: 'POST', body: formData });
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || response.statusText);
                }
                const data = await response.json();
                state.currentJobId = data.job_id;
                state.originalPaths = data.paths;

                log(`JOB ID ASSIGNED: ${state.currentJobId}`, 'accent');
                log(`EXTRACTED ${state.originalPaths.length} PATHS. READY FOR OPTIMIZATION.`, 'highlight');
                resetStats(state.originalPaths.length);
                calculateBounds(state.originalPaths);
                resizeCanvas();
                btnOptimize.classList.remove('disabled');
                btnOptimize.disabled = false;
                fileInput.value = '';
                setStatus('READY', false);
            } catch (err) {
                log(`ERROR: ${err.message}`, 'accent');
                setStatus('ERROR', false);
            }
        }
    });

    // ─── SVG conversion ───────────────────────────────────────────────────────

    btnConvertSvg.addEventListener('click', async () => {
        if (!state.pendingSvgFile) return;

        btnConvertSvg.classList.add('disabled');
        btnConvertSvg.disabled = true;
        btnUpload.classList.add('disabled');
        btnUpload.disabled = true;
        setStatus('CONVERTING SVG', true);

        const settings = loadSettings();
        log(`TOLERANCE: ${settings.curve_tolerance}mm // SPEED: ${settings.feedrate}mm/min`, 'accent');

        let msgIdx = 0;
        let conversionDone = false;
        let progress = 0;

        svgProgressContainer.classList.remove('hidden');
        svgProgressBar.style.width = '0%';

        const progressInterval = setInterval(() => {
            if (!conversionDone) {
                if (msgIdx < SVG_CONVERSION_MESSAGES.length) {
                    log(SVG_CONVERSION_MESSAGES[msgIdx++]);
                }
                progress += (90 - progress) * 0.05;
                svgProgressBar.style.width = `${progress}%`;
            } else {
                clearInterval(progressInterval);
            }
        }, 280);

        const formData = new FormData();
        formData.append('file', state.pendingSvgFile);
        formData.append('settings', JSON.stringify(settings));

        try {
            const response = await fetch('upload-svg', { method: 'POST', body: formData });
            conversionDone = true;
            clearInterval(progressInterval);
            svgProgressBar.style.width = '100%';
            setTimeout(() => {
                svgProgressContainer.classList.add('hidden');
            }, 500);

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || response.statusText);
            }
            const data = await response.json();
            state.currentJobId = data.job_id;
            state.originalPaths = data.paths;

            log(`JOB ID ASSIGNED: ${state.currentJobId}`, 'accent');
            log(`SVG CONVERTED: ${state.originalPaths.length} PATHS EXTRACTED.`, 'highlight');

            hideSvgPreview();
            resetStats(state.originalPaths.length);
            calculateBounds(state.originalPaths);
            resizeCanvas();

            btnConvertSvg.classList.add('hidden');
            btnConvertSvg.classList.remove('disabled');
            btnConvertSvg.disabled = false;
            btnOptimize.classList.remove('disabled');
            btnOptimize.disabled = false;
            btnUpload.classList.remove('disabled');
            btnUpload.disabled = false;
            fileInput.value = '';
            setStatus('READY', false);

            // Automatically start optimization
            btnOptimize.click();
        } catch (err) {
            conversionDone = true;
            clearInterval(progressInterval);
            svgProgressContainer.classList.add('hidden');
            log(`CONVERSION ERROR: ${err.message}`, 'accent');
            btnConvertSvg.classList.remove('disabled');
            btnConvertSvg.disabled = false;
            btnUpload.classList.remove('disabled');
            btnUpload.disabled = false;
            setStatus('ERROR', false);
        }
    });

    // ─── Optimize button ──────────────────────────────────────────────────────

    btnOptimize.addEventListener('click', async () => {
        if (!state.currentJobId) return;

        btnOptimize.classList.add('disabled');
        btnOptimize.disabled = true;
        btnUpload.classList.add('disabled');
        btnUpload.disabled = true;
        filterPanel.classList.remove('visible');
        state.removedPaths = [];
        state.removedPathsInCorner = false;
        removedLinesBox.classList.remove('visible');
        state.filterAnimStart = null;

        log('INITIATING OPTIMIZATION SEQUENCE...', 'accent');
        connectWebSocket(state.currentJobId);
    });

    // ─── Download button ──────────────────────────────────────────────────────

    btnDownload.addEventListener('click', () => {
        if (state.currentJobId) {
            window.location.href = `download/${state.currentJobId}`;
        }
    });

    // ─── Compare button (hold to compare) ────────────────────────────────────

    btnCompare.addEventListener('mousedown', () => {
        state.isComparing = true;
        draw();
    });
    btnCompare.addEventListener('mouseup', () => {
        state.isComparing = false;
        draw();
    });
    btnCompare.addEventListener('mouseleave', () => {
        if (state.isComparing) {
            state.isComparing = false;
            draw();
        }
    });
    btnCompare.addEventListener('touchstart', (e) => {
        e.preventDefault();
        state.isComparing = true;
        draw();
    });
    btnCompare.addEventListener('touchend', (e) => {
        e.preventDefault();
        state.isComparing = false;
        draw();
    });
}
