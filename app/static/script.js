// ─── Entry point ──────────────────────────────────────────────────────────────
// Coordinates module initialisation and global event listeners.

import { initSettings } from './modules/settings.js';
import { resizeCanvas } from './modules/visualization.js';
import { initFileHandler } from './modules/filehandler.js';

// Initialise all subsystems
initSettings();
initFileHandler();

// Handle window resize
window.addEventListener('resize', resizeCanvas);

// Initial canvas resize
resizeCanvas();
