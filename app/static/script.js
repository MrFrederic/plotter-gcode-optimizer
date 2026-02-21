// ─── Settings ────────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'cyberplotter_settings';

const DEFAULT_SETTINGS = {
    z_up: 2.0,
    z_down: 0.0,
    feedrate: 1000,
    travel_speed: 3000,
    z_speed: 500,
    max_iterations: 500,
    curve_tolerance: 0.1,
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
    document.getElementById('set-max-iterations').value = s.max_iterations;
    document.getElementById('set-curve-tolerance').value = s.curve_tolerance;
    document.getElementById('set-gcode-header').value = s.gcode_header;
    document.getElementById('set-gcode-footer').value = s.gcode_footer;
}

function readSettingsFromForm() {
    return {
        z_up: parseFloat(document.getElementById('set-z-up').value),
        z_down: parseFloat(document.getElementById('set-z-down').value),
        feedrate: parseFloat(document.getElementById('set-feedrate').value),
        travel_speed: parseFloat(document.getElementById('set-travel-speed').value),
        z_speed: parseFloat(document.getElementById('set-z-speed').value),
        max_iterations: parseInt(document.getElementById('set-max-iterations').value),
        curve_tolerance: parseFloat(document.getElementById('set-curve-tolerance').value),
        gcode_header: document.getElementById('set-gcode-header').value,
        gcode_footer: document.getElementById('set-gcode-footer').value,
    };
}

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const fileInput = document.getElementById('file-input');
const btnUpload = document.getElementById('btn-upload');
const btnConvertSvg = document.getElementById('btn-convert-svg');
const btnOptimize = document.getElementById('btn-optimize');
const btnDownload = document.getElementById('btn-download');
const terminal = document.getElementById('terminal');
const statusText = document.getElementById('status-text');
const statusDot = document.getElementById('status-dot');
const canvas = document.getElementById('viz-canvas');
const ctx = canvas.getContext('2d');
const statPaths = document.getElementById('stat-paths');
const statOpt = document.getElementById('stat-opt');
const statPhase = document.getElementById('stat-phase');
const statDist = document.getElementById('stat-dist');
const statOrigDist = document.getElementById('stat-orig-dist');
const statSavings = document.getElementById('stat-savings');
const statIter = document.getElementById('stat-iter');
const graphContainer = document.getElementById('graph-container');
const graphCanvas = document.getElementById('graph-canvas');
const graphCtx = graphCanvas.getContext('2d');
const svgPreviewPane = document.getElementById('svg-preview-pane');
const svgPreviewImg = document.getElementById('svg-preview-img');

const btnSettingsOpen = document.getElementById('btn-settings');
const btnSettingsClose = document.getElementById('btn-settings-close');
const btnSettingsSave = document.getElementById('btn-settings-save');
const btnSettingsReset = document.getElementById('btn-settings-reset');
const settingsOverlay = document.getElementById('settings-overlay');

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
    canvas.width = rect.width;
    canvas.height = rect.height;
    
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
    statOrigDist.textContent = '---';
    statDist.textContent = '---';
    statSavings.textContent = '---';
    statIter.textContent = '---';
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
    currentJobId = null;
    originalPaths = [];
    optimizedPaths = [];
    distHistory = [];
    currentPhase = 0;
    graphAnimating = false;
    pendingComplete = null;
    pendingSvgFile = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    graphContainer.classList.remove('visible');
    btnDownload.classList.add('hidden');
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
        log('PRESS [CONVERT SVG] TO BEGIN G-CODE CONVERSION.', 'normal');
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
    const progressInterval = setInterval(() => {
        if (!conversionDone && msgIdx < SVG_CONVERSION_MESSAGES.length) {
            log(SVG_CONVERSION_MESSAGES[msgIdx++]);
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
    } catch (err) {
        conversionDone = true;
        clearInterval(progressInterval);
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
    
    log('INITIATING OPTIMIZATION SEQUENCE...', 'accent');
    connectWebSocket(currentJobId);
});

btnDownload.addEventListener('click', () => {
    if (currentJobId) {
        window.location.href = `/download/${currentJobId}`;
    }
});

function finalizeUI() {
    log('OPTIMIZATION SEQUENCE COMPLETE.', 'accent');
    statPhase.textContent = 'COMPLETE';
    setStatus('COMPLETE', false);
    btnDownload.classList.remove('hidden');
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
            
        } else if (data.type === 'phase2_result') {
            currentPhase = 2;
            statPhase.textContent = 'PHASE 2: 2-OPT';
            statOpt.textContent = '100%';
            
            statOrigDist.textContent = data.original_dist.toFixed(1) + ' mm';
            
            if (data.paths && data.paths.length > 0) {
                optimizedPaths = data.paths;
            }
            draw();
            
            graphContainer.classList.add('visible');
            requestAnimationFrame(() => {
                resizeGraphCanvas();
                startGraphAnimation(data.dist_history, data.iterations, data.final_dist, data.original_dist);
            });
            
        } else if (data.type === 'complete') {
            ws.close();
            if (graphAnimating) {
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

function startGraphAnimation(fullHistory, iterations, finalDist, originalDist) {
    const myToken = ++animationToken;
    graphAnimating = true;
    distHistory = [];
    
    let idx = 0;
    const delay = Math.max(30, Math.min(120, 3000 / Math.max(1, fullHistory.length)));
    
    function step() {
        if (myToken !== animationToken) return;
        
        if (idx < fullHistory.length) {
            distHistory.push(fullHistory[idx]);
            statDist.textContent = fullHistory[idx].toFixed(1) + ' mm';
            
            if (idx === 0) {
                statIter.textContent = 'BASELINE';
            } else {
                statIter.textContent = `${idx} / ${iterations}`;
            }
            
            const saved = originalDist > 0
                ? ((originalDist - fullHistory[idx]) / originalDist * 100)
                : 0;
            statSavings.textContent = saved.toFixed(1) + '%';
            
            drawGraph();
            idx++;
            setTimeout(step, delay);
        } else {
            graphAnimating = false;
            statDist.textContent = finalDist.toFixed(1) + ' mm';
            statIter.textContent = `${iterations}`;
            
            if (pendingComplete) {
                pendingComplete = null;
                finalizeUI();
            }
        }
    }
    
    step();
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
    const w = canvas.width;
    const h = canvas.height;
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw original paths (faint grey)
    ctx.strokeStyle = 'rgba(160, 170, 181, 0.2)';
    ctx.lineWidth = 1;
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
    if (originalPaths.length > 0 && optimizedPaths.length === 0) {
        ctx.strokeStyle = 'rgba(160, 170, 181, 0.1)';
        ctx.setLineDash([2, 4]);
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

    // Draw optimized paths (solid white/light grey)
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.5;
    
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
}

function drawGraph() {
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
    graphCtx.fillText('PEN-UP TRAVEL // CONVERGENCE', pad.left, 12);
    
    // Axis value labels
    graphCtx.fillStyle = 'rgba(226, 232, 240, 0.5)';
    graphCtx.font = '8px "Share Tech Mono", monospace';
    graphCtx.textAlign = 'right';
    graphCtx.fillText(maxDist.toFixed(0), w - pad.right, pad.top + 8);
    graphCtx.fillText(minDist.toFixed(0), w - pad.right, h - pad.bottom - 2);
    graphCtx.textAlign = 'left';
}
