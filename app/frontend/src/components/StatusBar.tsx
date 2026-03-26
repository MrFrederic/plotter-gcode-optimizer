/** Status bar with phase indicator. */

import { useAppStore } from '../store';

export default function StatusBar({
  onSettingsClick,
}: {
  onSettingsClick: () => void;
}) {
  const phase = useAppStore((s) => s.phase);

  const statusMap: Record<string, string> = {
    idle: 'STATUS: IDLE',
    uploading: 'STATUS: UPLOADING...',
    uploaded: 'STATUS: FILE LOADED',
    filtering: 'STATUS: LINE FILTER ACTIVE',
    greedy: 'STATUS: GREEDY SORT',
    merging: 'STATUS: MERGING PATHS',
    twoopt: 'STATUS: 2-OPT REFINEMENT',
    complete: 'STATUS: OPTIMIZATION COMPLETE',
    error: 'STATUS: ERROR',
  };

  const dotClass =
    phase === 'complete'
      ? 'status-indicator complete'
      : ['filtering', 'greedy', 'merging', 'twoopt', 'uploading'].includes(phase)
        ? 'status-indicator active'
        : phase === 'error'
          ? 'status-indicator error'
          : 'status-indicator';

  return (
    <div className="status-bar">
      <div className={dotClass} />
      <span>{statusMap[phase] ?? 'STATUS: UNKNOWN'}</span>
      <span className="blinking-cursor">_</span>
      <button className="cyber-btn-icon" title="Settings" onClick={onSettingsClick}>
        ⚙
      </button>
    </div>
  );
}
