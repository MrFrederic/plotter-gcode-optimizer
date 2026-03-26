/** Upload, optimize, and download controls. */

import { useCallback, useRef } from 'react';
import { useAppStore } from '../../store';
import { uploadFile, createOptimizationWS, downloadUrl } from '../../api';
import type { WSEvent } from '../../types';

export default function UploadControls() {
  const fileRef = useRef<HTMLInputElement>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const settings = useAppStore((s) => s.settings);
  const phase = useAppStore((s) => s.phase);
  const jobId = useAppStore((s) => s.jobId);
  const setJobId = useAppStore((s) => s.setJobId);
  const setPhase = useAppStore((s) => s.setPhase);
  const addLog = useAppStore((s) => s.addLog);
  const setOriginalPaths = useAppStore((s) => s.setOriginalPaths);
  const handleWSEvent = useAppStore((s) => s.handleWSEvent);
  const reset = useAppStore((s) => s.reset);

  const handleFileSelect = useCallback(async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    reset();
    setPhase('uploading');
    addLog(`Uploading ${file.name}...`);

    try {
      const resp = await uploadFile(file, settings);
      setJobId(resp.job_id);
      setOriginalPaths(resp.paths);
      addLog(`Parsed ${resp.path_count} paths from ${resp.source.toUpperCase()}`);
    } catch (err) {
      addLog(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
      setPhase('error');
    }
  }, [settings, reset, setPhase, addLog, setJobId, setOriginalPaths]);

  const handleOptimize = useCallback(() => {
    if (!jobId) return;
    addLog('Starting optimization...');

    const ws = createOptimizationWS(jobId);
    wsRef.current = ws;

    ws.onmessage = (e) => {
      try {
        const event: WSEvent = JSON.parse(e.data);
        handleWSEvent(event);
      } catch {
        addLog(`Unknown WS message: ${e.data}`);
      }
    };

    ws.onerror = () => {
      addLog('WebSocket error');
      setPhase('error');
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  }, [jobId, addLog, handleWSEvent, setPhase]);

  const canOptimize = phase === 'uploaded';
  const canDownload = phase === 'complete' && jobId;
  const isProcessing = ['filtering', 'greedy', 'merging', 'twoopt'].includes(phase);

  return (
    <div className="controls">
      <input
        ref={fileRef}
        type="file"
        accept=".gcode,.nc,.txt,.svg"
        className="hidden"
        onChange={handleFileSelect}
      />
      <button className="cyber-btn" onClick={() => fileRef.current?.click()}>
        SELECT FILE
      </button>
      <button
        className={`cyber-btn ${!canOptimize ? 'disabled' : ''}`}
        disabled={!canOptimize}
        onClick={handleOptimize}
      >
        {isProcessing ? 'OPTIMIZING...' : 'EXECUTE OPTIMIZATION'}
      </button>
      {canDownload && (
        <a className="cyber-btn" href={downloadUrl(jobId)} download>
          DOWNLOAD RESULT
        </a>
      )}
    </div>
  );
}
