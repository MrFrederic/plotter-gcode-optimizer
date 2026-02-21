// ─── Settings ────────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'cyberplotter_settings';

const DEFAULT_SETTINGS = {
    z_up: 2.0,
    z_down: 0.0,
    feedrate: 1000,
    travel_speed: 3000,
    z_speed: 500,
    curve_tolerance: 0.1,
    pen_width: 0,
    visibility_threshold: 50,
    merge_threshold: 0.5,
    gcode_header: 'G28',
    gcode_footer: 'G0 Z5\nG0 X10 Y10\nM84',
};

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (_) {}
    return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

function applySettingsToForm(s) {
    document.getElementById('set-z-up').value = s.z_up;
    document.getElementById('set-z-down').value = s.z_down;
    document.getElementById('set-feedrate').value = s.feedrate;
    document.getElementById('set-travel-speed').value = s.travel_speed;
    document.getElementById('set-z-speed').value = s.z_speed;
    document.getElementById('set-curve-tolerance').value = s.curve_tolerance;
    document.getElementById('set-pen-width').value = s.pen_width;
    document.getElementById('set-visibility-threshold').value = s.visibility_threshold;
    document.getElementById('set-merge-threshold').value = s.merge_threshold;
    document.getElementById('set-gcode-header').value = s.gcode_header;
    document.getElementById('set-gcode-footer').value = s.gcode_footer;
    
    document.getElementById('quick-feedrate').value = s.feedrate;
    document.getElementById('quick-travel-speed').value = s.travel_speed;
    document.getElementById('quick-pen-width').value = s.pen_width;
}

function readSettingsFromForm() {
    return {
        z_up: parseFloat(document.getElementById('set-z-up').value),
        z_down: parseFloat(document.getElementById('set-z-down').value),
        feedrate: parseFloat(document.getElementById('set-feedrate').value),
        travel_speed: parseFloat(document.getElementById('set-travel-speed').value),
        z_speed: parseFloat(document.getElementById('set-z-speed').value),
        curve_tolerance: parseFloat(document.getElementById('set-curve-tolerance').value),
        pen_width: parseFloat(document.getElementById('set-pen-width').value),
        visibility_threshold: parseFloat(document.getElementById('set-visibility-threshold').value),
        merge_threshold: parseFloat(document.getElementById('set-merge-threshold').value),
        gcode_header: document.getElementById('set-gcode-header').value,
        gcode_footer: document.getElementById('set-gcode-footer').value,
    };
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const fileInput = document.getElementById('file-input');
const btnUpload = document.getElementById('btn-upload');
const btnConvertSvg = document.getElementById('btn-convert-svg');
const btnOptimize = document.getElementById('btn-optimize');
const btnCompare = document.getElementById('btn-compare');
const btnDownload = document.getElementById('btn-download');
const terminal = document.getElementById('terminal');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const canvas = document.getElementById('viz-canvas');
const ctx = canvas.getContext('2d');
const statPaths = document.getElementById('stat-paths');
const statOpt = document.getElementById('stat-opt');
const statPhase = document.getElementById('stat-phase');
const statOrigTime = document.getElementById('stat-orig-time');
const statTime = document.getElementById('stat-time');
const statTimeSaved = document.getElementById('stat-time-saved');
const statIter = document.getElementById('stat-iter');
const graphContainer = document.getElementById('graph-container');
const graphCanvas = document.getElementById('graph-canvas');
const graphCtx = graphCanvas.getContext('2d');
const svgPreviewPane = document.getElementById('svg-preview-pane');
const svgPreviewImg = document.getElementById('svg-preview-img');
const svgProgressContainer = document.getElementById('svg-progress-container');
const svgProgressBar = document.getElementById('svg-progress-bar');

const filterPanel = document.getElementById('filter-panel');
const filterBarKept = document.getElementById('filter-bar-kept');
const filterBarRemoved = document.getElementById('filter-bar-removed');
const filterRemovedEl = document.getElementById('filter-removed');
const filterKeptEl = document.getElementById('filter-kept');
const filterTimeSavedEl = document.getElementById('filter-time-saved');
const filterPenEl = document.getElementById('filter-pen');
const filterVisEl = document.getElementById('filter-vis');
const removedLinesBox = document.getElementById('removed-lines-box');
const removedLinesCanvas = document.getElementById('removed-lines-canvas');
const removedLinesCtx = removedLinesCanvas ? removedLinesCanvas.getContext('2d') : null;

const btnSettingsOpen = document.getElementById('btn-settings');
const btnSettingsClose = document.getElementById('btn-settings-close');
const btnSettingsSave = document.getElementById('btn-settings-save');
const btnSettingsReset = document.getElementById('btn-settings-reset');
const settingsOverlay = document.getElementById('settings-overlay');

const quickFeedrate = document.getElementById('quick-feedrate');
const quickTravelSpeed = document.getElementById('quick-travel-speed');
const quickPenWidth = document.getElementById('quick-pen-width');

function syncQuickSettings() {
    const s = loadSettings();
    s.feedrate = parseFloat(quickFeedrate.value);
    s.travel_speed = parseFloat(quickTravelSpeed.value);
    s.pen_width = parseFloat(quickPenWidth.value);
    saveSettings(s);
    applySettingsToForm(s);
}

quickFeedrate.addEventListener('change', syncQuickSettings);
quickTravelSpeed.addEventListener('change', syncQuickSettings);
quickPenWidth.addEventListener('change', syncQuickSettings);

let currentJobId = null;
let originalPaths = [];
let optimizedPaths = [];
let bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
let distHistory = [];
let currentPhase = 0;
let graphAnimating = false;
let animationToken = 0;
let pendingComplete = null;
let pendingSvgFile = null;  // SVG file waiting for conversion
let svgObjectUrl = null;    // Revocable object URL for SVG preview
let removedPaths = [];      // Paths removed by line filter (for animation)
let removedPathsInCorner = false;  // Whether removed paths should be shown scaled in corner
let filterAnimStart = null; // Timestamp when filter animation started
const FILTER_ANIM_MS = 2000; // Duration of filter fade-out animation

// ─── Greedy animation state ───────────────────────────────────────────────────
let greedyAnimating = false;
let greedyAnimToken = 0;
let greedyHistory = [];     // Progress history from greedy sort
let greedyOriginalDist = 0;
let greedyPhase1Dist = 0;

// ─── Local scan animation state ───────────────────────────────────────────────
let localScanActive = false;
let localScanToken = 0;
let localScanIndices = [];  // Currently highlighted path indices

// ─── Fake burn-down chart state ───────────────────────────────────────────────
let fakeBurndownActive = false;
let fakeBurndownData = [];
let fakeBurndownStartTime = null;
let fakeBurndownToken = 0;
let twoOptCompleted = false;
let pendingTwoOptResult = null;  // Store result if 2-OPT finishes during animation
let twoOptStartDist = 0;         // Starting distance for 2-OPT (from greedy)

// ─── Settings panel ───────────────────────────────────────────────────────────

applySettingsToForm(loadSettings());

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

// ─── Utilities ────────────────────────────────────────────────────────────────

function setStatus(text, active = false) {
    statusText.textContent = `STATUS: ${text}`;
    if (active) statusDot.classList.add('active');
    else statusDot.classList.remove('active');
}

function log(msg, type = 'normal') {
    const div = document.createElement('div');
    div.textContent = msg;
    if (type === 'highlight') div.className = 'log-highlight';
    if (type === 'accent') div.className = 'log-accent';
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    // Set canvas internal resolution to account for high-DPI displays
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    
    // Scale context to match device pixels
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    
    // Store display dimensions for transform calculations
    canvas.displayWidth = rect.width;
    canvas.displayHeight = rect.height;
    
    if (graphContainer.classList.contains('visible')) {
        resizeGraphCanvas();
    }
    
    draw();
    drawGraph();
}

function resizeGraphCanvas() {
    const graphRect = graphContainer.getBoundingClientRect();
    graphCanvas.width = graphRect.width;
    graphCanvas.height = graphRect.height;
}

window.addEventListener('resize', resizeCanvas);

btnUpload.addEventListener('click', () => fileInput.click());

function resetStats(totalPaths) {
    statPaths.textContent = `0 / ${totalPaths}`;
    statOpt.textContent = '0%';
    statPhase.textContent = 'IDLE';
    statOrigTime.textContent = '---';
    statTime.textContent = '---';
    statTimeSaved.textContent = '---';
    statIter.textContent = '---';
}

function calculateDrawDistance(paths) {
    let dist = 0;
    for (const path of paths) {
        for (let i = 0; i < path.length - 1; i++) {
            const dx = path[i+1].x - path[i].x;
            const dy = path[i+1].y - path[i].y;
            dist += Math.sqrt(dx*dx + dy*dy);
        }
    }
    return dist;
}

function formatTime(minutes) {
    if (minutes < 1) {
        return Math.round(minutes * 60) + 's';
    }
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

// ─── File selection ───────────────────────────────────────────────────────────

// Fake tech log messages shown during SVG conversion
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

function showSvgPreview(file) {
    if (svgObjectUrl) URL.revokeObjectURL(svgObjectUrl);
    svgObjectUrl = URL.createObjectURL(file);
    svgPreviewImg.src = svgObjectUrl;
    canvas.classList.add('hidden');
    svgPreviewPane.classList.remove('hidden');
}

function hideSvgPreview() {
    svgPreviewPane.classList.add('hidden');
    canvas.classList.remove('hidden');
    if (svgObjectUrl) {
        URL.revokeObjectURL(svgObjectUrl);
        svgObjectUrl = null;
    }
}

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const isSvg = file.name.toLowerCase().endsWith('.svg');

    // Reset state
    animationToken++;
    greedyAnimToken++;
    fakeBurndownToken++;
    currentJobId = null;
    originalPaths = [];
    optimizedPaths = [];
    distHistory = [];
    currentPhase = 0;
    graphAnimating = false;
    greedyAnimating = false;
    greedyHistory = [];
    greedyOriginalDist = 0;
    greedyPhase1Dist = 0;
    fakeBurndownActive = false;
    fakeBurndownData = [];
    fakeBurndownStartTime = null;
    twoOptCompleted = false;
    pendingTwoOptResult = null;
    twoOptStartDist = 0;
    pendingComplete = null;
    pendingSvgFile = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    graphContainer.classList.remove('visible');
    filterPanel.classList.remove('visible');
    filterPanel.classList.remove('scanning');
    removedPaths = [];
    removedPathsInCorner = false;
    removedLinesBox.classList.remove('visible');
    filterAnimStart = null;
    btnDownload.classList.add('hidden');
    btnCompare.classList.add('hidden');
    btnOptimize.classList.add('disabled');
    btnOptimize.disabled = true;
    btnConvertSvg.classList.add('hidden');
    hideSvgPreview();

    log(`FILE SELECTED: ${file.name}`, 'highlight');

    if (isSvg) {
        // Show SVG preview — conversion is triggered manually
        pendingSvgFile = file;
        showSvgPreview(file);
        log('SVG DETECTED. PREVIEW RENDERED.', 'accent');
        log('PRESS [CONVERT AND OPTIMIZE] TO BEGIN G-CODE CONVERSION.', 'normal');
        btnConvertSvg.classList.remove('hidden');
        setStatus('AWAITING CONVERSION', false);
    } else {
        // GCode file: parse immediately
        setStatus('PARSING FILE', true);
        log('UPLOADING AND PARSING G-CODE...', 'normal');

        const settings = loadSettings();
        const formData = new FormData();
        formData.append('file', file);
        formData.append('settings', JSON.stringify(settings));

        try {
            const response = await fetch('/upload', { method: 'POST', body: formData });
            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.detail || response.statusText);
            }
            const data = await response.json();
            currentJobId = data.job_id;
            originalPaths = data.paths;

            log(`JOB ID ASSIGNED: ${currentJobId}`, 'accent');
            log(`EXTRACTED ${originalPaths.length} PATHS. READY FOR OPTIMIZATION.`, 'highlight');
            resetStats(originalPaths.length);
            calculateBounds(originalPaths);
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

// ─── SVG Conversion ───────────────────────────────────────────────────────────

btnConvertSvg.addEventListener('click', async () => {
    if (!pendingSvgFile) return;

    btnConvertSvg.classList.add('disabled');
    btnConvertSvg.disabled = true;
    btnUpload.classList.add('disabled');
    btnUpload.disabled = true;
    setStatus('CONVERTING SVG', true);

    const settings = loadSettings();
    log(`TOLERANCE: ${settings.curve_tolerance}mm // SPEED: ${settings.feedrate}mm/min`, 'accent');

    // Simulated tech-log progress — purely cosmetic UX, not tied to real progress
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
            // Asymptotic progress towards 90%
            progress += (90 - progress) * 0.05;
            svgProgressBar.style.width = `${progress}%`;
        } else {
            clearInterval(progressInterval);
        }
    }, 280);

    const formData = new FormData();
    formData.append('file', pendingSvgFile);
    formData.append('settings', JSON.stringify(settings));

    try {
        const response = await fetch('/upload-svg', { method: 'POST', body: formData });
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
        currentJobId = data.job_id;
        originalPaths = data.paths;

        log(`JOB ID ASSIGNED: ${currentJobId}`, 'accent');
        log(`SVG CONVERTED: ${originalPaths.length} PATHS EXTRACTED.`, 'highlight');

        hideSvgPreview();
        resetStats(originalPaths.length);
        calculateBounds(originalPaths);
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

btnOptimize.addEventListener('click', async () => {
    if (!currentJobId) return;

    btnOptimize.classList.add('disabled');
    btnOptimize.disabled = true;
    btnUpload.classList.add('disabled');
    btnUpload.disabled = true;
    filterPanel.classList.remove('visible');
    removedPaths = [];
    removedPathsInCorner = false;
    removedLinesBox.classList.remove('visible');
    filterAnimStart = null;

    log('INITIATING OPTIMIZATION SEQUENCE...', 'accent');
    connectWebSocket(currentJobId);
});

btnDownload.addEventListener('click', () => {
    if (currentJobId) {
        window.location.href = `/download/${currentJobId}`;
    }
});

let isComparing = false;
let filterScanning = false;
let scanningPaths = [];

btnCompare.addEventListener('mousedown', () => {
    isComparing = true;
    draw();
});

btnCompare.addEventListener('mouseup', () => {
    isComparing = false;
    draw();
});

btnCompare.addEventListener('mouseleave', () => {
    if (isComparing) {
        isComparing = false;
        draw();
    }
});

btnCompare.addEventListener('touchstart', (e) => {
    e.preventDefault();
    isComparing = true;
    draw();
});

btnCompare.addEventListener('touchend', (e) => {
    e.preventDefault();
    isComparing = false;
    draw();
});

function finalizeUI() {
    log('OPTIMIZATION SEQUENCE COMPLETE.', 'accent');
    statPhase.textContent = 'COMPLETE';
    setStatus('COMPLETE', false);
    btnDownload.classList.remove('hidden');
    btnCompare.classList.remove('hidden');
    btnUpload.classList.remove('disabled');
    btnUpload.disabled = false;
    btnConvertSvg.classList.remove('disabled');
    btnConvertSvg.disabled = false;
    fileInput.value = '';
}

function connectWebSocket(jobId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/ws/${jobId}`);

    ws.onopen = () => {
        setStatus('OPTIMIZING', true);
    };

    ws.onmessage = (event) => {
        const data = JSON.parse(event.data);
        
        // Ignore keepalive pings
        if (data.type === 'ping') return;
        
        if (data.type === 'log') {
            log(data.msg);
            
        } else if (data.type === 'progress') {
            currentPhase = data.phase;
            
            if (data.phase === 1) {
                statPhase.textContent = 'PHASE 1: GREEDY NN';
                if (data.latest_path) {
                    optimizedPaths.push(data.latest_path);
                }
                const percent = Math.round((data.current / data.total) * 100);
                statPaths.textContent = `${data.current} / ${data.total}`;
                statOpt.textContent = `${percent}%`;
                draw();
            }
            
        } else if (data.type === 'filter_start') {
            // Start local scanning animation - backend is processing
            statPhase.textContent = 'LINE FILTER';
            log(`Scanning ${data.path_count} paths (pen: ${data.pen_width}mm, visibility ≥${data.visibility_threshold}%)...`);
            startLocalScanAnimation();
            
        } else if (data.type === 'filter_result') {
            // Stop local scanning animation
            stopLocalScanAnimation();
            currentPhase = 0;

            // Identify which paths were removed using indices
            const removedSet = new Set(data.removed_indices || []);
            removedPaths = originalPaths.filter((_, i) => removedSet.has(i));
            originalPaths = originalPaths.filter((_, i) => !removedSet.has(i));

            // Update path count for upcoming optimization
            statPaths.textContent = `0 / ${data.kept_count}`;

            // Show filter panel with results
            showFilterPanel(data);

            // Start fade-out animation for removed paths (non-blocking)
            if (removedPaths.length > 0) {
                filterAnimStart = performance.now();
                requestAnimationFrame(runFilterAnim);
            } else {
                draw();
            }
            // Backend continues automatically - no need to send "continue"

        } else if (data.type === 'greedy_result') {
            // Greedy sort complete - start greedy animation
            currentPhase = 1;
            statPhase.textContent = 'PHASE 1: GREEDY NN';
            
            greedyHistory = data.progress_history || [];
            greedyOriginalDist = data.original_dist;
            greedyPhase1Dist = data.phase1_dist;
            twoOptStartDist = data.phase1_dist;  // Save for fake burndown
            
            // Update stats
            statPaths.textContent = `${data.path_count} / ${data.path_count}`;
            statOpt.textContent = '100%';
            
            // Set the optimized paths from greedy result
            if (data.paths && data.paths.length > 0) {
                optimizedPaths = data.paths;
            }
            draw();
            
            // Start greedy animation to visualize the sorting process
            startGreedyAnimation(data.progress_history, data.path_count);

        } else if (data.type === 'twoopt_start') {
            // 2-OPT starting - prepare for potential fake burndown
            twoOptCompleted = false;
            pendingTwoOptResult = null;
            fakeBurndownActive = false;  // Will be activated if greedy animation finishes first
            statPhase.textContent = 'PHASE 2: 2-OPT';
            
        } else if (data.type === 'phase2_result') {
            twoOptCompleted = true;
            currentPhase = 2;
            statOpt.textContent = '100%';
            
            const settings = loadSettings();
            const drawDist = calculateDrawDistance(originalPaths);
            const drawTime = drawDist / settings.feedrate;
            const origTravelTime = data.gcode_dist / settings.travel_speed;
            const origTotalTime = drawTime + origTravelTime;
            
            statOrigTime.textContent = formatTime(origTotalTime);
            
            if (data.paths && data.paths.length > 0) {
                optimizedPaths = data.paths;
            }
            draw();
            
            // Check if we're still animating greedy or fake burndown
            if (greedyAnimating) {
                // Store result, will be shown after greedy animation
                pendingTwoOptResult = {
                    dist_history: data.dist_history,
                    iterations: data.iterations,
                    final_dist: data.final_dist,
                    gcode_dist: data.gcode_dist,
                    drawTime: drawTime,
                    travelSpeed: settings.travel_speed,
                    paths: data.paths  // Store final paths too
                };
            } else if (fakeBurndownActive) {
                // Merge fake burndown with real data and finish
                finishBurndownWithRealData(data.dist_history, data.iterations, data.final_dist, data.gcode_dist, drawTime, settings.travel_speed);
            } else {
                // No animation running, show graph immediately
                graphContainer.classList.add('visible');
                requestAnimationFrame(() => {
                    resizeGraphCanvas();
                    startGraphAnimation(data.dist_history, data.iterations, data.final_dist, data.gcode_dist, drawTime, settings.travel_speed, false);
                });
            }
            
        } else if (data.type === 'complete') {
            ws.close();
            // Check if any animation is still running
            if (graphAnimating || greedyAnimating || fakeBurndownActive) {
                pendingComplete = true;
            } else {
                finalizeUI();
            }
        }
    };

    ws.onerror = (err) => {
        log('WEBSOCKET ERROR DETECTED.', 'accent');
        setStatus('ERROR', false);
    };
}

function startGraphAnimation(fullHistory, iterations, finalDist, originalDist, drawTime, travelSpeed, fast = false, startIdx = 0) {
    const myToken = ++animationToken;
    graphAnimating = true;
    
    // If starting from middle (seamless transition), keep existing distHistory up to startIdx
    if (startIdx > 0 && distHistory.length >= startIdx) {
        distHistory = distHistory.slice(0, startIdx);
    } else {
        distHistory = [];
    }
    
    let idx = startIdx;
    // In fast mode, use much shorter delays
    let baseDelay = Math.max(30, Math.min(120, 3000 / Math.max(1, fullHistory.length)));
    const delay = fast ? Math.max(5, baseDelay / 8) : baseDelay;
    
    const origTotalTime = drawTime + (originalDist / travelSpeed);
    
    function step() {
        if (myToken !== animationToken) return;
        
        if (idx < fullHistory.length) {
            distHistory.push(fullHistory[idx]);
            
            const currentTravelTime = fullHistory[idx] / travelSpeed;
            const currentTotalTime = drawTime + currentTravelTime;
            statTime.textContent = formatTime(currentTotalTime);
            
            if (idx === 0) {
                statIter.textContent = 'BASELINE';
            } else {
                statIter.textContent = `${idx} / ${iterations}`;
            }
            
            const savedTime = origTotalTime - currentTotalTime;
            const savedPct = origTotalTime > 0 ? (savedTime / origTotalTime * 100) : 0;
            statTimeSaved.textContent = `${formatTime(savedTime)} (${savedPct.toFixed(1)}%)`;
            
            drawGraph(drawTime, travelSpeed);
            idx++;
            setTimeout(step, delay);
        } else {
            graphAnimating = false;
            const finalTravelTime = finalDist / travelSpeed;
            const finalTotalTime = drawTime + finalTravelTime;
            statTime.textContent = formatTime(finalTotalTime);
            statIter.textContent = `${iterations}`;
            
            if (pendingComplete) {
                pendingComplete = null;
                finalizeUI();
            }
        }
    }
    
    step();
}

// ─── Greedy Sort Animation ────────────────────────────────────────────────────

function startGreedyAnimation(progressHistory, totalPaths) {
    const myToken = ++greedyAnimToken;
    greedyAnimating = true;
    
    if (!progressHistory || progressHistory.length === 0) {
        greedyAnimating = false;
        onGreedyAnimationComplete();
        return;
    }
    
    let idx = 0;
    // Slower animation - aim for ~3-4 seconds total, but at least 1 path per frame
    const totalFrames = Math.max(60, Math.min(180, progressHistory.length));  // 1-3 seconds at 60fps
    const pathsPerFrame = Math.max(1, Math.ceil(progressHistory.length / totalFrames));
    
    // Clear optimized paths - we'll rebuild them during animation
    optimizedPaths = [];
    
    function step() {
        if (myToken !== greedyAnimToken) return;
        
        // Check if 2-OPT finished - skip to end if so
        if (pendingTwoOptResult) {
            // Skip remaining animation, show all paths immediately
            for (let i = idx; i < progressHistory.length; i++) {
                const entry = progressHistory[i];
                const origIdx = entry.original_index;
                if (origIdx >= 0 && origIdx < originalPaths.length) {
                    let pathToAdd = originalPaths[origIdx];
                    if (entry.reversed) {
                        pathToAdd = [...pathToAdd].reverse();
                    }
                    optimizedPaths.push(pathToAdd);
                }
            }
            statPaths.textContent = `${totalPaths} / ${totalPaths}`;
            statOpt.textContent = '100%';
            draw();
            greedyAnimating = false;
            onGreedyAnimationComplete();
            return;
        }
        
        if (idx < progressHistory.length) {
            // Process multiple paths per frame for performance
            const endIdx = Math.min(idx + pathsPerFrame, progressHistory.length);
            for (let i = idx; i < endIdx; i++) {
                const entry = progressHistory[i];
                const origIdx = entry.original_index;
                if (origIdx >= 0 && origIdx < originalPaths.length) {
                    let pathToAdd = originalPaths[origIdx];
                    if (entry.reversed) {
                        pathToAdd = [...pathToAdd].reverse();
                    }
                    optimizedPaths.push(pathToAdd);
                }
            }
            idx = endIdx;
            
            // Update stats
            const percent = Math.round((idx / progressHistory.length) * 100);
            statPaths.textContent = `${idx} / ${totalPaths}`;
            statOpt.textContent = `${percent}%`;
            
            draw();
            requestAnimationFrame(step);  // Use requestAnimationFrame for smooth 60fps
        } else {
            greedyAnimating = false;
            onGreedyAnimationComplete();
        }
    }
    
    step();
}

function onGreedyAnimationComplete() {
    // Check if 2-OPT result is already available
    if (pendingTwoOptResult) {
        const result = pendingTwoOptResult;
        pendingTwoOptResult = null;
        
        // Set final optimized paths from 2-OPT result
        if (result.paths && result.paths.length > 0) {
            optimizedPaths = result.paths;
            draw();
        }
        
        graphContainer.classList.add('visible');
        requestAnimationFrame(() => {
            resizeGraphCanvas();
            // Fast animation since user already waited
            startGraphAnimation(result.dist_history, result.iterations, result.final_dist, result.gcode_dist, result.drawTime, result.travelSpeed, true);
        });
    } else if (!twoOptCompleted) {
        // 2-OPT still running, start fake burndown
        startFakeBurndown();
    } else if (pendingComplete) {
        // Edge case: 2-OPT completed but no result stored (shouldn't happen)
        pendingComplete = null;
        finalizeUI();
    }
}

// ─── Fake Burn-down Chart ─────────────────────────────────────────────────────

function startFakeBurndown() {
    fakeBurndownActive = true;
    fakeBurndownStartTime = performance.now();
    fakeBurndownData = [twoOptStartDist];  // Start from greedy result distance
    fakeBurndownToken++;
    
    const settings = loadSettings();
    const drawDist = calculateDrawDistance(originalPaths);
    const drawTime = drawDist / settings.feedrate;
    
    // Show the graph container
    graphContainer.classList.add('visible');
    resizeGraphCanvas();
    
    // Initial stats
    statPhase.textContent = 'PHASE 2: 2-OPT';
    statIter.textContent = 'OPTIMIZING...';
    
    // Original time uses gcode ordering (before greedy sort)
    const origTotalTime = drawTime + (greedyOriginalDist / settings.travel_speed);
    statOrigTime.textContent = formatTime(origTotalTime);
    
    distHistory = [...fakeBurndownData];
    drawGraph(drawTime, settings.travel_speed);
    
    // Start periodic animation
    runFakeBurndownStep();
}

// Cache these values for fake burndown so we don't recalculate each frame
let fakeBurndownDrawTime = 0;
let fakeBurndownTravelSpeed = 1;
let fakeBurndownOrigTotalTime = 0;

function runFakeBurndownStep() {
    if (!fakeBurndownActive) return;
    
    const token = fakeBurndownToken;
    const settings = loadSettings();
    const drawDist = calculateDrawDistance(originalPaths);
    fakeBurndownDrawTime = drawDist / settings.feedrate;
    fakeBurndownTravelSpeed = settings.travel_speed;
    // Original time uses gcode ordering (before greedy sort)
    fakeBurndownOrigTotalTime = fakeBurndownDrawTime + (greedyOriginalDist / settings.travel_speed);
    
    // Display original time (based on gcode ordering)
    statOrigTime.textContent = formatTime(fakeBurndownOrigTotalTime);
    
    let frameCounter = 0;
    
    function step() {
        if (!fakeBurndownActive || token !== fakeBurndownToken) return;
        
        frameCounter++;
        
        // Add 1 fake iteration every 3 frames (~5 iterations/second)
        if (frameCounter % 3 === 0 && fakeBurndownData.length > 0) {
            const lastDist = fakeBurndownData[fakeBurndownData.length - 1];
            const progress = fakeBurndownData.length;
            
            // 40% chance of plateau (no improvement)
            // 8% chance of a sudden drop (bigger improvement)
            // 52% chance of normal small improvement
            const roll = Math.random();
            let newDist = lastDist;
            
            if (roll < 0.4) {
                // Plateau - no change
                newDist = lastDist;
            } else if (roll < 0.48) {
                // Sudden drop - bigger improvement (reduced by 15x: was 1-3%, now ~0.07-0.2%)
                const dropRate = 0.0007 + Math.random() * 0.0013;
                newDist = lastDist * (1 - dropRate);
            } else {
                // Normal small improvement with diminishing returns (reduced by 15x)
                const improvementRate = Math.max(0.00002, 0.00033 * Math.exp(-progress * 0.015));
                const improvement = lastDist * improvementRate * (0.3 + Math.random() * 0.7);
                newDist = lastDist - improvement;
            }
            
            // Don't go below 60% of starting distance
            newDist = Math.max(twoOptStartDist * 0.6, newDist);
            fakeBurndownData.push(newDist);
        }
        
        // Update display
        distHistory = [...fakeBurndownData];
        const currentDist = fakeBurndownData[fakeBurndownData.length - 1];
        const currentTravelTime = currentDist / fakeBurndownTravelSpeed;
        const currentTotalTime = fakeBurndownDrawTime + currentTravelTime;
        
        const savedTime = fakeBurndownOrigTotalTime - currentTotalTime;
        const savedPct = fakeBurndownOrigTotalTime > 0 ? (savedTime / fakeBurndownOrigTotalTime * 100) : 0;
        
        statTime.textContent = formatTime(currentTotalTime);
        statTimeSaved.textContent = `${formatTime(savedTime)} (${savedPct.toFixed(1)}%)`;
        statIter.textContent = `${fakeBurndownData.length - 1}+`;
        
        drawGraph(fakeBurndownDrawTime, fakeBurndownTravelSpeed);
        
        // Continue animation at ~60fps
        requestAnimationFrame(step);
    }
    
    step();
}

function finishBurndownWithRealData(realHistory, iterations, finalDist, gcodeDist, drawTime, travelSpeed) {
    fakeBurndownActive = false;
    
    // Get current fake iteration count to continue from
    const fakeIterCount = fakeBurndownData.length;
    
    // Create transition: scale fake data to connect smoothly with real data
    const mergedHistory = [];
    
    if (fakeBurndownData.length > 1 && realHistory.length > 0) {
        // Scale fake data so its end point matches the start of real data
        const realStart = realHistory[0];
        const fakeEnd = fakeBurndownData[fakeBurndownData.length - 1];
        const scaleFactor = realStart / fakeEnd;
        
        for (const fakeVal of fakeBurndownData) {
            mergedHistory.push(fakeVal * scaleFactor);
        }
    }
    
    // Add all real data points
    mergedHistory.push(...realHistory);
    
    // Set as current history (shows fake portion immediately)
    distHistory = mergedHistory.slice(0, fakeIterCount);
    
    graphContainer.classList.add('visible');
    requestAnimationFrame(() => {
        resizeGraphCanvas();
        // Continue animation from where fake left off
        startGraphAnimation(mergedHistory, iterations, finalDist, gcodeDist, drawTime, travelSpeed, true, fakeIterCount);
    });
}

// ─── Line filter visualization ───────────────────────────────────────────────

// Pre-compute path lengths for local scanning animation
function computeVisiblePathIndices() {
    const minLength = 2.0;  // minimum 2mm to be considered "visible"
    const pathLengths = [];
    
    for (let i = 0; i < originalPaths.length; i++) {
        const path = originalPaths[i];
        let length = 0;
        for (let j = 0; j < path.length - 1; j++) {
            const dx = path[j + 1].x - path[j].x;
            const dy = path[j + 1].y - path[j].y;
            length += Math.sqrt(dx * dx + dy * dy);
        }
        if (length >= minLength) {
            pathLengths.push({ index: i, length });
        }
    }
    
    // Sort by length descending, take top 60%
    pathLengths.sort((a, b) => b.length - a.length);
    const topCount = Math.max(5, Math.floor(pathLengths.length * 0.6));
    return pathLengths.slice(0, topCount).map(p => p.index);
}

function startLocalScanAnimation() {
    const token = ++localScanToken;
    localScanActive = true;
    filterScanning = true;
    
    const visibleIndices = computeVisiblePathIndices();
    if (visibleIndices.length === 0) {
        // Fallback to all paths
        for (let i = 0; i < Math.min(originalPaths.length, 20); i++) {
            visibleIndices.push(i);
        }
    }
    
    // Cache the base scene for fast overlay rendering
    let baseImageData = null;
    
    // Draw base scene once
    filterScanning = false;  // Temporarily disable to get clean base
    draw();
    baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    filterScanning = true;
    
    // Cycle timing: 0.25s fade in, 0.5s hold, 0.25s fade out = 1s total
    const FADE_IN = 250;
    const HOLD = 500;
    const FADE_OUT = 250;
    const CYCLE = FADE_IN + HOLD + FADE_OUT;
    
    let cycleStart = performance.now();
    
    function pickNewPaths() {
        // Pick 3-8 random paths to highlight
        const count = Math.min(visibleIndices.length, 3 + Math.floor(Math.random() * 6));
        const shuffled = [...visibleIndices].sort(() => Math.random() - 0.5);
        localScanIndices = shuffled.slice(0, count);
        scanningPaths = localScanIndices.map(i => originalPaths[i]).filter(p => p);
    }
    
    pickNewPaths();
    
    function scanStep() {
        if (!localScanActive || token !== localScanToken) {
            return;
        }
        
        const now = performance.now();
        const cycleElapsed = now - cycleStart;
        
        // Calculate alpha based on cycle phase
        let alpha = 0;
        if (cycleElapsed < FADE_IN) {
            // Fade in
            alpha = cycleElapsed / FADE_IN;
        } else if (cycleElapsed < FADE_IN + HOLD) {
            // Hold at full
            alpha = 1;
        } else if (cycleElapsed < CYCLE) {
            // Fade out
            alpha = 1 - (cycleElapsed - FADE_IN - HOLD) / FADE_OUT;
        } else {
            // Start new cycle with new paths
            cycleStart = now;
            pickNewPaths();
            alpha = 0;
        }
        
        // Fast render: restore base image and draw scan highlights on top
        if (baseImageData) {
            ctx.putImageData(baseImageData, 0, 0);
        }
        
        // Draw scanning paths with glow effect
        if (scanningPaths.length > 0 && alpha > 0.01) {
            ctx.save();
            ctx.shadowColor = `rgba(255, 0, 60, ${0.8 * alpha})`;
            ctx.shadowBlur = 15 * alpha;
            ctx.strokeStyle = `rgba(255, 40, 40, ${alpha})`;
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            for (const path of scanningPaths) {
                if (path.length < 2) continue;
                const start = transform(path[0].x, path[0].y);
                ctx.moveTo(start.x, start.y);
                for (let i = 1; i < path.length; i++) {
                    const pt = transform(path[i].x, path[i].y);
                    ctx.lineTo(pt.x, pt.y);
                }
            }
            ctx.stroke();
            ctx.restore();
        }
        
        // Continue at ~30fps for smooth fading
        requestAnimationFrame(scanStep);
    }
    
    scanStep();
}

function stopLocalScanAnimation() {
    localScanActive = false;
    filterScanning = false;
    localScanIndices = [];
    scanningPaths = [];
    draw();
}

function showFilterPanel(data) {
    const keptPct = data.original_count > 0
        ? (data.kept_count / data.original_count * 100) : 100;
    const removedPct = 100 - keptPct;

    // Set bar widths (CSS transition animates them)
    filterBarKept.style.width = keptPct + '%';
    filterBarRemoved.style.width = removedPct + '%';

    filterRemovedEl.textContent = data.removed_count;
    filterKeptEl.textContent = data.kept_count;
    
    const settings = loadSettings();
    const removedDist = calculateDrawDistance(removedPaths);
    const timeSaved = removedDist / settings.feedrate;
    filterTimeSavedEl.textContent = formatTime(timeSaved);
    
    filterPenEl.textContent = data.pen_width;
    filterVisEl.textContent = data.visibility_threshold;

    filterPanel.classList.remove('scanning');
    filterPanel.classList.add('visible');
}

function runFilterAnim() {
    if (!filterAnimStart || removedPaths.length === 0) return;

    const elapsed = performance.now() - filterAnimStart;

    // Redraw base scene (kept paths in grey)
    draw();

    // Three-phase animation: 
    // 0-400ms: fade-in highlight
    // 400-1200ms: hold highlight
    // 1200-2500ms: fade out on main canvas while box slides in
    const MOVE_START = 1200;
    const ANIM_DURATION = 2500;
    
    let alpha = 1;

    if (elapsed < 400) {
        alpha = elapsed / 400;
    } else if (elapsed < MOVE_START) {
        alpha = 1;
    } else if (elapsed < ANIM_DURATION) {
        const t = (elapsed - MOVE_START) / (ANIM_DURATION - MOVE_START);
        const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
        alpha = 1 - ease;  // Fade out
        
        // Slide in the box at start of this phase
        if (!removedLinesBox.classList.contains('visible')) {
            removedLinesBox.classList.add('visible');
            // Wait for CSS transition before drawing (500ms transition + 50ms buffer)
            setTimeout(drawRemovedPathsInBox, 550);
        }
    } else {
        // Animation complete - paths only in box
        removedPathsInCorner = true;
        filterAnimStart = null;
        return;
    }
    
    // Draw removed paths fading on main canvas
    if (alpha > 0.01) {
        ctx.save();
        ctx.shadowColor = `rgba(255, 107, 0, ${alpha * 0.5})`;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = `rgba(255, 60, 0, ${alpha * 0.8})`;
        ctx.lineWidth = 2;

        ctx.beginPath();
        for (const path of removedPaths) {
            if (path.length < 2) continue;
            const start = transform(path[0].x, path[0].y);
            ctx.moveTo(start.x, start.y);
            for (let i = 1; i < path.length; i++) {
                const pt = transform(path[i].x, path[i].y);
                ctx.lineTo(pt.x, pt.y);
            }
        }
        ctx.stroke();
        ctx.restore();
    }
    
    if (filterAnimStart) {
        requestAnimationFrame(runFilterAnim);
    }
}

// Draw removed paths in the dedicated box
function drawRemovedPathsInBox() {
    if (!removedLinesCanvas || !removedLinesCtx || removedPaths.length === 0) return;
    
    // Set canvas size to match display size
    const rect = removedLinesCanvas.getBoundingClientRect();
    
    // Guard: ensure box has actual dimensions before drawing
    if (rect.width < 10 || rect.height < 10) {
        // Retry later if still animating
        setTimeout(drawRemovedPathsInBox, 100);
        return;
    }
    
    removedLinesCanvas.width = rect.width * window.devicePixelRatio;
    removedLinesCanvas.height = rect.height * window.devicePixelRatio;
    removedLinesCtx.scale(window.devicePixelRatio, window.devicePixelRatio);
    
    // Calculate bounds of removed paths
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const path of removedPaths) {
        for (const pt of path) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
        }
    }
    
    const pathWidth = maxX - minX || 1;
    const pathHeight = maxY - minY || 1;
    const padding = 8;
    const boxW = rect.width - padding * 2;
    const boxH = rect.height - padding * 2;
    const scale = Math.min(boxW / pathWidth, boxH / pathHeight);
    
    const offsetX = padding + (boxW - pathWidth * scale) / 2;
    const offsetY = padding + (boxH - pathHeight * scale) / 2;
    
    removedLinesCtx.clearRect(0, 0, rect.width, rect.height);
    removedLinesCtx.save();
    
    removedLinesCtx.shadowColor = 'rgba(255, 107, 0, 0.4)';
    removedLinesCtx.shadowBlur = 4;
    removedLinesCtx.strokeStyle = 'rgba(255, 60, 0, 0.6)';
    removedLinesCtx.lineWidth = 1.5;
    
    removedLinesCtx.beginPath();
    for (const path of removedPaths) {
        if (path.length < 2) continue;
        const sx = offsetX + (path[0].x - minX) * scale;
        const sy = offsetY + (path[0].y - minY) * scale;
        removedLinesCtx.moveTo(sx, sy);
        for (let i = 1; i < path.length; i++) {
            const px = offsetX + (path[i].x - minX) * scale;
            const py = offsetY + (path[i].y - minY) * scale;
            removedLinesCtx.lineTo(px, py);
        }
    }
    removedLinesCtx.stroke();
    removedLinesCtx.restore();
}

// Draw removed paths in corner (called from main draw when animation is done)
function drawRemovedPathsInCorner() {
    // Now handled by box, this is a no-op
    return;
}

function calculateBounds(paths) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const path of paths) {
        for (const pt of path) {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
        }
    }
    const padX = (maxX - minX) * 0.1 || 10;
    const padY = (maxY - minY) * 0.1 || 10;
    bounds = {
        minX: minX - padX,
        maxX: maxX + padX,
        minY: minY - padY,
        maxY: maxY + padY
    };
}

function transform(x, y) {
    // Use display dimensions (not canvas resolution which includes devicePixelRatio)
    const w = canvas.displayWidth || canvas.width;
    const h = canvas.displayHeight || canvas.height;
    const scaleX = w / (bounds.maxX - bounds.minX);
    const scaleY = h / (bounds.maxY - bounds.minY);
    const scale = Math.min(scaleX, scaleY);
    
    const offsetX = (w - (bounds.maxX - bounds.minX) * scale) / 2;
    const offsetY = (h - (bounds.maxY - bounds.minY) * scale) / 2;

    return {
        x: (x - bounds.minX) * scale + offsetX,
        y: h - ((y - bounds.minY) * scale + offsetY)
    };
}

function draw() {
    const w = canvas.displayWidth || canvas.width;
    const h = canvas.displayHeight || canvas.height;
    ctx.clearRect(0, 0, w, h);
    
    // During greedy animation, make background much dimmer to highlight animated paths
    const bgOpacity = greedyAnimating ? 0.06 : 0.2;
    
    // Draw original paths (faint grey - dimmer during greedy animation)
    ctx.strokeStyle = isComparing ? 'rgba(226, 232, 240, 0.5)' : `rgba(160, 170, 181, ${bgOpacity})`;
    ctx.lineWidth = isComparing ? 0.8 : 1;
    for (const path of originalPaths) {
        if (path.length < 2) continue;
        ctx.beginPath();
        const start = transform(path[0].x, path[0].y);
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < path.length; i++) {
            const pt = transform(path[i].x, path[i].y);
            ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
    }

    // Draw original travel moves (faint dashed grey)
    if (originalPaths.length > 0 && (optimizedPaths.length === 0 || isComparing)) {
        ctx.strokeStyle = isComparing ? 'rgba(255, 107, 0, 0.6)' : `rgba(160, 170, 181, ${bgOpacity * 0.5})`;
        ctx.setLineDash(isComparing ? [4, 4] : [2, 4]);
        ctx.lineWidth = isComparing ? 1 : 1;
        ctx.beginPath();
        let lastEnd = transform(0, 0);
        ctx.moveTo(lastEnd.x, lastEnd.y);
        for (const path of originalPaths) {
            const start = transform(path[0].x, path[0].y);
            ctx.lineTo(start.x, start.y);
            lastEnd = transform(path[path.length-1].x, path[path.length-1].y);
            ctx.moveTo(lastEnd.x, lastEnd.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Draw scanning paths (cyberpunk red highlight with pulsing glow)
    if (filterScanning && scanningPaths.length > 0) {
        ctx.save();
        
        // Create pulsing effect based on time
        // const pulsePhase = (performance.now() % 400) / 400;
        const pulsePhase = 1; // Disable pulsing for better performance during scanning
        const pulseIntensity = 0.6 + 0.4 * Math.sin(pulsePhase * Math.PI * 2);
        
        // Glow effect
        ctx.shadowColor = `rgba(255, 0, 60, ${0.8 * pulseIntensity})`;
        ctx.shadowBlur = 15 * pulseIntensity;
        ctx.strokeStyle = `rgba(255, 40, 40, ${0.7 + 0.3 * pulseIntensity})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (const path of scanningPaths) {
            if (path.length < 2) continue;
            const start = transform(path[0].x, path[0].y);
            ctx.moveTo(start.x, start.y);
            for (let i = 1; i < path.length; i++) {
                const pt = transform(path[i].x, path[i].y);
                ctx.lineTo(pt.x, pt.y);
            }
        }
        ctx.stroke();
        ctx.restore();
        
        // Request next frame for pulsing animation
        requestAnimationFrame(draw);
    }
    
    if (isComparing) return;

    // Draw optimized paths (solid white/light grey)
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
    ctx.lineWidth = 0.8;
    
    for (const path of optimizedPaths) {
        if (path.length < 2) continue;
        ctx.beginPath();
        const start = transform(path[0].x, path[0].y);
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < path.length; i++) {
            const pt = transform(path[i].x, path[i].y);
            ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
    }
    
    // Draw optimized travel moves (dashed orange)
    if (optimizedPaths.length > 0) {
        ctx.strokeStyle = 'rgba(255, 107, 0, 0.6)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        let lastEnd = transform(0, 0);
        ctx.moveTo(lastEnd.x, lastEnd.y);
        for (const path of optimizedPaths) {
            const start = transform(path[0].x, path[0].y);
            ctx.lineTo(start.x, start.y);
            lastEnd = transform(path[path.length-1].x, path[path.length-1].y);
            ctx.moveTo(lastEnd.x, lastEnd.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }
    
    // Draw removed paths in corner if animation is complete
    drawRemovedPathsInCorner();
}

function drawGraph(drawTime = 0, travelSpeed = 1) {
    const w = graphCanvas.width;
    const h = graphCanvas.height;
    if (w === 0 || h === 0 || distHistory.length < 2) return;
    
    graphCtx.clearRect(0, 0, w, h);
    
    const pad = { top: 18, bottom: 8, left: 6, right: 6 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;
    
    // Draw grid
    graphCtx.strokeStyle = 'rgba(160, 170, 181, 0.08)';
    graphCtx.lineWidth = 1;
    graphCtx.beginPath();
    for (let i = pad.left; i < w - pad.right; i += 25) {
        graphCtx.moveTo(i, pad.top);
        graphCtx.lineTo(i, h - pad.bottom);
    }
    for (let i = pad.top; i < h - pad.bottom; i += 15) {
        graphCtx.moveTo(pad.left, i);
        graphCtx.lineTo(w - pad.right, i);
    }
    graphCtx.stroke();
    
    const maxDist = Math.max(...distHistory);
    const minDist = Math.min(...distHistory);
    const range = maxDist - minDist || 1;
    
    function toX(i) {
        return pad.left + (i / Math.max(1, distHistory.length - 1)) * plotW;
    }
    function toY(val) {
        return pad.top + (1 - (val - minDist) / range) * plotH;
    }
    
    // Draw glow under line
    graphCtx.strokeStyle = 'rgba(255, 107, 0, 0.12)';
    graphCtx.lineWidth = 6;
    graphCtx.beginPath();
    for (let i = 0; i < distHistory.length; i++) {
        const x = toX(i), y = toY(distHistory[i]);
        if (i === 0) graphCtx.moveTo(x, y);
        else graphCtx.lineTo(x, y);
    }
    graphCtx.stroke();
    
    // Draw main line
    graphCtx.strokeStyle = '#ff6b00';
    graphCtx.lineWidth = 1.5;
    graphCtx.beginPath();
    for (let i = 0; i < distHistory.length; i++) {
        const x = toX(i), y = toY(distHistory[i]);
        if (i === 0) graphCtx.moveTo(x, y);
        else graphCtx.lineTo(x, y);
    }
    graphCtx.stroke();
    
    // Current point dot
    const lastIdx = distHistory.length - 1;
    const lx = toX(lastIdx), ly = toY(distHistory[lastIdx]);
    graphCtx.fillStyle = '#ff6b00';
    graphCtx.beginPath();
    graphCtx.arc(lx, ly, 3, 0, Math.PI * 2);
    graphCtx.fill();
    
    // Title label
    graphCtx.fillStyle = 'rgba(160, 170, 181, 0.6)';
    graphCtx.font = '9px "Share Tech Mono", monospace';
    graphCtx.textAlign = 'left';
    graphCtx.fillText('TOTAL TIME // CONVERGENCE', pad.left, 12);
    
    // Axis value labels
    const maxTime = drawTime + (maxDist / travelSpeed);
    const minTime = drawTime + (minDist / travelSpeed);
    
    graphCtx.fillStyle = 'rgba(226, 232, 240, 0.5)';
    graphCtx.font = '8px "Share Tech Mono", monospace';
    graphCtx.textAlign = 'right';
    graphCtx.fillText(formatTime(maxTime), w - pad.right, pad.top + 8);
    graphCtx.fillText(formatTime(minTime), w - pad.right, h - pad.bottom - 2);
    graphCtx.textAlign = 'left';
}
