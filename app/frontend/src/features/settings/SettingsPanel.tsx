/** Settings panel – schema-driven, debounced inputs, optimistic UI. */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store';
import type { OptimizerSettings } from '../../types';

function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  }) as unknown as T;
}

interface SettingsRowProps {
  label: string;
  title?: string;
  children: React.ReactNode;
}

function SettingsRow({ label, title, children }: SettingsRowProps) {
  return (
    <div className="settings-row" title={title}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export default function SettingsPanel({ onClose }: { onClose: () => void }) {
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const resetSettings = useAppStore((s) => s.resetSettings);

  // Local copy for optimistic updates
  const [local, setLocal] = useState<OptimizerSettings>({ ...settings });
  const commitRef = useRef(
    debounce((partial: Partial<OptimizerSettings>) => {
      updateSettings(partial);
    }, 300),
  );

  // Sync if store changes externally
  useEffect(() => {
    setLocal({ ...settings });
  }, [settings]);

  const change = useCallback(
    <K extends keyof OptimizerSettings>(key: K, value: OptimizerSettings[K]) => {
      setLocal((prev) => ({ ...prev, [key]: value }));
      commitRef.current({ [key]: value });
    },
    [],
  );

  const handleReset = () => {
    resetSettings();
    setLocal({ ...settings });
    onClose();
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          PLOTTERTOOL SETTINGS
          <button className="cyber-btn-icon" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="settings-body">
          <div className="settings-group">
            <div className="settings-label">PEN CONTROL</div>
            <SettingsRow label="Z UP (mm)">
              <input
                type="number"
                step="0.1"
                className="cyber-input"
                value={local.z_up}
                onChange={(e) => change('z_up', parseFloat(e.target.value) || 0)}
              />
            </SettingsRow>
            <SettingsRow label="Z DOWN (mm)">
              <input
                type="number"
                step="0.1"
                className="cyber-input"
                value={local.z_down}
                onChange={(e) => change('z_down', parseFloat(e.target.value) || 0)}
              />
            </SettingsRow>
          </div>

          <div className="settings-group">
            <div className="settings-label">PEN FILTER</div>
            <SettingsRow label="PEN WIDTH (mm)" title="Pen tip diameter. 0 disables overlap filter.">
              <input
                type="number"
                step="0.1"
                min="0"
                className="cyber-input"
                value={local.pen_width}
                onChange={(e) => change('pen_width', parseFloat(e.target.value) || 0)}
              />
            </SettingsRow>
            <SettingsRow label="MIN VISIBILITY (%)" title="Min visible % to keep line.">
              <input
                type="number"
                step="5"
                min="0"
                max="100"
                className="cyber-input"
                value={local.visibility_threshold}
                onChange={(e) => change('visibility_threshold', parseFloat(e.target.value) || 0)}
              />
            </SettingsRow>
            <SettingsRow label="OFFSET CLOSED PATHS">
              <input
                type="checkbox"
                className="cyber-checkbox"
                checked={local.offset_closed_paths}
                onChange={(e) => change('offset_closed_paths', e.target.checked)}
              />
            </SettingsRow>
          </div>

          <div className="settings-group">
            <div className="settings-label">PATH MERGING</div>
            <SettingsRow label="MERGE THRESHOLD (mm)">
              <input
                type="number"
                step="0.1"
                min="0"
                max="10"
                className="cyber-input"
                value={local.merge_threshold}
                onChange={(e) => change('merge_threshold', parseFloat(e.target.value) || 0)}
              />
            </SettingsRow>
          </div>

          <div className="settings-group">
            <div className="settings-label">SPEED</div>
            <SettingsRow label="DRAW SPEED (mm/min)">
              <input
                type="number"
                step="100"
                min="1"
                className="cyber-input"
                value={local.feedrate}
                onChange={(e) => change('feedrate', parseFloat(e.target.value) || 1000)}
              />
            </SettingsRow>
            <SettingsRow label="TRAVEL SPEED (mm/min)">
              <input
                type="number"
                step="100"
                min="1"
                className="cyber-input"
                value={local.travel_speed ?? ''}
                placeholder="Optional"
                onChange={(e) =>
                  change(
                    'travel_speed',
                    e.target.value ? parseFloat(e.target.value) : null,
                  )
                }
              />
            </SettingsRow>
            <SettingsRow label="Z SPEED (mm/min)">
              <input
                type="number"
                step="50"
                min="1"
                className="cyber-input"
                value={local.z_speed ?? ''}
                placeholder="Optional"
                onChange={(e) =>
                  change('z_speed', e.target.value ? parseFloat(e.target.value) : null)
                }
              />
            </SettingsRow>
          </div>

          <div className="settings-group">
            <div className="settings-label">SVG</div>
            <SettingsRow label="CURVE TOLERANCE (mm)">
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="1.0"
                className="cyber-input"
                value={local.curve_tolerance}
                onChange={(e) => change('curve_tolerance', parseFloat(e.target.value) || 0.1)}
              />
            </SettingsRow>
          </div>

          <div className="settings-group">
            <div className="settings-label">G-CODE</div>
            <div className="settings-row settings-row-vertical">
              <label>HEADER COMMANDS</label>
              <textarea
                rows={2}
                className="cyber-textarea"
                value={local.gcode_header}
                onChange={(e) => change('gcode_header', e.target.value)}
              />
            </div>
            <div className="settings-row settings-row-vertical">
              <label>FOOTER COMMANDS</label>
              <textarea
                rows={3}
                className="cyber-textarea"
                value={local.gcode_footer}
                onChange={(e) => change('gcode_footer', e.target.value)}
              />
            </div>
          </div>

          <div className="settings-actions">
            <button className="cyber-btn" onClick={() => onClose()}>
              DONE
            </button>
            <button className="cyber-btn" onClick={handleReset}>
              RESET DEFAULTS
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
