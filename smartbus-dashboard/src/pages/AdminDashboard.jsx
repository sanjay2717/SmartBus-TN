import { useCallback, useEffect, useRef, useState } from 'react';
import { useBusSocket } from '../hooks/useBusSocket.js';
import ThemeToggle from '../components/ThemeToggle.jsx';
import { CONFIG, STATUS_COLOR } from '../config.js';

export default function AdminDashboard() {
  // STEP 1 — PIN gate authentication state
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return sessionStorage.getItem('sb-admin-unlocked') === '1';
  });

  const [pinInput, setPinInput] = useState('');
  const [isShaking, setIsShaking] = useState(false);
  const [isSubmittingPin, setIsSubmittingPin] = useState(false);
  const pinRef = useRef(window.__sb_admin_pin || '4821');

  // WebSocket Live Data
  const { data, connected, stale } = useBusSocket();

  // Optimistic pending state
  const [pendingOcc, setPendingOcc] = useState(null);

  // Clear pending whenever fresh WebSocket data arrives
  useEffect(() => {
    setPendingOcc(null);
  }, [data]);

  const occupancy = pendingOcc !== null ? pendingOcc : (data.occupancy ?? 0);
  const capacity = data.capacity ?? CONFIG.DEFAULT_CAPACITY;
  const percent = capacity > 0 ? Math.round((occupancy / capacity) * 100) : 0;
  const status = data.status ?? 'GREEN';
  const statusColor = STATUS_COLOR[status] ?? STATUS_COLOR.GREEN;

  // STEP 3 — Telemetry (FPS, active tracks, camera status, last message timer)
  const liveTelemetry = connected && !stale;
  const shownFps = liveTelemetry ? (data.fps ?? 0) : 0;
  const shownTracks = liveTelemetry ? (data.active_tracks ?? 0) : 0;
  const shownCameraOk = liveTelemetry ? Boolean(data.camera_ok) : false;

  const [nowTs, setNowTs] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const lastMsgAgo = data.timestamp
    ? `${Math.max(0, Math.round((nowTs - (data.timestamp > 1e11 ? data.timestamp : data.timestamp * 1000)) / 1000))}s ago`
    : '0s ago';

  // STEP 4 — Event log state
  const [events, setEvents] = useState([]);

  const fetchLog = useCallback(async () => {
    try {
      const res = await fetch(`${CONFIG.API_URL}/admin/log?limit=20`, {
        headers: { 'X-Admin-Pin': pinRef.current },
      });
      if (res.status === 401) {
        sessionStorage.removeItem('sb-admin-unlocked');
        setIsUnlocked(false);
        return;
      }
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          setEvents(list.slice(0, 20));
        }
      }
    } catch (_) {
      // Ignore network errors gracefully
    }
  }, []);

  // Fetch log on mount and on every WS message
  useEffect(() => {
    if (isUnlocked) {
      fetchLog();
    }
  }, [isUnlocked, data, fetchLog]);

  // Handle PIN verification
  const handlePinSubmit = async (val) => {
    if (!val || isSubmittingPin) return;
    setIsSubmittingPin(true);
    try {
      const res = await fetch(`${CONFIG.API_URL}/admin/state`, {
        headers: { 'X-Admin-Pin': val },
      });
      if (res.ok) {
        pinRef.current = val;
        window.__sb_admin_pin = val;
        sessionStorage.setItem('sb-admin-unlocked', '1');
        setIsUnlocked(true);
        setIsSubmittingPin(false);
        return;
      }
    } catch (_) {
      // Network failure
    }

    // 401 or error -> shake animation, allow retry
    setIsSubmittingPin(false);
    setIsShaking(true);
    setTimeout(() => {
      setIsShaking(false);
      setPinInput('');
    }, 450);
  };

  // Keyboard navigation & Esc key (exit / lock)
  useEffect(() => {
    function onKeyDown(e) {
      if (e.key === 'Escape') {
        sessionStorage.removeItem('sb-admin-unlocked');
        window.history.pushState({}, '', '/');
        window.dispatchEvent(new PopStateEvent('popstate'));
        return;
      }

      if (!isUnlocked) {
        if (/^[0-9]$/.test(e.key)) {
          if (pinInput.length < 8) {
            setPinInput((p) => p + e.key);
          }
        } else if (e.key === 'Backspace') {
          setPinInput((p) => p.slice(0, -1));
        } else if (e.key === 'Enter') {
          handlePinSubmit(pinInput);
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isUnlocked, pinInput]);

  // Generic admin POST action
  const callAdmin = async (endpoint, payload) => {
    try {
      const res = await fetch(`${CONFIG.API_URL}/admin/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Admin-Pin': pinRef.current,
        },
        body: payload ? JSON.stringify(payload) : undefined,
      });

      if (res.status === 401) {
        sessionStorage.removeItem('sb-admin-unlocked');
        setIsUnlocked(false);
        return;
      }

      if (res.ok) {
        const body = await res.json();
        if (body.occupancy !== undefined) {
          setPendingOcc(body.occupancy);
        }
        fetchLog();
      }
    } catch (_) {
      // Network error handled gracefully
    }
  };

  // RESET 2-second hold handler
  const [isHoldingReset, setIsHoldingReset] = useState(false);
  const resetTimerRef = useRef(null);

  const startResetHold = () => {
    setIsHoldingReset(true);
    resetTimerRef.current = setTimeout(() => {
      setIsHoldingReset(false);
      callAdmin('reset');
    }, 2000);
  };

  const cancelResetHold = () => {
    if (resetTimerRef.current) {
      clearTimeout(resetTimerRef.current);
      resetTimerRef.current = null;
    }
    setIsHoldingReset(false);
  };

  const exitToPublic = () => {
    sessionStorage.removeItem('sb-admin-unlocked');
    window.history.pushState({}, '', '/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  // Helper for row colors
  const getRowColor = (source, type) => {
    const s = (source || '').toLowerCase();
    const t = (type || '').toLowerCase();
    if (t === 'clamp') return '#ef4444';
    if (s === 'camera') {
      if (t === 'board') return '#38bdf8';
      if (t === 'alight') return '#a855f7';
    }
    if (s === 'manual') {
      if (t === 'board') return '#f59e0b';
      if (t === 'alight') return '#ea580c';
    }
    return '#93a0c0';
  };

  // If locked, render full-screen PIN gate (no dashboard behind it)
  if (!isUnlocked) {
    return (
      <div className="pin-modal-backdrop" role="dialog" aria-modal="true" aria-label="Admin PIN Gate">
        <div className={`pin-modal-card ${isShaking ? 'shake' : ''}`}>
          <h2 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 900, textTransform: 'uppercase' }}>
            SmartBus Admin PIN
          </h2>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--muted)' }}>
            Enter 4-digit code to access operator controls
          </p>

          <div className="pin-display">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={`pin-dot ${i < pinInput.length ? 'filled' : ''}`}
              />
            ))}
          </div>

          <div className="pin-keypad">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
              <button
                key={digit}
                className="pin-btn"
                onClick={() => pinInput.length < 8 && setPinInput((p) => p + digit)}
              >
                {digit}
              </button>
            ))}
            <button
              className="pin-btn"
              style={{ fontSize: '0.85rem', color: 'var(--muted)', fontWeight: 800 }}
              onClick={() => setPinInput('')}
            >
              Clear
            </button>
            <button
              className="pin-btn"
              onClick={() => pinInput.length < 8 && setPinInput((p) => p + '0')}
            >
              0
            </button>
            <button
              className="pin-btn"
              style={{ fontSize: '0.85rem', color: 'var(--accent-1)', fontWeight: 800 }}
              onClick={() => handlePinSubmit(pinInput)}
              disabled={isSubmittingPin}
            >
              {isSubmittingPin ? '...' : 'Enter'}
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
            onClick={exitToPublic}
          >
            Exit to Public (Esc)
          </button>
        </div>
      </div>
    );
  }

  const currentMode = data.mode || 'ai';

  return (
    <div className="admin-dashboard" role="region" aria-label="SmartBus Admin Dashboard">
      {/* Top Header Bar */}
      <header className="admin-header" role="banner">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '1.25rem', fontWeight: 900, textTransform: 'uppercase' }}>
                SmartBus TN
              </span>
              <span
                className="tag"
                style={{
                  background: 'rgba(56, 189, 248, 0.15)',
                  color: 'var(--accent-1)',
                  fontWeight: 800,
                }}
              >
                ADMIN
              </span>
            </div>
            <span style={{ fontSize: '0.72rem', color: 'var(--muted)' }}>
              Operator controls · same backend as public dashboard
            </span>
          </div>
        </div>

        {/* Mode Selector Segmented Group */}
        <div className="admin-mode-group">
          <button
            type="button"
            className={`admin-mode-btn ${currentMode === 'ai' ? 'active-ai' : ''}`}
            onClick={() => callAdmin('mode', { mode: 'ai' })}
          >
            AI DRIVEN
          </button>
          <button
            type="button"
            className={`admin-mode-btn ${currentMode === 'manual' ? 'active-manual' : ''}`}
            onClick={() => callAdmin('mode', { mode: 'manual' })}
          >
            MANUAL
          </button>
          <button
            type="button"
            className={`admin-mode-btn ${currentMode === 'paused' ? 'active-paused' : ''}`}
            onClick={() => callAdmin('mode', { mode: 'paused' })}
          >
            PAUSED
          </button>
        </div>

        {/* Right Actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div
            className={`conn-pill ${connected && !stale ? 'conn-pill--connected' : 'conn-pill--offline'}`}
          >
            <span className="conn-pill__dot" aria-hidden="true" />
            {connected && !stale ? 'CONNECTED' : 'OFFLINE'}
          </div>

          <ThemeToggle />

          <button
            type="button"
            className="admin-exit-btn"
            onClick={exitToPublic}
            title="Exit to Public Dashboard"
          >
            <span>Exit to Public</span>
            <span>→</span>
          </button>
        </div>
      </header>

      {/* Sub-Header Bar */}
      <div className="admin-subbar">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: connected ? '#10b981' : '#ef4444',
              }}
            />
            <span style={{ color: connected ? '#10b981' : '#ef4444', letterSpacing: '0.08em' }}>
              DISPATCH TELEMETRY BRIDGE
            </span>
          </div>
          <span style={{ color: 'var(--border)' }}>|</span>
          <span>UNIT: <strong style={{ color: 'var(--text)' }}>TN-EXPR-4089</strong></span>
          <span style={{ color: 'var(--border)' }}>|</span>
          <span>ROUTE: <strong style={{ color: 'var(--accent-1)' }}>LINE 14 (TIRUPPUR → KARUR)</strong></span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span>MODE: <strong style={{ color: currentMode === 'ai' ? '#f59e0b' : currentMode === 'manual' ? 'var(--accent-1)' : '#ef4444', textTransform: 'uppercase' }}>{currentMode}</strong></span>
          <span style={{ color: 'var(--border)' }}>|</span>
          <span>SOURCE: <strong style={{ color: 'var(--text)', textTransform: 'uppercase' }}>{data.source || 'CAMERA'}</strong></span>
        </div>
      </div>

      {/* Main 3-Column Bento Grid */}
      <main className="admin-grid" role="main">
        {/* =========================================================
            COLUMN 1: LIVE AI TELEMETRY (~28%)
            ========================================================= */}
        <section className="admin-panel" aria-label="Live AI Telemetry">
          <div className="admin-panel__header">
            <span className="admin-panel__title">
              <span>●</span>
              <span>LIVE AI TELEMETRY</span>
            </span>
            <span
              className="tag"
              style={{
                background: data.ai_ok ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                color: data.ai_ok ? '#22c55e' : '#ef4444',
                fontWeight: 800,
              }}
            >
              {data.ai_ok ? 'ACTIVE' : 'INACTIVE'}
            </span>
          </div>

          {/* Per-Door Ingestion Status Panel */}
          <div
            className="admin-doors-panel"
            aria-label="Per-Door Ingestion Status"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              marginTop: '0.6rem',
              marginBottom: '0.2rem',
            }}
          >
            {['entrance', 'exit'].map((doorKey) => {
              const doorData = (data.doors && data.doors[doorKey]) || (doorKey === 'entrance' ? { configured: true, camera_ok: false, fps: 0, stale: true, client_boards: 0, server_boards: 0, mismatch: 0 } : { configured: false });
              const isConfigured = doorData.configured !== false;
              const isStale = Boolean(doorData.stale);
              const isCamOk = Boolean(doorData.camera_ok);
              const label = doorKey.charAt(0).toUpperCase() + doorKey.slice(1);

              if (!isConfigured) {
                return (
                  <div
                    key={doorKey}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                      padding: '6px 10px',
                      background: 'var(--panel-2)',
                      borderRadius: '8px',
                      border: '1px solid var(--border)',
                      fontSize: '0.75rem',
                      color: 'var(--muted)',
                    }}
                  >
                    <span style={{ fontWeight: 800 }}>{label}</span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: '#64748b',
                      }}
                    />
                    <span style={{ fontStyle: 'italic' }}>not configured</span>
                  </div>
                );
              }

              let dotColor = '#ef4444'; // red if !camera_ok
              let statusText = 'OFFLINE';
              if (isCamOk && !isStale) {
                dotColor = '#10b981'; // green if camera_ok && !stale
                statusText = 'LIVE';
              } else if (isStale) {
                dotColor = '#f59e0b'; // amber if stale
                statusText = 'STALE';
              }

              const clientBoards = doorData.client_boards ?? 0;
              const serverBoards = doorData.server_boards ?? 0;
              const mismatchDiff = Math.abs(doorData.mismatch ?? 0);

              return (
                <div
                  key={doorKey}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: 'var(--panel-2)',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                    fontSize: '0.75rem',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontWeight: 800, color: 'var(--text)' }}>{label}</span>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: dotColor,
                        boxShadow: dotColor === '#10b981' ? '0 0 6px rgba(16, 185, 129, 0.4)' : 'none',
                      }}
                    />
                    <span style={{ fontWeight: 800, color: dotColor, fontSize: '0.7rem' }}>
                      {statusText}
                    </span>
                    <span style={{ color: 'var(--muted)', fontSize: '0.72rem' }}>
                      {(doorData.fps ?? 0).toFixed(1)} fps
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isStale ? (
                      <span style={{ color: '#f59e0b', fontWeight: 600 }}>heartbeat stale</span>
                    ) : (
                      <>
                        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text)', fontWeight: 600 }}>
                          {clientBoards} / {serverBoards}
                        </span>
                        <span style={{ color: 'var(--border)' }}>·</span>
                        {mismatchDiff <= 2 ? (
                          <span style={{ color: 'var(--muted)' }}>ok</span>
                        ) : (
                          <span style={{ color: '#ef4444', fontWeight: 800 }}>
                            ⚠ {mismatchDiff} missing
                          </span>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Camera surface */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '16/9',
              background: '#000000',
              borderRadius: '10px',
              overflow: 'hidden',
              marginTop: '0.6rem',
              border: '1px solid var(--border)',
            }}
          >
            <img
              src={CONFIG.CAMERA_STREAM_URL}
              alt="Doorway Entry Camera"
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              onError={(e) => {
                e.target.style.display = 'none';
              }}
            />
            <div
              style={{
                position: 'absolute',
                top: 6,
                left: 8,
                fontSize: '0.65rem',
                fontWeight: 800,
                color: '#10b981',
                background: 'rgba(0,0,0,0.6)',
                padding: '2px 6px',
                borderRadius: '4px',
              }}
            >
              CAM_01 · DOORWAY
            </div>
          </div>

          {/* Telemetry Metric Cards */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              marginTop: '0.8rem',
              flex: 1,
            }}
          >
            {/* FPS */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--panel-2)',
                borderRadius: '8px',
                border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)' }}>
                FPS
              </span>
              <span style={{ fontSize: '1.25rem', fontWeight: 900, color: '#10b981' }}>
                {shownFps.toFixed(1)}
              </span>
            </div>

            {/* Active Tracks */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--panel-2)',
                borderRadius: '8px',
                border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)' }}>
                ACTIVE TRACKS
              </span>
              <span style={{ fontSize: '1.25rem', fontWeight: 900, color: 'var(--accent-1)' }}>
                {Math.round(shownTracks)}
              </span>
            </div>

            {/* Camera Status */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--panel-2)',
                borderRadius: '8px',
                border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)' }}>
                CAMERA STATUS
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: shownCameraOk ? '#10b981' : '#ef4444',
                    boxShadow: shownCameraOk ? '0 0 8px #10b981' : '0 0 8px #ef4444',
                  }}
                />
                <span
                  style={{
                    fontSize: '0.8rem',
                    fontWeight: 800,
                    color: shownCameraOk ? '#10b981' : '#ef4444',
                  }}
                >
                  {shownCameraOk ? 'ONLINE' : 'OFFLINE'}
                </span>
              </div>
            </div>

            {/* Last Message */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 12px',
                background: 'var(--panel-2)',
                borderRadius: '8px',
                border: '1px solid var(--border)',
              }}
            >
              <span style={{ fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted)' }}>
                LAST MESSAGE
              </span>
              <span style={{ fontSize: '0.9rem', fontWeight: 800, color: 'var(--text)' }}>
                {lastMsgAgo}
              </span>
            </div>
          </div>

          {/* Warning Strip */}
          <div
            style={{
              padding: '8px',
              borderRadius: '8px',
              background: 'rgba(245, 158, 11, 0.1)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              fontSize: '0.68rem',
              color: '#f59e0b',
              marginTop: '0.6rem',
              lineHeight: 1.2,
            }}
          >
            <strong>HARDWARE PROTOCOL:</strong> If camera status drops or FPS falls below 10, switch to <strong>MANUAL</strong> mode.
          </div>
        </section>

        {/* =========================================================
            COLUMN 2: MANUAL CONTROLS (~42%)
            ========================================================= */}
        <section
          className="admin-panel"
          style={{ justifyContent: 'space-between' }}
          aria-label="Manual Operator Controls"
        >
          {/* Top Occupancy Header Card */}
          <div
            style={{
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '0.8rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
            }}
          >
            <div
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.7rem',
                fontWeight: 800,
                color: 'var(--muted)',
                textTransform: 'uppercase',
              }}
            >
              <span>MANUAL OVERRIDE INTERFACE</span>
              <span>MAX RATED: {capacity} PAX</span>
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: '6px', margin: '4px 0' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 800, color: 'var(--muted)' }}>OCCUPANCY:</span>
              <span
                style={{
                  fontSize: 'clamp(2.5rem, 4.5vw, 4rem)',
                  fontWeight: 900,
                  color: statusColor,
                  lineHeight: 1,
                }}
              >
                {occupancy}
              </span>
              <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--muted)' }}>
                / {capacity}
              </span>
            </div>

            <div style={{ width: '100%', height: '8px', background: 'var(--track)', borderRadius: 9999, overflow: 'hidden' }}>
              <div
                style={{
                  width: `${Math.min(percent, 100)}%`,
                  height: '100%',
                  background: statusColor,
                  transition: 'width 250ms ease, background 250ms ease',
                }}
              />
            </div>

            <div
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: '6px',
                fontSize: '0.72rem',
                fontWeight: 800,
              }}
            >
              <span style={{ color: statusColor }}>{percent}% CAPACITY · {status}</span>
              <span style={{ color: 'var(--muted)' }}>
                SEATS REMAINING: <strong style={{ color: 'var(--text)' }}>{Math.max(0, capacity - occupancy)}</strong>
              </span>
            </div>
          </div>

          {/* Primary Action Buttons: + BOARD / + ALIGHT */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem', margin: '0.6rem 0' }}>
            <button
              type="button"
              className="admin-action-btn admin-btn--board"
              onClick={() => callAdmin('board')}
            >
              <span style={{ fontSize: '2.5rem', lineHeight: 1 }}>↑</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 900, letterSpacing: '0.04em' }}>+ BOARD</span>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, opacity: 0.8, textTransform: 'uppercase' }}>
                Increment Occupancy
              </span>
            </button>

            <button
              type="button"
              className="admin-action-btn admin-btn--alight"
              onClick={() => callAdmin('alight')}
            >
              <span style={{ fontSize: '2.5rem', lineHeight: 1 }}>↓</span>
              <span style={{ fontSize: '1.4rem', fontWeight: 900, letterSpacing: '0.04em' }}>+ ALIGHT</span>
              <span style={{ fontSize: '0.65rem', fontWeight: 700, opacity: 0.8, textTransform: 'uppercase' }}>
                Decrement Occupancy
              </span>
            </button>
          </div>

          {/* Secondary Action Row: Undo Last / RESET to 0 (hold 2s) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
            <button
              type="button"
              className="admin-btn--undo"
              onClick={() => callAdmin('set', { occupancy: Math.max(0, occupancy - 1) })}
            >
              <span>↺</span>
              <span>− Undo last</span>
            </button>

            <button
              type="button"
              className="admin-btn--reset"
              onPointerDown={startResetHold}
              onPointerUp={cancelResetHold}
              onPointerLeave={cancelResetHold}
              onPointerCancel={cancelResetHold}
            >
              <div className={`admin-reset-fill ${isHoldingReset ? 'holding' : ''}`} />
              <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <span>↺</span>
                  <span>RESET to 0</span>
                </span>
                <span style={{ fontSize: '0.6rem', opacity: 0.8, textTransform: 'uppercase' }}>
                  HOLD 2 SECONDS TO CLEAR
                </span>
              </div>
            </button>
          </div>

          {/* Quick Set Strip */}
          <div
            style={{
              background: 'var(--panel-2)',
              border: '1px solid var(--border)',
              borderRadius: '12px',
              padding: '0.6rem 0.8rem',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              marginTop: '0.6rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                fontSize: '0.68rem',
                fontWeight: 800,
                color: 'var(--muted)',
                textTransform: 'uppercase',
              }}
            >
              <span>QUICK SET TARGET PRESETS</span>
              <span style={{ color: '#f59e0b' }}>INSTANT OVERWRITE</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.5rem' }}>
              {[0, 5, 8, 10].map((n) => (
                <button
                  key={n}
                  type="button"
                  className="admin-chip-btn"
                  onClick={() => callAdmin('set', { occupancy: n })}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* =========================================================
            COLUMN 3: EVENT LOG (LAST 20) (~30%)
            ========================================================= */}
        <section className="admin-panel" aria-label="Event Audit Log">
          <div className="admin-panel__header">
            <span className="admin-panel__title">
              <span>📋</span>
              <span>EVENT LOG — LAST 20</span>
            </span>
            <span
              className="tag"
              style={{
                background: 'rgba(56, 189, 248, 0.15)',
                color: 'var(--accent-1)',
                fontWeight: 800,
              }}
            >
              {events.length} ENTRIES
            </span>
          </div>

          {/* Legend */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '4px 6px',
              fontSize: '0.62rem',
              fontWeight: 700,
              color: 'var(--muted)',
              background: 'var(--panel-2)',
              borderRadius: '6px',
              marginTop: '6px',
              marginBottom: '6px',
            }}
          >
            <span><strong style={{ color: '#38bdf8' }}>●</strong> AI Board</span>
            <span><strong style={{ color: '#a855f7' }}>●</strong> AI Alight</span>
            <span><strong style={{ color: '#f59e0b' }}>●</strong> Man Board</span>
            <span><strong style={{ color: '#ea580c' }}>●</strong> Man Alight</span>
            <span><strong style={{ color: '#ef4444' }}>●</strong> Clamp</span>
          </div>

          {/* 20 Rows container (No internal scrollbar) */}
          <div className="admin-log-container">
            {events.map((ev, i) => {
              const d = new Date(ev.ts > 1e11 ? ev.ts : ev.ts * 1000);
              const timeStr = isNaN(d.getTime()) ? '00:00:00' : d.toTimeString().split(' ')[0];
              const color = getRowColor(ev.source, ev.type);
              const label = `${ev.source || 'SYS'} ${ev.type || 'EVENT'}`.toUpperCase();

              return (
                <div key={ev.id ?? i} className="admin-log-row">
                  <div className="admin-log-row__left">
                    <span className="admin-log-row__time">{timeStr}</span>
                    <span
                      className="admin-log-row__dot"
                      style={{ backgroundColor: color }}
                    />
                    <span
                      className="admin-log-row__label"
                      style={{ color }}
                    >
                      {label}
                    </span>
                    {ev.id !== undefined && ev.id !== null && (
                      <span style={{ fontSize: '0.6rem', color: 'var(--muted)' }}>
                        #{ev.id}
                      </span>
                    )}
                  </div>
                  <span
                    className="admin-log-row__occ"
                    style={{ color: 'var(--text)' }}
                  >
                    occ {ev.occupancy ?? 0}
                  </span>
                </div>
              );
            })}
            {events.length === 0 && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  height: '100%',
                  fontSize: '0.75rem',
                  color: 'var(--muted)',
                }}
              >
                No audit events recorded yet
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}
