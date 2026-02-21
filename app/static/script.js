const fileInput = document.getElementById('file-input');
const btnUpload = document.getElementById('btn-upload');
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

let currentJobId = null;
let originalPaths = [];
let optimizedPaths = [];
let bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
let distHistory = [];
let currentPhase = 0;
let graphAnimating = false;
let animationToken = 0;
let pendingComplete = null;

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

fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    log(`FILE SELECTED: ${file.name}`, 'highlight');
    btnOptimize.classList.remove('disabled');
    btnOptimize.disabled = false;
    btnDownload.classList.add('hidden');
    
    // Reset state
    animationToken++;
    originalPaths = [];
    optimizedPaths = [];
    distHistory = [];
    currentPhase = 0;
    graphAnimating = false;
    pendingComplete = null;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    graphContainer.classList.remove('visible');
    
    setStatus('PARSING FILE', true);
    log('UPLOADING AND PARSING G-CODE...', 'normal');
    
    const formData = new FormData();
    formData.append('file', file);

    try {
        const response = await fetch('/upload', {
            method: 'POST',
            body: formData
        });
        const data = await response.json();
        currentJobId = data.job_id;
        originalPaths = data.paths;
        
        log(`JOB ID ASSIGNED: ${currentJobId}`, 'accent');
        log(`EXTRACTED ${originalPaths.length} PATHS. READY FOR OPTIMIZATION.`, 'highlight');
        
        statPaths.textContent = `0 / ${originalPaths.length}`;
        statOpt.textContent = '0%';
        statPhase.textContent = 'IDLE';
        statOrigDist.textContent = '---';
        statDist.textContent = '---';
        statSavings.textContent = '---';
        statIter.textContent = '---';
        
        calculateBounds(originalPaths);
        resizeCanvas();
        setStatus('READY', false);
        
    } catch (err) {
        log(`ERROR: ${err.message}`, 'accent');
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
            
            // Update stats
            statOrigDist.textContent = data.original_dist.toFixed(1) + ' mm';
            
            // Update paths to final ordering
            if (data.paths && data.paths.length > 0) {
                optimizedPaths = data.paths;
            }
            draw();
            
            // Show graph and start animation
            graphContainer.classList.add('visible');
            // Use rAF to ensure container has layout before sizing the canvas
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
