/**
 * High-performance Canvas-based path preview with layer toggling.
 *
 * Renders paths on a 2D canvas with:
 *  - Viewport transform (auto-fit + centering)
 *  - Per-layer colours and toggling
 *  - High-DPI support (devicePixelRatio)
 *  - Throttled redraws
 */

import { useEffect, useRef, useCallback } from 'react';
import { useAppStore } from '../../store';
import type { PathData, PreviewLayers } from '../../types';

const LAYER_COLORS: Record<keyof PreviewLayers, string> = {
  original: 'rgba(100,100,100,0.35)',
  filtered: 'rgba(255,80,80,0.5)',
  greedy: 'rgba(80,180,255,0.6)',
  merged: 'rgba(80,255,180,0.6)',
  twoopt: 'rgba(255,200,80,0.7)',
  final: 'rgba(255,255,255,0.9)',
};

function getBounds(paths: PathData[]) {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const path of paths) {
    for (const p of path) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

export default function PathPreview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef(0);

  const layers = useAppStore((s) => s.layers);
  const visibleLayers = useAppStore((s) => s.visibleLayers);
  const toggleLayer = useAppStore((s) => s.toggleLayer);
  const phase = useAppStore((s) => s.phase);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clear
    ctx.fillStyle = '#0a0e14';
    ctx.fillRect(0, 0, rect.width, rect.height);

    // Collect all visible paths to compute bounds
    const allPaths: PathData[] = [];
    for (const key of Object.keys(layers) as (keyof PreviewLayers)[]) {
      const data = layers[key];
      if (data && visibleLayers[key]) {
        allPaths.push(...data);
      }
    }
    // Always include original for bounds even if hidden
    if (layers.original.length) allPaths.push(...layers.original);
    if (!allPaths.length) return;

    const bounds = getBounds(allPaths);
    const dataW = bounds.maxX - bounds.minX || 1;
    const dataH = bounds.maxY - bounds.minY || 1;
    const pad = 20;
    const scaleX = (rect.width - pad * 2) / dataW;
    const scaleY = (rect.height - pad * 2) / dataH;
    const scale = Math.min(scaleX, scaleY);
    const offX = (rect.width - dataW * scale) / 2;
    const offY = (rect.height - dataH * scale) / 2;

    const tx = (x: number) => (x - bounds.minX) * scale + offX;
    const ty = (y: number) => (y - bounds.minY) * scale + offY;

    // Draw grid
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 0.5;
    const gridStep = 10;
    for (let gx = Math.floor(bounds.minX / gridStep) * gridStep; gx <= bounds.maxX; gx += gridStep) {
      ctx.beginPath();
      ctx.moveTo(tx(gx), ty(bounds.minY));
      ctx.lineTo(tx(gx), ty(bounds.maxY));
      ctx.stroke();
    }
    for (let gy = Math.floor(bounds.minY / gridStep) * gridStep; gy <= bounds.maxY; gy += gridStep) {
      ctx.beginPath();
      ctx.moveTo(tx(bounds.minX), ty(gy));
      ctx.lineTo(tx(bounds.maxX), ty(gy));
      ctx.stroke();
    }

    // Draw layers in order
    const drawOrder: (keyof PreviewLayers)[] = [
      'original',
      'filtered',
      'greedy',
      'merged',
      'twoopt',
      'final',
    ];

    for (const layerKey of drawOrder) {
      const data = layers[layerKey];
      if (!data || !visibleLayers[layerKey]) continue;

      ctx.strokeStyle = LAYER_COLORS[layerKey];
      ctx.lineWidth = layerKey === 'final' ? 1.5 : 1;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';

      for (const path of data) {
        if (path.length < 2) continue;
        ctx.beginPath();
        const first = path[0];
        if (first) {
          ctx.moveTo(tx(first.x), ty(first.y));
        }
        for (let i = 1; i < path.length; i++) {
          const pt = path[i];
          if (pt) {
            ctx.lineTo(tx(pt.x), ty(pt.y));
          }
        }
        ctx.stroke();
      }
    }

    // Draw travel moves for final layer
    if (visibleLayers.final && layers.final && layers.final.length > 1) {
      ctx.strokeStyle = 'rgba(255,160,50,0.25)';
      ctx.lineWidth = 0.5;
      ctx.setLineDash([4, 4]);
      for (let i = 1; i < layers.final.length; i++) {
        const prevPath = layers.final[i - 1];
        const currPath = layers.final[i];
        if (prevPath && currPath && prevPath.length > 0 && currPath.length > 0) {
          const prevEnd = prevPath[prevPath.length - 1];
          const currStart = currPath[0];
          if (prevEnd && currStart) {
            ctx.beginPath();
            ctx.moveTo(tx(prevEnd.x), ty(prevEnd.y));
            ctx.lineTo(tx(currStart.x), ty(currStart.y));
            ctx.stroke();
          }
        }
      }
      ctx.setLineDash([]);
    }
  }, [layers, visibleLayers]);

  // Throttled redraw via requestAnimationFrame
  useEffect(() => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frameRef.current);
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frameRef.current);
      frameRef.current = requestAnimationFrame(draw);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  const availableLayers = (Object.keys(layers) as (keyof PreviewLayers)[]).filter(
    (k) => layers[k] !== null && (Array.isArray(layers[k]) ? layers[k].length > 0 : false),
  );

  return (
    <div className="path-preview-container">
      <div className="panel-header">TOOLPATH VISUALIZATION</div>
      <div className="canvas-container" ref={containerRef}>
        <canvas ref={canvasRef} />
      </div>
      {availableLayers.length > 1 && (
        <div className="layer-toggles">
          {availableLayers.map((key) => (
            <label key={key} className="layer-toggle" style={{ color: LAYER_COLORS[key] }}>
              <input
                type="checkbox"
                checked={visibleLayers[key]}
                onChange={() => toggleLayer(key)}
              />
              {key.toUpperCase()}
            </label>
          ))}
        </div>
      )}
      {phase !== 'idle' && (
        <div className="overlay-stats" id="stats">
          <StatsOverlay />
        </div>
      )}
    </div>
  );
}

function StatsOverlay() {
  const phase = useAppStore((s) => s.phase);
  const stats = useAppStore((s) => s.stats);
  const layers = useAppStore((s) => s.layers);

  const pathCount = layers.final?.length ?? layers.original.length;
  const timeSaved =
    stats.gcodeDist > 0
      ? (((stats.gcodeDist - stats.finalDist) / stats.gcodeDist) * 100).toFixed(1)
      : '---';

  return (
    <>
      <div className="stat-row">
        PHASE: <span className="highlight">{phase.toUpperCase()}</span>
      </div>
      <div className="stat-row">PATHS: {pathCount}</div>
      {stats.gcodeDist > 0 && (
        <>
          <div className="stat-divider" />
          <div className="stat-row">ORIGINAL: {stats.gcodeDist.toFixed(1)}mm</div>
          <div className="stat-row">CURRENT: {stats.finalDist.toFixed(1)}mm</div>
          <div className="stat-row">
            SAVED: <span className="highlight">{timeSaved}%</span>
          </div>
          {stats.iterations > 0 && (
            <div className="stat-row">2-OPT ITERS: {stats.iterations}</div>
          )}
        </>
      )}
    </>
  );
}
