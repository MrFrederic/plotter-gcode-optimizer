// ─── Utility functions ────────────────────────────────────────────────────────

import { terminal, statusText, statusDot } from './dom.js';

export function setStatus(text, active = false) {
    statusText.textContent = `STATUS: ${text}`;
    if (active) statusDot.classList.add('active');
    else statusDot.classList.remove('active');
}

export function log(msg, type = 'normal') {
    const div = document.createElement('div');
    div.textContent = msg;
    if (type === 'highlight') div.className = 'log-highlight';
    if (type === 'accent') div.className = 'log-accent';
    terminal.appendChild(div);
    terminal.scrollTop = terminal.scrollHeight;
}

export function formatTime(minutes) {
    if (minutes < 1) {
        return Math.round(minutes * 60) + 's';
    }
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
}

export function calculateDrawDistance(paths) {
    let dist = 0;
    for (const path of paths) {
        for (let i = 0; i < path.length - 1; i++) {
            const dx = path[i + 1].x - path[i].x;
            const dy = path[i + 1].y - path[i].y;
            dist += Math.sqrt(dx * dx + dy * dy);
        }
    }
    return dist;
}
