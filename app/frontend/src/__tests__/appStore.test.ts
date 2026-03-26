/**
 * Unit tests for the Zustand app store and WebSocket event reducers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../store/appStore';
import { DEFAULT_SETTINGS } from '../types';
import type { WSEvent } from '../types';

function resetStore() {
  useAppStore.setState({
    settings: { ...DEFAULT_SETTINGS },
    jobId: null,
    phase: 'idle',
    logs: [],
    progress: 0,
    stats: {
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
    },
    layers: {
      original: [],
      filtered: null,
      greedy: null,
      merged: null,
      twoopt: null,
      final: null,
    },
  });
}

describe('AppStore', () => {
  beforeEach(() => {
    resetStore();
  });

  describe('settings', () => {
    it('has correct default settings', () => {
      const state = useAppStore.getState();
      expect(state.settings.z_up).toBe(2.0);
      expect(state.settings.feedrate).toBe(1000);
      expect(state.settings.pen_width).toBe(0);
    });

    it('updates settings partially', () => {
      useAppStore.getState().updateSettings({ z_up: 5.0 });
      expect(useAppStore.getState().settings.z_up).toBe(5.0);
      expect(useAppStore.getState().settings.feedrate).toBe(1000);
    });

    it('resets settings to defaults', () => {
      useAppStore.getState().updateSettings({ z_up: 99 });
      useAppStore.getState().resetSettings();
      expect(useAppStore.getState().settings.z_up).toBe(2.0);
    });
  });

  describe('job state', () => {
    it('starts in idle phase', () => {
      expect(useAppStore.getState().phase).toBe('idle');
    });

    it('sets job id', () => {
      useAppStore.getState().setJobId('test-123');
      expect(useAppStore.getState().jobId).toBe('test-123');
    });

    it('adds logs', () => {
      useAppStore.getState().addLog('Hello');
      useAppStore.getState().addLog('World');
      expect(useAppStore.getState().logs).toEqual(['Hello', 'World']);
    });

    it('sets original paths and transitions to uploaded', () => {
      const paths = [[{ x: 0, y: 0 }, { x: 10, y: 10 }]];
      useAppStore.getState().setOriginalPaths(paths);
      expect(useAppStore.getState().phase).toBe('uploaded');
      expect(useAppStore.getState().layers.original).toEqual(paths);
    });

    it('reset clears state', () => {
      useAppStore.getState().setJobId('id');
      useAppStore.getState().addLog('msg');
      useAppStore.getState().reset();
      expect(useAppStore.getState().jobId).toBeNull();
      expect(useAppStore.getState().logs).toEqual([]);
      expect(useAppStore.getState().phase).toBe('idle');
    });
  });

  describe('handleWSEvent', () => {
    it('handles log events', () => {
      const event: WSEvent = { type: 'log', msg: 'Test message' };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().logs).toContain('Test message');
    });

    it('handles filter_start', () => {
      const event: WSEvent = { type: 'filter_start', path_count: 10, pen_width: 0.5, visibility_threshold: 50 };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().phase).toBe('filtering');
    });

    it('handles filter_result', () => {
      const event: WSEvent = {
        type: 'filter_result',
        original_count: 10,
        removed_count: 3,
        kept_count: 7,
        removed_indices: [1, 5, 8],
        pen_width: 0.5,
        visibility_threshold: 50,
      };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().stats.filterRemoved).toBe(3);
      expect(useAppStore.getState().stats.filterKept).toBe(7);
      expect(useAppStore.getState().stats.removedIndices).toEqual([1, 5, 8]);
    });

    it('handles greedy_result', () => {
      const paths = [[{ x: 0, y: 0 }, { x: 5, y: 5 }]];
      const event: WSEvent = {
        type: 'greedy_result',
        paths,
        progress_history: [100, 80, 60],
        original_dist: 200,
        phase1_dist: 100,
        path_count: 1,
      };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().phase).toBe('greedy');
      expect(useAppStore.getState().layers.greedy).toEqual(paths);
      expect(useAppStore.getState().stats.originalDist).toBe(200);
      expect(useAppStore.getState().stats.phase1Dist).toBe(100);
    });

    it('handles twoopt_start', () => {
      const event: WSEvent = { type: 'twoopt_start', estimated_paths: 50 };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().phase).toBe('twoopt');
    });

    it('handles phase2_result', () => {
      const paths = [[{ x: 0, y: 0 }, { x: 1, y: 1 }]];
      const event: WSEvent = {
        type: 'phase2_result',
        iterations: 500,
        dist_history: [100, 90, 80],
        paths,
        original_dist: 100,
        gcode_dist: 200,
        phase1_dist: 100,
        final_dist: 80,
      };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().layers.final).toEqual(paths);
      expect(useAppStore.getState().stats.iterations).toBe(500);
      expect(useAppStore.getState().stats.finalDist).toBe(80);
    });

    it('handles complete', () => {
      const event: WSEvent = { type: 'complete', job_id: 'abc' };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().phase).toBe('complete');
    });

    it('handles error', () => {
      const event: WSEvent = { type: 'error', msg: 'Something failed' };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().phase).toBe('error');
      expect(useAppStore.getState().logs).toContain('ERROR: Something failed');
    });

    it('handles ping (no-op)', () => {
      const prevState = useAppStore.getState().phase;
      useAppStore.getState().handleWSEvent({ type: 'ping' });
      expect(useAppStore.getState().phase).toBe(prevState);
    });

    it('handles phase_progress', () => {
      const event: WSEvent = { type: 'phase_progress', phase: 'greedy', progress: 42 };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().progress).toBe(42);
    });

    it('handles merge_result', () => {
      const paths = [[{ x: 0, y: 0 }, { x: 1, y: 1 }]];
      const event: WSEvent = {
        type: 'merge_result',
        paths,
        original_count: 10,
        merged_count: 8,
        merge_count: 2,
        post_merge_dist: 50,
      };
      useAppStore.getState().handleWSEvent(event);
      expect(useAppStore.getState().phase).toBe('merging');
      expect(useAppStore.getState().layers.merged).toEqual(paths);
      expect(useAppStore.getState().stats.mergeCount).toBe(2);
    });
  });

  describe('layer toggling', () => {
    it('toggles layer visibility', () => {
      expect(useAppStore.getState().visibleLayers.original).toBe(true);
      useAppStore.getState().toggleLayer('original');
      expect(useAppStore.getState().visibleLayers.original).toBe(false);
      useAppStore.getState().toggleLayer('original');
      expect(useAppStore.getState().visibleLayers.original).toBe(true);
    });
  });
});
