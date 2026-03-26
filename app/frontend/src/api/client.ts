/** API client for v2 endpoints. */

import type { UploadResponse, OptimizerSettings, JobStatusResponse } from '../types';

function apiBase(): string {
  // In dev the Vite proxy forwards /api/v2 to the backend.
  // In production the FastAPI serves both SPA and API.
  return '/api/v2';
}

export async function uploadFile(
  file: File,
  settings: OptimizerSettings,
): Promise<UploadResponse> {
  const form = new FormData();
  form.append('file', file);
  form.append('settings', JSON.stringify(settings));

  const endpoint = file.name.endsWith('.svg') ? '/upload-svg' : '/upload';
  const res = await fetch(`${apiBase()}${endpoint}`, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail ?? `Upload failed (${res.status})`);
  }
  return res.json();
}

export async function getJob(jobId: string): Promise<JobStatusResponse> {
  const res = await fetch(`${apiBase()}/job/${jobId}`);
  if (!res.ok) throw new Error(`Job not found (${res.status})`);
  return res.json();
}

export function downloadUrl(jobId: string): string {
  return `${apiBase()}/download/${jobId}`;
}

export async function getSettingsSchema(): Promise<Record<string, unknown>> {
  const res = await fetch(`${apiBase()}/settings/schema`);
  if (!res.ok) throw new Error('Failed to fetch settings schema');
  return res.json();
}

/** Create a WebSocket connection to the v2 optimization endpoint. */
export function createOptimizationWS(jobId: string): WebSocket {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const base = `${proto}://${window.location.host}`;
  return new WebSocket(`${base}${apiBase()}/ws/${jobId}`);
}
