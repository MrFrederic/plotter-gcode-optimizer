/** Central application store using Zustand. */

import { create } from 'zustand';
import type {
  OptimizerSettings,
  PathData,
  OptPhase,
  PreviewLayers,
  WSEvent,
} from '../types';
import { DEFAULT_SETTINGS } from '../types';

const SETTINGS_KEY = 'cyberplotter_settings';

function loadPersistedSettings(): OptimizerSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

function persistSettings(s: OptimizerSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export interface StatsState {
  originalDist: number;
  phase1Dist: number;
  finalDist: number;
  gcodeDist: number;
  iterations: number;
  distHistory: number[];
  filterRemoved: number;
  filterKept: number;
  removedIndices: number[];
  mergeCount: number;
}

export interface AppState {
  // ── Settings ────────────────────────────────────────────────────
  settings: OptimizerSettings;
  updateSettings: (partial: Partial<OptimizerSettings>) => void;
  resetSettings: () => void;

  // ── Job state ───────────────────────────────────────────────────
  jobId: string | null;
  phase: OptPhase;
  logs: string[];
  progress: number;
  stats: StatsState;

  // ── Path data / preview layers ──────────────────────────────────
  layers: PreviewLayers;
  visibleLayers: Record<keyof PreviewLayers, boolean>;
  toggleLayer: (layer: keyof PreviewLayers) => void;

  // ── Actions ─────────────────────────────────────────────────────
  setJobId: (id: string) => void;
  setPhase: (phase: OptPhase) => void;
  addLog: (msg: string) => void;
  setOriginalPaths: (paths: PathData[]) => void;
  handleWSEvent: (event: WSEvent) => void;
  reset: () => void;
}

const initialStats: StatsState = {
  originalDist: 0,
  phase1Dist: 0,
  finalDist: 0,
  gcodeDist: 0,
  iterations: 0,
  distHistory: [],
  filterRemoved: 0,
  filterKept: 0,
  removedIndices: [],
  mergeCount: 0,
};

const initialLayers: PreviewLayers = {
  original: [],
  filtered: null,
  greedy: null,
  merged: null,
  twoopt: null,
  final: null,
};

export const useAppStore = create<AppState>((set, get) => ({
  // ── Settings ────────────────────────────────────────────────────────
  settings: loadPersistedSettings(),
  updateSettings: (partial) => {
    const next = { ...get().settings, ...partial };
    persistSettings(next);
    set({ settings: next });
  },
  resetSettings: () => {
    const fresh = { ...DEFAULT_SETTINGS };
    persistSettings(fresh);
    set({ settings: fresh });
  },

  // ── Job state ───────────────────────────────────────────────────────
  jobId: null,
  phase: 'idle',
  logs: [],
  progress: 0,
  stats: { ...initialStats },

  // ── Preview layers ──────────────────────────────────────────────────
  layers: { ...initialLayers },
  visibleLayers: {
    original: true,
    filtered: false,
    greedy: false,
    merged: false,
    twoopt: false,
    final: true,
  },
  toggleLayer: (layer) =>
    set((s) => ({
      visibleLayers: { ...s.visibleLayers, [layer]: !s.visibleLayers[layer] },
    })),

  // ── Actions ─────────────────────────────────────────────────────────
  setJobId: (id) => set({ jobId: id }),
  setPhase: (phase) => set({ phase }),
  addLog: (msg) => set((s) => ({ logs: [...s.logs, msg] })),
  setOriginalPaths: (paths) =>
    set({
      layers: { ...initialLayers, original: paths },
      phase: 'uploaded',
    }),

  handleWSEvent: (event) => {
    const state = get();
    switch (event.type) {
      case 'log':
        set({ logs: [...state.logs, event.msg] });
        break;

      case 'filter_start':
        set({ phase: 'filtering' });
        break;

      case 'filter_result':
        set({
          stats: {
            ...state.stats,
            filterRemoved: event.removed_count,
            filterKept: event.kept_count,
            removedIndices: event.removed_indices,
          },
        });
        break;

      case 'greedy_result':
        set({
          phase: 'greedy',
          layers: { ...state.layers, greedy: event.paths },
          stats: {
            ...state.stats,
            originalDist: event.original_dist,
            phase1Dist: event.phase1_dist,
            gcodeDist: event.original_dist,
          },
        });
        break;

      case 'merge_result':
        set({
          phase: 'merging',
          layers: { ...state.layers, merged: event.paths },
          stats: {
            ...state.stats,
            mergeCount: event.merge_count,
            phase1Dist: event.post_merge_dist,
          },
        });
        break;

      case 'twoopt_start':
        set({ phase: 'twoopt' });
        break;

      case 'phase2_result':
        set({
          layers: {
            ...state.layers,
            twoopt: event.paths,
            final: event.paths,
          },
          stats: {
            ...state.stats,
            iterations: event.iterations,
            distHistory: event.dist_history,
            finalDist: event.final_dist,
            gcodeDist: event.gcode_dist,
            phase1Dist: event.phase1_dist,
          },
        });
        break;

      case 'complete':
        set({ phase: 'complete' });
        break;

      case 'phase_progress':
        set({ progress: event.progress });
        break;

      case 'error':
        set({ phase: 'error', logs: [...state.logs, `ERROR: ${event.msg}`] });
        break;

      case 'ping':
        // keep-alive, no-op
        break;
    }
  },

  reset: () =>
    set({
      jobId: null,
      phase: 'idle',
      logs: [],
      progress: 0,
      stats: { ...initialStats },
      layers: { ...initialLayers },
    }),
}));
