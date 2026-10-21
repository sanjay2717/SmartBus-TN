// src/App.jsx
import { useEffect, useMemo, useState } from 'react';
import { useLenis } from './hooks/useLenis.js';
import { useBusSocket } from './hooks/useBusSocket.js';
import { CONFIG, statusFor } from './config.js';

import Header from './components/Header.jsx';
import StatusBanner from './components/StatusBanner.jsx';
import RouteMap from './components/RouteMap.jsx';
import OccupancyKPI from './components/OccupancyKPI.jsx';
import Counters from './components/Counters.jsx';
import CameraPanel from './components/CameraPanel.jsx';
import DemoMode from './components/DemoMode.jsx';
import Footer from './components/Footer.jsx';

const DEMO_INITIAL = {
  active: false,
  manual: false,
  boarded: 0,
  alighted: 0,
  occupancy: 0,
};

export default function App() {
  // Step 6 — Lenis smooth scrolling
  useLenis();

  // Step 7 — WebSocket data
  const { data, connected, stale } = useBusSocket();

  // Demo state
  const [demo, setDemo] = useState(DEMO_INITIAL);

  // Keyboard shortcut: Shift + D
  useEffect(() => {
    function onKey(e) {
      if (e.shiftKey && e.key === 'D') {
        setDemo((d) => ({ ...d, active: !d.active }));
      }
    }
    function onCustom() {
      setDemo((d) => ({ ...d, active: !d.active }));
    }
    window.addEventListener('keydown', onKey);
    window.addEventListener('smartbus:toggledemo', onCustom);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('smartbus:toggledemo', onCustom);
    };
  }, []);

  // Step 9 — Compute `view` — never recomputes live fields
  const view = useMemo(() => {
    if (!demo.active) {
      return { ...data, mode: 'LIVE' };
    }
    // Demo / simulation path
    const capacity = CONFIG.DEFAULT_CAPACITY;
    const occupancy = demo.occupancy;
    const boarded = demo.boarded;
    const alighted = demo.alighted;
    const percent = capacity > 0 ? Math.round((occupancy / capacity) * 100) : 0;
    const status = statusFor(occupancy, capacity);
    return {
      boarded,
      alighted,
      occupancy,
      capacity,
      percent,
      status,
      camera_ok: false,
      timestamp: 0,
      mode: 'SIMULATION',
    };
  }, [demo, data]);

  function closeDemo() {
    setDemo((d) => ({ ...d, active: false }));
  }

  return (
    <div className="app">
      <Header connected={connected} stale={stale} />
      <StatusBanner status={view.status} />

      <main className="grid" id="main-content">
        <RouteMap />
        <OccupancyKPI
          occupancy={view.occupancy}
          capacity={view.capacity}
          percent={view.percent}
          status={view.status}
          mode={view.mode}
        />
        <Counters
          boarded={view.boarded}
          alighted={view.alighted}
          mode={view.mode}
        />
        <CameraPanel
          camera_ok={view.camera_ok}
          stale={stale}
          mode={view.mode}
        />
      </main>

      <Footer />

      <DemoMode
        demo={demo}
        setDemo={setDemo}
        onClose={closeDemo}
      />
    </div>
  );
}
