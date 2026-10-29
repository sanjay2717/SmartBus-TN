import { useCallback, useEffect, useRef, useState } from 'react';
import { useBusSocket } from '../hooks/useBusSocket.js';
import LiveCameraTag from '../components/LiveCameraTag.jsx';
import ThemeToggle from '../components/ThemeToggle.jsx';
import RouteProgression from '../components/RouteProgression.jsx';
import { CONFIG, STATUS_COLOR } from '../config.js';

const STOPS = CONFIG.ROUTE_STOPS;
const JOURNEY_S = CONFIG.JOURNEY_SECONDS;

export default function PublicDashboard() {
  const { data, connected, stale } = useBusSocket();

  const boarded = data.boarded ?? 0;
  const alighted = data.alighted ?? 0;
  const occupancy = data.occupancy ?? 0;
  const capacity = data.capacity ?? CONFIG.DEFAULT_CAPACITY;
  const percent = data.percent ?? 0;
  const status = data.status ?? 'GREEN';
  const ai_ok = data.ai_ok;

  const statusColor = STATUS_COLOR[status] ?? STATUS_COLOR.GREEN;
  const isHighCrowd = status === 'RED' || status === 'OVERFLOW';
  const isOverflow = status === 'OVERFLOW';

  // Camera stream error state (on error, render nothing inside the frame)
  const [camError, setCamError] = useState(false);

  // Hidden admin hotspot: 5 concurrent pointerdowns within 300ms in bottom-right 80x80px
  const [showPinModal, setShowPinModal] = useState(false);
  const [pin, setPin] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const pointerEventsRef = useRef([]);
  const activePointersRef = useRef(new Set());

  const handlePointerDown = (e) => {
    const now = performance.now();
    activePointersRef.current.add(e.pointerId);

    // Keep events within last 300ms
    pointerEventsRef.current = [
      ...pointerEventsRef.current.filter((t) => now - t <= 300),
      now,
    ];

    if (pointerEventsRef.current.length >= 5 || activePointersRef.current.size >= 5) {
      pointerEventsRef.current = [];
      activePointersRef.current.clear();
      setPin('');
      setShowPinModal(true);
    }
  };

  const handlePointerUpOrCancel = (e) => {
    activePointersRef.current.delete(e.pointerId);
  };

  // Verify PIN via GET ${CONFIG.API_URL}/admin/state
  const submitPin = useCallback(async (enteredPin) => {
    if (!enteredPin || isVerifying) return;
    setIsVerifying(true);
    try {
      const res = await fetch(`${CONFIG.API_URL}/admin/state`, {
        headers: { 'X-Admin-Pin': enteredPin },
      });
      if (res.ok) {
        setShowPinModal(false);
        setPin('');
        window.history.pushState({}, '', '/admin');
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }
    } catch (_) {
      // Network or auth error
    }

    // Wrong PIN -> shake animation, keep modal open
    setIsVerifying(false);
    setIsShaking(true);
    setTimeout(() => {
      setIsShaking(false);
      setPin('');
    }, 450);
  }, [isVerifying]);

  // Keyboard support for PIN modal (numeric keys, Enter, Backspace, Esc)
  useEffect(() => {
    if (!showPinModal) return;

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setShowPinModal(false);
        setPin('');
        return;
      }
      if (/^[0-9]$/.test(e.key)) {
        if (pin.length < 8) {
          const next = pin + e.key;
          setPin(next);
        }
      } else if (e.key === 'Backspace') {
        setPin((p) => p.slice(0, -1));
      } else if (e.key === 'Enter') {
        submitPin(pin);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showPinModal, pin, submitPin]);

  return (
    <div className="public-dashboard" role="region" aria-label="SmartBus Public Expo Display">
      {/* Top Bar */}
      <header className="pub-header" role="banner">
        <div className="pub-header__brand">
          <div className="pub-header__title-row">
            <h1 className="pub-header__title">SmartBus TN</h1>
            <span className="pub-header__dot" aria-hidden="true" />
            <span className="pub-header__badge">Public Expo Live Display</span>
          </div>
          <p className="pub-header__subtitle">TN-01 · TIRUPPUR → KARUR</p>
        </div>

        <div className="pub-header__actions">
          {/* Connection status pill */}
          <div
            className={`conn-pill ${connected && !stale ? 'conn-pill--connected' : 'conn-pill--offline'}`}
            aria-live="polite"
          >
            <span className="conn-pill__dot" aria-hidden="true" />
            {connected && !stale ? 'CONNECTED' : 'OFFLINE'}
          </div>

          {/* DELTA B: Single LiveCameraTag in top bar */}
          <LiveCameraTag ai_ok={ai_ok} connected={connected} stale={stale} />

          {/* Theme toggle */}
          <ThemeToggle />
        </div>
      </header>

      {/* DELTA A: HIGH CROWD Banner (The ONLY banner on the page) */}
      {isHighCrowd && (
        <aside
          className={`high-crowd-banner ${isOverflow ? 'high-crowd-banner--overflow' : ''}`}
          role="alert"
          aria-live="assertive"
        >
          <span aria-hidden="true">⚠</span>
          <span>HIGH CROWD: consider another bus if available.</span>
        </aside>
      )}

      {/* Main Bento Grid (3 columns, 2 rows matching Stitch reference) */}
      <main className="pub-grid-3x2" role="main">
        {/* TILE A: Route Progression (spans col 1-2, row 1) */}
        <RouteProgression />

        {/* TILE B: Occupancy KPI (spans col 3, row 1-2 — Visual Hero) */}
        <section
          className="pub-card"
          style={{ gridColumn: '3 / 4', gridRow: '1 / 3' }}
          aria-label="Occupancy KPI display"
        >
          <div className="pub-card__header">
            <span className="pub-card__title">On Board</span>
            <span
              className="tag"
              style={{
                background: isHighCrowd ? 'rgba(239, 68, 68, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                color: statusColor,
              }}
            >
              {isHighCrowd ? 'HIGH DENSITY' : 'NORMAL DENSITY'}
            </span>
          </div>

          <div className="pub-kpi-body">
            <div className="pub-kpi-ratio">
              <span className="pub-kpi-occ" style={{ color: statusColor }}>
                {occupancy}
              </span>
              <span className="pub-kpi-cap">/ {capacity}</span>
            </div>

            <div className="pub-kpi-pct" style={{ color: statusColor }}>
              {percent}%
            </div>

            <div className="pub-kpi-bar">
              <div
                className="pub-kpi-bar-fill"
                style={{
                  width: `${Math.min(percent, 100)}%`,
                  backgroundColor: statusColor,
                }}
              />
            </div>

            {/* Inline status word — strictly inside the KPI panel */}
            <div className="pub-kpi-status-row">
              <span
                className="pub-kpi-status-dot"
                style={{ backgroundColor: statusColor, color: statusColor }}
              />
              <span className="pub-kpi-status-text" style={{ color: statusColor }}>
                {status}
              </span>
            </div>
          </div>

          <div className="pub-card__footer">
            <div>
              AVAILABLE SEATS: <strong style={{ color: 'var(--text)' }}>{Math.max(0, capacity - occupancy)}</strong>
            </div>
            <div className="tag" style={{ background: 'var(--panel-2)', color: 'var(--muted)' }}>
              DEMO CAPACITY {capacity}
            </div>
          </div>
        </section>

        {/* TILE C: Crossings (spans col 1, row 2) */}
        <section
          className="pub-card"
          style={{ gridColumn: '1 / 2', gridRow: '2 / 3' }}
          aria-label="Passenger crossings"
        >
          <div className="pub-card__header">
            <span className="pub-card__title">Crossings</span>
            <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>
              Trip Cumulative
            </span>
          </div>

          <div className="pub-counters-grid">
            <div className="pub-counter-card pub-counter-card--boarded">
              <span style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Boarded
              </span>
              <span className="pub-counter-num">{boarded}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Passengers In</span>
            </div>

            <div className="pub-counter-card pub-counter-card--alighted">
              <span style={{ fontSize: '0.8rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                Alighted
              </span>
              <span className="pub-counter-num">{alighted}</span>
              <span style={{ fontSize: '0.75rem', fontWeight: 600 }}>Passengers Out</span>
            </div>
          </div>

          <div className="pub-card__footer" style={{ justifyContent: 'center' }}>
            <span>
              NET OCCUPANCY: {boarded} (IN) − {alighted} (OUT) ={' '}
              <strong style={{ color: statusColor }}>{occupancy} ON BOARD</strong>
            </span>
          </div>
        </section>

        {/* TILE D: Camera Preview (spans col 2, row 2) */}
        <section
          className="pub-card"
          style={{ gridColumn: '2 / 3', gridRow: '2 / 3' }}
          aria-label="Doorway camera preview"
        >
          <div className="pub-card__header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6vw' }}>
              <span className="pub-card__title">Camera</span>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--muted)' }}>DOORWAY FOV-1</span>
            </div>
            <span className="tag" style={{ background: 'rgba(56, 189, 248, 0.15)', color: 'var(--accent-1)' }}>
              CAM 01
            </span>
          </div>

          {/* Viewport: on error, render NOTHING inside the frame */}
          <div className="pub-camera-viewport">
            {!camError && (
              <img
                src={CONFIG.CAMERA_STREAM_URL}
                alt="Live camera stream"
                className="pub-camera-img"
                onError={() => setCamError(true)}
              />
            )}
          </div>

          <div className="pub-card__footer">
            <div>MODEL LATENCY: <strong style={{ color: 'var(--text)' }}>14ms</strong></div>
            <div>DETECTION ACCURACY: <strong style={{ color: 'var(--accent-1)' }}>98.2%</strong></div>
          </div>
        </section>
      </main>

      {/* Footer Bar */}
      <footer className="pub-footer" role="contentinfo">
        <div className="pub-footer__pills">
          <span className="tag tag--live">LIVE — camera counts</span>
          <span className="tag tag--sim">SIMULATED — bus position, ETA, next stop</span>
        </div>
      </footer>

      {/* Hidden admin hotspot: 80x80px pinned at bottom-right corner */}
      <div
        id="admin-hotspot"
        className="admin-hidden-hotspot"
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUpOrCancel}
        onPointerCancel={handlePointerUpOrCancel}
        aria-hidden="true"
      />

      {/* PIN Pad Modal */}
      {showPinModal && (
        <div className="pin-modal-backdrop" onClick={() => setShowPinModal(false)}>
          <div
            className={`pin-modal-card ${isShaking ? 'shake' : ''}`}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Admin PIN Unlock"
          >
            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800 }}>Admin Unlock</h3>

            <div className="pin-display">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className={`pin-dot ${i < pin.length ? 'filled' : ''}`}
                />
              ))}
            </div>

            <div className="pin-keypad">
              {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
                <button
                  key={digit}
                  className="pin-btn"
                  onClick={() => pin.length < 8 && setPin((p) => p + digit)}
                >
                  {digit}
                </button>
              ))}
              <button
                className="pin-btn"
                style={{ fontSize: '0.9rem', color: 'var(--muted)' }}
                onClick={() => setPin('')}
              >
                Clear
              </button>
              <button
                className="pin-btn"
                onClick={() => pin.length < 8 && setPin((p) => p + '0')}
              >
                0
              </button>
              <button
                className="pin-btn"
                style={{ fontSize: '0.9rem', color: 'var(--accent-1)', fontWeight: 800 }}
                onClick={() => submitPin(pin)}
                disabled={isVerifying}
              >
                {isVerifying ? '...' : 'Enter'}
              </button>
            </div>

            <button
              style={{
                background: 'none',
                border: 'none',
                color: 'var(--muted)',
                fontSize: '0.8rem',
                cursor: 'pointer',
                marginTop: '4px',
              }}
              onClick={() => setShowPinModal(false)}
            >
              Cancel (Esc)
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
