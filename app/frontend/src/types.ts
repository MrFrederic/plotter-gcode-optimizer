/** Shared type definitions matching backend v2 schemas. */

export interface Point {
  x: number;
  y: number;
}

export type PathData = Point[];

export interface OptimizerSettings {
  z_up: number;
  z_down: number;
  feedrate: number;
  travel_speed: number | null;
  z_speed: number | null;
  curve_tolerance: number;
  pen_width: number;
  visibility_threshold: number;
  offset_closed_paths: boolean;
  merge_threshold: number;
  gcode_header: string;
  gcode_footer: string;
}

export const DEFAULT_SETTINGS: OptimizerSettings = {
  z_up: 2.0,
  z_down: 0.0,
  feedrate: 1000,
  travel_speed: 3000,
  z_speed: 500,
  curve_tolerance: 0.1,
  pen_width: 0,
  visibility_threshold: 50,
  offset_closed_paths: false,
  merge_threshold: 0.5,
  gcode_header: 'G28',
  gcode_footer: 'G0 Z5\nG0 X10 Y10\nM84',
};

export interface UploadResponse {
  job_id: string;
  paths: PathData[];
  source: string;
  path_count: number;
  settings: OptimizerSettings;
}

export interface JobStatusResponse {
  job_id: string;
  status: string;
  path_count: number;
  settings: OptimizerSettings;
}

// ── WebSocket event types ────────────────────────────────────────────────────

export interface WSLogEvent {
  type: 'log';
  msg: string;
}

export interface WSFilterStartEvent {
  type: 'filter_start';
  path_count: number;
  pen_width: number;
  visibility_threshold: number;
}

export interface WSFilterResultEvent {
  type: 'filter_result';
  original_count: number;
  removed_count: number;
  kept_count: number;
  removed_indices: number[];
  pen_width: number;
  visibility_threshold: number;
}

export interface WSGreedyResultEvent {
  type: 'greedy_result';
  paths: PathData[];
  progress_history: number[];
  original_dist: number;
  phase1_dist: number;
  path_count: number;
}

export interface WSMergeResultEvent {
  type: 'merge_result';
  paths: PathData[];
  original_count: number;
  merged_count: number;
  merge_count: number;
  post_merge_dist: number;
}

export interface WSTwoOptStartEvent {
  type: 'twoopt_start';
  estimated_paths: number;
}

export interface WSPhase2ResultEvent {
  type: 'phase2_result';
  iterations: number;
  dist_history: number[];
  paths: PathData[];
  original_dist: number;
  gcode_dist: number;
  phase1_dist: number;
  final_dist: number;
}

export interface WSCompleteEvent {
  type: 'complete';
  job_id: string;
}

export interface WSPingEvent {
  type: 'ping';
}

export interface WSPhaseProgressEvent {
  type: 'phase_progress';
  phase: string;
  progress: number;
  detail?: string;
}

export interface WSErrorEvent {
  type: 'error';
  msg: string;
}

export type WSEvent =
  | WSLogEvent
  | WSFilterStartEvent
  | WSFilterResultEvent
  | WSGreedyResultEvent
  | WSMergeResultEvent
  | WSTwoOptStartEvent
  | WSPhase2ResultEvent
  | WSCompleteEvent
  | WSPingEvent
  | WSPhaseProgressEvent
  | WSErrorEvent;

// ── App state types ──────────────────────────────────────────────────────────

export type OptPhase =
  | 'idle'
  | 'uploading'
  | 'uploaded'
  | 'filtering'
  | 'greedy'
  | 'merging'
  | 'twoopt'
  | 'complete'
  | 'error';

export interface PreviewLayers {
  original: PathData[];
  filtered: PathData[] | null;
  greedy: PathData[] | null;
  merged: PathData[] | null;
  twoopt: PathData[] | null;
  final: PathData[] | null;
}
