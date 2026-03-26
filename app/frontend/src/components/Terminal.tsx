/** Terminal log output component. */

import { useEffect, useRef } from 'react';
import { useAppStore } from '../store';

export default function Terminal() {
  const logs = useAppStore((s) => s.logs);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="terminal" id="terminal">
      {logs.length === 0 && <div>&gt; SYSTEM READY. AWAITING INPUT...</div>}
      {logs.map((msg, i) => (
        <div key={i}>&gt; {msg}</div>
      ))}
      <div ref={bottomRef} />
    </div>
  );
}
