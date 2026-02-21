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

let currentJobId = null;
let originalPaths = [];
let optimizedPaths = [];
let bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };

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
    draw();
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
    originalPaths = [];
    optimizedPaths = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
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
            optimizedPaths.push(data.latest_path);
            const percent = Math.round((data.current / data.total) * 100);
            statPaths.textContent = `${data.current} / ${data.total}`;
            statOpt.textContent = `${percent}%`;
            draw();
        } else if (data.type === 'complete') {
            log('OPTIMIZATION SEQUENCE COMPLETE.', 'accent');
            setStatus('COMPLETE', false);
            btnDownload.classList.remove('hidden');
            btnUpload.classList.remove('disabled');
            btnUpload.disabled = false;
            ws.close();
        }
    };

    ws.onerror = (err) => {
        log('WEBSOCKET ERROR DETECTED.', 'accent');
        setStatus('ERROR', false);
    };
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
    // Add padding
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
        y: h - ((y - bounds.minY) * scale + offsetY) // Invert Y for standard cartesian
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
    ctx.strokeStyle = 'rgba(255, 107, 0, 0.6)';
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    if (optimizedPaths.length > 0) {
        let lastEnd = transform(0, 0);
        ctx.moveTo(lastEnd.x, lastEnd.y);
        for (const path of optimizedPaths) {
            const start = transform(path[0].x, path[0].y);
            ctx.lineTo(start.x, start.y);
            lastEnd = transform(path[path.length-1].x, path[path.length-1].y);
            ctx.moveTo(lastEnd.x, lastEnd.y);
        }
    }
    ctx.stroke();
    ctx.setLineDash([]);
}
