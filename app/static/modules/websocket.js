// ─── WebSocket handling ───────────────────────────────────────────────────────

import { state } from './state.js';
import {
    statPaths, statOpt, statPhase, statOrigTime,
    graphContainer,
} from './dom.js';
import { log, setStatus, formatTime, calculateDrawDistance } from './utils.js';
import { loadSettings } from './settings.js';
import { draw, resizeGraphCanvas } from './visualization.js';
import {
    finalizeUI,
    startGraphAnimation,
    startGreedyAnimation,
    startLocalScanAnimation,
    stopLocalScanAnimation,
    showFilterPanel,
    runFilterAnim,
    finishBurndownWithRealData,
} from './animation.js';

export function connectWebSocket(jobId) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const basePath = window.location.pathname.replace(/\/+$/, '');
    const ws = new WebSocket(`${protocol}//${window.location.host}${basePath}/ws/${jobId}`);

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
            state.currentPhase = data.phase;

            if (data.phase === 1) {
                statPhase.textContent = 'PHASE 1: GREEDY NN';
                if (data.latest_path) {
                    state.optimizedPaths.push(data.latest_path);
                }
                const percent = Math.round((data.current / data.total) * 100);
                statPaths.textContent = `${data.current} / ${data.total}`;
                statOpt.textContent = `${percent}%`;
                draw();
            }

        } else if (data.type === 'filter_start') {
            statPhase.textContent = 'LINE FILTER';
            log(`Scanning ${data.path_count} paths (pen: ${data.pen_width}mm, visibility ≥${data.visibility_threshold}%)...`);
            startLocalScanAnimation();

        } else if (data.type === 'filter_result') {
            stopLocalScanAnimation();
            state.currentPhase = 0;

            const removedSet = new Set(data.removed_indices || []);
            state.removedPaths = state.originalPaths.filter((_, i) => removedSet.has(i));
            state.originalPaths = state.originalPaths.filter((_, i) => !removedSet.has(i));

            statPaths.textContent = `0 / ${data.kept_count}`;

            showFilterPanel(data);

            if (state.removedPaths.length > 0) {
                state.filterAnimStart = performance.now();
                requestAnimationFrame(runFilterAnim);
            } else {
                draw();
            }

        } else if (data.type === 'greedy_result') {
            state.currentPhase = 1;
            statPhase.textContent = 'PHASE 1: GREEDY NN';

            state.greedyHistory = data.progress_history || [];
            state.greedyOriginalDist = data.original_dist;
            state.greedyPhase1Dist = data.phase1_dist;
            state.twoOptStartDist = data.phase1_dist;

            statPaths.textContent = `${data.path_count} / ${data.path_count}`;
            statOpt.textContent = '100%';

            if (data.paths && data.paths.length > 0) {
                state.optimizedPaths = data.paths;
            }
            draw();

            startGreedyAnimation(data.progress_history, data.path_count);

        } else if (data.type === 'twoopt_start') {
            state.twoOptCompleted = false;
            state.pendingTwoOptResult = null;
            state.fakeBurndownActive = false;
            statPhase.textContent = 'PHASE 2: 2-OPT';

        } else if (data.type === 'phase2_result') {
            state.twoOptCompleted = true;
            state.currentPhase = 2;
            statOpt.textContent = '100%';

            const settings = loadSettings();
            const drawDist = calculateDrawDistance(state.originalPaths);
            const drawTime = drawDist / settings.feedrate;
            const origTravelTime = data.gcode_dist / settings.travel_speed;
            const origTotalTime = drawTime + origTravelTime;

            statOrigTime.textContent = formatTime(origTotalTime);

            if (data.paths && data.paths.length > 0) {
                state.optimizedPaths = data.paths;
            }
            draw();

            if (state.greedyAnimating) {
                state.pendingTwoOptResult = {
                    dist_history: data.dist_history,
                    iterations: data.iterations,
                    final_dist: data.final_dist,
                    gcode_dist: data.gcode_dist,
                    drawTime,
                    travelSpeed: settings.travel_speed,
                    paths: data.paths,
                };
            } else if (state.fakeBurndownActive) {
                finishBurndownWithRealData(
                    data.dist_history, data.iterations, data.final_dist,
                    data.gcode_dist, drawTime, settings.travel_speed,
                );
            } else {
                state.distHistory = [];
                graphContainer.classList.add('visible');
                requestAnimationFrame(() => {
                    resizeGraphCanvas();
                    startGraphAnimation(
                        data.dist_history, data.iterations, data.final_dist,
                        data.gcode_dist, drawTime, settings.travel_speed, false,
                    );
                });
            }

        } else if (data.type === 'complete') {
            ws.close();
            if (state.graphAnimating || state.greedyAnimating || state.fakeBurndownActive) {
                state.pendingComplete = true;
            } else {
                finalizeUI();
            }
        }
    };

    ws.onerror = () => {
        log('WEBSOCKET ERROR DETECTED.', 'accent');
        setStatus('ERROR', false);
    };
}
