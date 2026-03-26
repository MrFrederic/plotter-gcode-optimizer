// ─── Animation logic ──────────────────────────────────────────────────────────

import { state } from './state.js';
import {
    canvas, ctx,
    statPaths, statOpt, statPhase, statOrigTime, statTime, statTimeSaved, statIter,
    graphContainer,
    filterPanel, filterBarKept, filterBarRemoved,
    filterRemovedEl, filterKeptEl, filterTimeSavedEl, filterPenEl, filterVisEl,
    removedLinesBox, removedLinesCanvas, removedLinesCtx,
    btnDownload, btnCompare, btnUpload, btnConvertSvg, fileInput,
} from './dom.js';
import { log, setStatus, formatTime, calculateDrawDistance } from './utils.js';
import { loadSettings } from './settings.js';
import { draw, drawGraph, resizeGraphCanvas, transform } from './visualization.js';

// ─── Completion ───────────────────────────────────────────────────────────────

export function finalizeUI() {
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

// ─── Stats reset ──────────────────────────────────────────────────────────────

export function resetStats(totalPaths) {
    statPaths.textContent = `0 / ${totalPaths}`;
    statOpt.textContent = '0%';
    statPhase.textContent = 'IDLE';
    statOrigTime.textContent = '---';
    statTime.textContent = '---';
    statTimeSaved.textContent = '---';
    statIter.textContent = '---';
}

// ─── Graph animation ──────────────────────────────────────────────────────────

export function startGraphAnimation(
    fullHistory, iterations, finalDist, originalDist, drawTime, travelSpeed,
    fast = false, startIdx = 0,
) {
    const myToken = ++state.animationToken;
    state.graphAnimating = true;

    if (startIdx > 0 && state.distHistory.length >= startIdx) {
        state.distHistory = state.distHistory.slice(0, startIdx);
    } else {
        state.distHistory = [];
    }

    let idx = startIdx;
    let baseDelay = Math.max(30, Math.min(120, 3000 / Math.max(1, fullHistory.length)));
    const delay = fast ? Math.max(5, baseDelay / 8) : baseDelay;

    const origTotalTime = drawTime + (originalDist / travelSpeed);

    function step() {
        if (myToken !== state.animationToken) return;

        if (idx < fullHistory.length) {
            state.distHistory.push(fullHistory[idx]);

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
            state.graphAnimating = false;
            const finalTravelTime = finalDist / travelSpeed;
            const finalTotalTime = drawTime + finalTravelTime;
            statTime.textContent = formatTime(finalTotalTime);
            statIter.textContent = `${iterations}`;

            if (state.pendingComplete) {
                state.pendingComplete = null;
                finalizeUI();
            }
        }
    }

    step();
}

// ─── Greedy sort animation ────────────────────────────────────────────────────

export function startGreedyAnimation(progressHistory, totalPaths) {
    const myToken = ++state.greedyAnimToken;
    state.greedyAnimating = true;

    if (!progressHistory || progressHistory.length === 0) {
        state.greedyAnimating = false;
        onGreedyAnimationComplete();
        return;
    }

    let idx = 0;
    const totalFrames = Math.max(60, Math.min(180, progressHistory.length));
    const pathsPerFrame = Math.max(1, Math.ceil(progressHistory.length / totalFrames));

    state.optimizedPaths = [];

    function step() {
        if (myToken !== state.greedyAnimToken) return;

        // Check if 2-OPT finished — skip to end if so
        if (state.pendingTwoOptResult) {
            for (let i = idx; i < progressHistory.length; i++) {
                const entry = progressHistory[i];
                const origIdx = entry.original_index;
                if (origIdx >= 0 && origIdx < state.originalPaths.length) {
                    let pathToAdd = state.originalPaths[origIdx];
                    if (entry.reversed) {
                        pathToAdd = [...pathToAdd].reverse();
                    }
                    state.optimizedPaths.push(pathToAdd);
                }
            }
            statPaths.textContent = `${totalPaths} / ${totalPaths}`;
            statOpt.textContent = '100%';
            draw();
            state.greedyAnimating = false;
            onGreedyAnimationComplete();
            return;
        }

        if (idx < progressHistory.length) {
            const endIdx = Math.min(idx + pathsPerFrame, progressHistory.length);
            for (let i = idx; i < endIdx; i++) {
                const entry = progressHistory[i];
                const origIdx = entry.original_index;
                if (origIdx >= 0 && origIdx < state.originalPaths.length) {
                    let pathToAdd = state.originalPaths[origIdx];
                    if (entry.reversed) {
                        pathToAdd = [...pathToAdd].reverse();
                    }
                    state.optimizedPaths.push(pathToAdd);
                }
            }
            idx = endIdx;

            const percent = Math.round((idx / progressHistory.length) * 100);
            statPaths.textContent = `${idx} / ${totalPaths}`;
            statOpt.textContent = `${percent}%`;

            draw();
            requestAnimationFrame(step);
        } else {
            state.greedyAnimating = false;
            onGreedyAnimationComplete();
        }
    }

    step();
}

export function onGreedyAnimationComplete() {
    if (state.pendingTwoOptResult) {
        const result = state.pendingTwoOptResult;
        state.pendingTwoOptResult = null;

        if (result.paths && result.paths.length > 0) {
            state.optimizedPaths = result.paths;
            draw();
        }

        graphContainer.classList.add('visible');
        requestAnimationFrame(() => {
            resizeGraphCanvas();
            startGraphAnimation(
                result.dist_history, result.iterations, result.final_dist,
                result.gcode_dist, result.drawTime, result.travelSpeed, true,
            );
        });
    } else if (!state.twoOptCompleted) {
        startFakeBurndown();
    } else if (state.pendingComplete) {
        state.pendingComplete = null;
        finalizeUI();
    }
}

// ─── Fake burn-down chart ─────────────────────────────────────────────────────

export function startFakeBurndown() {
    state.fakeBurndownActive = true;
    state.fakeBurndownStartTime = performance.now();
    state.fakeBurndownData = [state.twoOptStartDist];
    state.fakeBurndownToken++;

    const settings = loadSettings();
    const drawDist = calculateDrawDistance(state.originalPaths);
    const drawTime = drawDist / settings.feedrate;

    graphContainer.classList.add('visible');
    resizeGraphCanvas();

    statPhase.textContent = 'PHASE 2: 2-OPT';
    statIter.textContent = 'OPTIMIZING...';

    const origTotalTime = drawTime + (state.greedyOriginalDist / settings.travel_speed);
    statOrigTime.textContent = formatTime(origTotalTime);

    state.distHistory = [...state.fakeBurndownData];
    drawGraph(drawTime, settings.travel_speed);

    runFakeBurndownStep();
}

export function runFakeBurndownStep() {
    if (!state.fakeBurndownActive) return;

    const token = state.fakeBurndownToken;
    const settings = loadSettings();
    const drawDist = calculateDrawDistance(state.originalPaths);
    state.fakeBurndownDrawTime = drawDist / settings.feedrate;
    state.fakeBurndownTravelSpeed = settings.travel_speed;
    state.fakeBurndownOrigTotalTime =
        state.fakeBurndownDrawTime + (state.greedyOriginalDist / settings.travel_speed);

    statOrigTime.textContent = formatTime(state.fakeBurndownOrigTotalTime);

    let frameCounter = 0;

    function step() {
        if (!state.fakeBurndownActive || token !== state.fakeBurndownToken) return;

        frameCounter++;

        if (frameCounter % 3 === 0 && state.fakeBurndownData.length > 0) {
            const lastDist = state.fakeBurndownData[state.fakeBurndownData.length - 1];
            const progress = state.fakeBurndownData.length;

            const roll = Math.random();
            let newDist = lastDist;

            if (roll < 0.4) {
                newDist = lastDist;
            } else if (roll < 0.48) {
                const dropRate = 0.0007 + Math.random() * 0.0013;
                newDist = lastDist * (1 - dropRate);
            } else {
                const improvementRate = Math.max(0.00002, 0.00033 * Math.exp(-progress * 0.015));
                const improvement = lastDist * improvementRate * (0.3 + Math.random() * 0.7);
                newDist = lastDist - improvement;
            }

            newDist = Math.max(state.twoOptStartDist * 0.6, newDist);
            state.fakeBurndownData.push(newDist);
        }

        state.distHistory = [...state.fakeBurndownData];
        const currentDist = state.fakeBurndownData[state.fakeBurndownData.length - 1];
        const currentTravelTime = currentDist / state.fakeBurndownTravelSpeed;
        const currentTotalTime = state.fakeBurndownDrawTime + currentTravelTime;

        const savedTime = state.fakeBurndownOrigTotalTime - currentTotalTime;
        const savedPct = state.fakeBurndownOrigTotalTime > 0
            ? (savedTime / state.fakeBurndownOrigTotalTime * 100) : 0;

        statTime.textContent = formatTime(currentTotalTime);
        statTimeSaved.textContent = `${formatTime(savedTime)} (${savedPct.toFixed(1)}%)`;
        statIter.textContent = `${state.fakeBurndownData.length - 1}+`;

        drawGraph(state.fakeBurndownDrawTime, state.fakeBurndownTravelSpeed);

        requestAnimationFrame(step);
    }

    step();
}

export function finishBurndownWithRealData(
    realHistory, iterations, finalDist, gcodeDist, drawTime, travelSpeed,
) {
    state.fakeBurndownActive = false;

    const fakeIterCount = state.fakeBurndownData.length;
    const mergedHistory = [];

    if (state.fakeBurndownData.length > 1 && realHistory.length > 0) {
        const realStart = realHistory[0];
        const fakeEnd = state.fakeBurndownData[state.fakeBurndownData.length - 1];
        const scaleFactor = realStart / fakeEnd;
        for (const fakeVal of state.fakeBurndownData) {
            mergedHistory.push(fakeVal * scaleFactor);
        }
    }

    mergedHistory.push(...realHistory);

    state.distHistory = mergedHistory.slice(0, fakeIterCount);

    graphContainer.classList.add('visible');
    requestAnimationFrame(() => {
        resizeGraphCanvas();
        startGraphAnimation(
            mergedHistory, iterations, finalDist, gcodeDist,
            drawTime, travelSpeed, true, fakeIterCount,
        );
    });
}

// ─── Line filter visualization ────────────────────────────────────────────────

function computeVisiblePathIndices() {
    const minLength = 2.0;
    const pathLengths = [];

    for (let i = 0; i < state.originalPaths.length; i++) {
        const path = state.originalPaths[i];
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

    pathLengths.sort((a, b) => b.length - a.length);
    const topCount = Math.max(5, Math.floor(pathLengths.length * 0.6));
    return pathLengths.slice(0, topCount).map(p => p.index);
}

export function startLocalScanAnimation() {
    const token = ++state.localScanToken;
    state.localScanActive = true;
    state.filterScanning = true;

    const visibleIndices = computeVisiblePathIndices();
    if (visibleIndices.length === 0) {
        for (let i = 0; i < Math.min(state.originalPaths.length, 20); i++) {
            visibleIndices.push(i);
        }
    }

    // Cache base scene for fast overlay rendering
    let baseImageData = null;

    state.filterScanning = false;
    draw();
    baseImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    state.filterScanning = true;

    const FADE_IN = 250;
    const HOLD = 500;
    const FADE_OUT = 250;
    const CYCLE = FADE_IN + HOLD + FADE_OUT;

    let cycleStart = performance.now();

    function pickNewPaths() {
        const count = Math.min(visibleIndices.length, 3 + Math.floor(Math.random() * 6));
        const shuffled = [...visibleIndices].sort(() => Math.random() - 0.5);
        state.localScanIndices = shuffled.slice(0, count);
        state.scanningPaths = state.localScanIndices
            .map(i => state.originalPaths[i])
            .filter(p => p);
    }

    pickNewPaths();

    function scanStep() {
        if (!state.localScanActive || token !== state.localScanToken) return;

        const now = performance.now();
        const cycleElapsed = now - cycleStart;

        let alpha = 0;
        if (cycleElapsed < FADE_IN) {
            alpha = cycleElapsed / FADE_IN;
        } else if (cycleElapsed < FADE_IN + HOLD) {
            alpha = 1;
        } else if (cycleElapsed < CYCLE) {
            alpha = 1 - (cycleElapsed - FADE_IN - HOLD) / FADE_OUT;
        } else {
            cycleStart = now;
            pickNewPaths();
            alpha = 0;
        }

        if (baseImageData) {
            ctx.putImageData(baseImageData, 0, 0);
        }

        if (state.scanningPaths.length > 0 && alpha > 0.01) {
            ctx.save();
            ctx.shadowColor = `rgba(255, 0, 60, ${0.8 * alpha})`;
            ctx.shadowBlur = 15 * alpha;
            ctx.strokeStyle = `rgba(255, 40, 40, ${alpha})`;
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
        }

        requestAnimationFrame(scanStep);
    }

    scanStep();
}

export function stopLocalScanAnimation() {
    state.localScanActive = false;
    state.filterScanning = false;
    state.localScanIndices = [];
    state.scanningPaths = [];
    draw();
}

export function showFilterPanel(data) {
    const keptPct = data.original_count > 0
        ? (data.kept_count / data.original_count * 100) : 100;
    const removedPct = 100 - keptPct;

    filterBarKept.style.width = keptPct + '%';
    filterBarRemoved.style.width = removedPct + '%';

    filterRemovedEl.textContent = data.removed_count;
    filterKeptEl.textContent = data.kept_count;

    const settings = loadSettings();
    const removedDist = calculateDrawDistance(state.removedPaths);
    const timeSaved = removedDist / settings.feedrate;
    filterTimeSavedEl.textContent = formatTime(timeSaved);

    filterPenEl.textContent = data.pen_width;
    filterVisEl.textContent = data.visibility_threshold;

    filterPanel.classList.remove('scanning');
    filterPanel.classList.add('visible');
}

export function runFilterAnim() {
    if (!state.filterAnimStart || state.removedPaths.length === 0) return;

    const elapsed = performance.now() - state.filterAnimStart;

    draw();

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
        alpha = 1 - ease;

        if (!removedLinesBox.classList.contains('visible')) {
            removedLinesBox.classList.add('visible');
            setTimeout(drawRemovedPathsInBox, 550);
        }
    } else {
        state.removedPathsInCorner = true;
        state.filterAnimStart = null;
        return;
    }

    if (alpha > 0.01) {
        ctx.save();
        ctx.shadowColor = `rgba(255, 107, 0, ${alpha * 0.5})`;
        ctx.shadowBlur = 8;
        ctx.strokeStyle = `rgba(255, 60, 0, ${alpha * 0.8})`;
        ctx.lineWidth = 2;

        ctx.beginPath();
        for (const path of state.removedPaths) {
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

    if (state.filterAnimStart) {
        requestAnimationFrame(runFilterAnim);
    }
}

function drawRemovedPathsInBox() {
    if (!removedLinesCanvas || !removedLinesCtx || state.removedPaths.length === 0) return;

    const rect = removedLinesCanvas.getBoundingClientRect();

    if (rect.width < 10 || rect.height < 10) {
        setTimeout(drawRemovedPathsInBox, 100);
        return;
    }

    removedLinesCanvas.width = rect.width * window.devicePixelRatio;
    removedLinesCanvas.height = rect.height * window.devicePixelRatio;
    removedLinesCtx.scale(window.devicePixelRatio, window.devicePixelRatio);

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const path of state.removedPaths) {
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
    for (const path of state.removedPaths) {
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
