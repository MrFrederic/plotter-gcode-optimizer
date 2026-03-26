// ─── Canvas visualization ─────────────────────────────────────────────────────

import { state } from './state.js';
import {
    canvas, ctx,
    graphContainer, graphCanvas, graphCtx,
} from './dom.js';
import { formatTime } from './utils.js';

// ─── Bounds and coordinate transform ─────────────────────────────────────────

export function calculateBounds(paths) {
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
    state.bounds = {
        minX: minX - padX,
        maxX: maxX + padX,
        minY: minY - padY,
        maxY: maxY + padY,
    };
}

export function transform(x, y) {
    // Use display dimensions (not canvas resolution which includes devicePixelRatio)
    const w = canvas.displayWidth || canvas.width;
    const h = canvas.displayHeight || canvas.height;
    const { minX, maxX, minY, maxY } = state.bounds;
    const scaleX = w / (maxX - minX);
    const scaleY = h / (maxY - minY);
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (w - (maxX - minX) * scale) / 2;
    const offsetY = (h - (maxY - minY) * scale) / 2;

    return {
        x: (x - minX) * scale + offsetX,
        y: h - ((y - minY) * scale + offsetY),
    };
}

// ─── Main canvas draw ─────────────────────────────────────────────────────────

export function draw() {
    const w = canvas.displayWidth || canvas.width;
    const h = canvas.displayHeight || canvas.height;
    ctx.clearRect(0, 0, w, h);

    // During greedy animation, make background much dimmer to highlight animated paths
    const bgOpacity = state.greedyAnimating ? 0.06 : 0.2;

    // Draw original paths (faint grey — dimmer during greedy animation)
    ctx.strokeStyle = state.isComparing
        ? 'rgba(226, 232, 240, 0.5)'
        : `rgba(160, 170, 181, ${bgOpacity})`;
    ctx.lineWidth = state.isComparing ? 0.8 : 1;
    for (const path of state.originalPaths) {
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
    if (state.originalPaths.length > 0 && (state.optimizedPaths.length === 0 || state.isComparing)) {
        ctx.strokeStyle = state.isComparing
            ? 'rgba(255, 107, 0, 0.6)'
            : `rgba(160, 170, 181, ${bgOpacity * 0.5})`;
        ctx.setLineDash(state.isComparing ? [4, 4] : [2, 4]);
        ctx.lineWidth = state.isComparing ? 1 : 1;
        ctx.beginPath();
        let lastEnd = transform(0, 0);
        ctx.moveTo(lastEnd.x, lastEnd.y);
        for (const path of state.originalPaths) {
            const start = transform(path[0].x, path[0].y);
            ctx.lineTo(start.x, start.y);
            lastEnd = transform(path[path.length - 1].x, path[path.length - 1].y);
            ctx.moveTo(lastEnd.x, lastEnd.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Draw scanning paths (cyberpunk red highlight with pulsing glow)
    if (state.filterScanning && state.scanningPaths.length > 0) {
        ctx.save();
        const pulsePhase = 1; // Disable pulsing for better performance during scanning
        const pulseIntensity = 0.6 + 0.4 * Math.sin(pulsePhase * Math.PI * 2);
        ctx.shadowColor = `rgba(255, 0, 60, ${0.8 * pulseIntensity})`;
        ctx.shadowBlur = 15 * pulseIntensity;
        ctx.strokeStyle = `rgba(255, 40, 40, ${0.7 + 0.3 * pulseIntensity})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        for (const path of state.scanningPaths) {
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
        requestAnimationFrame(draw);
    }

    if (state.isComparing) return;

    // Draw optimized paths (solid white/light grey)
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.5)';
    ctx.lineWidth = 0.8;
    for (const path of state.optimizedPaths) {
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
    if (state.optimizedPaths.length > 0) {
        ctx.strokeStyle = 'rgba(255, 107, 0, 0.6)';
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        let lastEnd = transform(0, 0);
        ctx.moveTo(lastEnd.x, lastEnd.y);
        for (const path of state.optimizedPaths) {
            const start = transform(path[0].x, path[0].y);
            ctx.lineTo(start.x, start.y);
            lastEnd = transform(path[path.length - 1].x, path[path.length - 1].y);
            ctx.moveTo(lastEnd.x, lastEnd.y);
        }
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

// ─── Graph canvas ─────────────────────────────────────────────────────────────

export function resizeGraphCanvas() {
    const graphRect = graphContainer.getBoundingClientRect();
    graphCanvas.width = graphRect.width;
    graphCanvas.height = graphRect.height;
}

export function drawGraph(drawTime = 0, travelSpeed = 1) {
    const w = graphCanvas.width;
    const h = graphCanvas.height;
    if (w === 0 || h === 0 || state.distHistory.length < 2) return;

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

    const maxDist = Math.max(...state.distHistory);
    const minDist = Math.min(...state.distHistory);
    const range = maxDist - minDist || 1;

    function toX(i) {
        return pad.left + (i / Math.max(1, state.distHistory.length - 1)) * plotW;
    }
    function toY(val) {
        return pad.top + (1 - (val - minDist) / range) * plotH;
    }

    // Draw glow under line
    graphCtx.strokeStyle = 'rgba(255, 107, 0, 0.12)';
    graphCtx.lineWidth = 6;
    graphCtx.beginPath();
    for (let i = 0; i < state.distHistory.length; i++) {
        const x = toX(i), y = toY(state.distHistory[i]);
        if (i === 0) graphCtx.moveTo(x, y);
        else graphCtx.lineTo(x, y);
    }
    graphCtx.stroke();

    // Draw main line
    graphCtx.strokeStyle = '#ff6b00';
    graphCtx.lineWidth = 1.5;
    graphCtx.beginPath();
    for (let i = 0; i < state.distHistory.length; i++) {
        const x = toX(i), y = toY(state.distHistory[i]);
        if (i === 0) graphCtx.moveTo(x, y);
        else graphCtx.lineTo(x, y);
    }
    graphCtx.stroke();

    // Current point dot
    const lastIdx = state.distHistory.length - 1;
    const lx = toX(lastIdx), ly = toY(state.distHistory[lastIdx]);
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

// ─── Main canvas resize ───────────────────────────────────────────────────────

export function resizeCanvas() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    canvas.displayWidth = rect.width;
    canvas.displayHeight = rect.height;

    if (graphContainer.classList.contains('visible')) {
        resizeGraphCanvas();
    }

    draw();
    drawGraph();
}
