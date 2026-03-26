import { useState } from 'react';
import { Terminal, StatusBar } from './components';
import { SettingsPanel } from './features/settings';
import { PathPreview } from './features/path-preview';
import { UploadControls } from './features/upload';

export default function App() {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <>
      <div className="scanline" />
      <div className="container">
        <header>
          <h1>SYS.OP // MFCORP PLOTTERTOOL_V2.5</h1>
          <StatusBar onSettingsClick={() => setShowSettings(true)} />
        </header>

        {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}

        <main>
          <div className="panel left-panel">
            <div className="panel-header">TERMINAL OUTPUT</div>
            <Terminal />
            <UploadControls />
          </div>

          <div className="panel right-panel">
            <PathPreview />
          </div>
        </main>
      </div>
    </>
  );
}
