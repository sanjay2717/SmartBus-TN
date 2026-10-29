// smartbus-dashboard/src/components/RouteProgression.jsx
import { useEffect, useState } from 'react';
import { useTheme } from '../context/ThemeContext.jsx';
import { CONFIG } from '../config.js';
import cityDayUrl from '../assets/stitch/route/city-day.svg';
import cityNightUrl from '../assets/stitch/route/city-night.svg';

const STOPS = CONFIG.ROUTE_STOPS && CONFIG.ROUTE_STOPS.length > 0
  ? CONFIG.ROUTE_STOPS
  : ['Tiruppur', 'Palladam', 'Dharapuram', 'Vellakoil', 'Karur'];

export default function RouteProgression() {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Simulation timer state:
  // 10 seconds driving (cycleTime 0..9)
  // 3 seconds stopped (cycleTime 10..12)
  // Total cycle period = 13s
  const [stopIndex, setStopIndex] = useState(1); // Start approaching Palladam
  const [cycleTime, setCycleTime] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setCycleTime((prev) => {
        if (prev >= 12) {
          // Completed stop, move to next stop
          setStopIndex((curr) => (curr + 1) % STOPS.length);
          return 0;
        }
        return prev + 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  const isStopped = cycleTime >= 10;
  const etaSeconds = isStopped ? 0 : 10 - cycleTime;
  const currentStop = STOPS[stopIndex];
  const etaLabel = isStopped ? 'ARRIVED' : `ETA ${etaSeconds}S`;

  return (
    <section
      className={`pub-card route-panel ${isDark ? 'route-panel--night' : 'route-panel--day'} ${
        isStopped ? 'route-progression--paused' : ''
      }`}
      style={{ gridColumn: '1 / 3', gridRow: '1 / 2' }}
      aria-label="Route progression map"
    >
      {/* ── TOP HEADER BAR ─────────────────────────────────────── */}
      <header className="route-header">
        <div className="route-header__left">
          <div className="route-header__sub">
            <span
              className={`route-status-dot ${
                isDark ? 'route-status-dot--night' : 'route-status-dot--day'
              }`}
              aria-hidden="true"
            />
            <span className="route-sub-text">
              ROUTE PROGRESSION{' '}
              <span className="route-sub-fleet">
                {isDark ? '· TN-01 Night Fleet Telemetry' : '· TN-01 Live GPS (Day Service)'}
              </span>
            </span>
          </div>

          <div className="route-header__main">
            <h2 className="route-next-title">
              NEXT STOP:{' '}
              <span className={isDark ? 'route-target--night' : 'route-target--day'}>
                {currentStop}
              </span>
            </h2>
            <span className={`route-eta-pill ${isDark ? 'route-eta--night' : 'route-eta--day'}`}>
              {etaLabel}
            </span>
          </div>
        </div>

        {/* Header Right Badges */}
        <div className="route-header__right">
          {/* Day / Night indicator badge */}
          {isDark ? (
            <div className="route-badge route-badge--night">
              <svg className="route-badge__icon" fill="currentColor" viewBox="0 0 20 20">
                <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
              </svg>
              <span>NIGHT RUN · MOONLIT</span>
            </div>
          ) : (
            <div className="route-badge route-badge--day">
              <svg className="route-badge__icon" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fillRule="evenodd"
                  d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z"
                  clipRule="evenodd"
                />
              </svg>
              <span>DAYLIGHT TRANSIT</span>
            </div>
          )}

          {/* SIMULATED Tag */}
          <div className="route-sim-tag">
            <span className="route-sim-ping" aria-hidden="true" />
            <span className="route-sim-label">SIMULATED</span>
          </div>
        </div>
      </header>

      {/* ── CENTER HERO CANVAS: 2D SCROLLING SCENE ─────────────── */}
      <div className={`route-canvas ${isDark ? 'route-canvas--night' : 'route-canvas--day'}`}>
        {/* Layer 1: Scrolling City Skyline Background */}
        <div
          className="route-city-bg"
          style={{
            backgroundImage: `url(${isDark ? cityNightUrl : cityDayUrl})`,
          }}
          aria-hidden="true"
        />

        {/* Layer 2: Billboard Stop Sign (Appears when approaching / stopped) */}
        {isStopped && (
          <div
            className={`route-billboard ${
              isDark ? 'route-billboard--night neon-pulsing' : 'route-billboard--day billboard-glow'
            }`}
            aria-live="polite"
          >
            <div className="route-billboard__panel">
              <div className="route-billboard__badge">
                <span className="route-billboard__dot" />
                <span className="route-billboard__sub">
                  {isDark ? 'NEXT ARRIVAL WAYPOINT' : 'CURRENT STATION · 0.0 KM'}
                </span>
              </div>
              <span className="route-billboard__name">{currentStop.toUpperCase()}</span>
              <div className="route-billboard__foot">
                {isDark ? `AT STATION · BAY 0${stopIndex + 1}` : `BUS STOP #0${stopIndex + 1}`}
              </div>
            </div>

            {/* Cantilever Truss Structure */}
            <svg className="route-billboard__truss" viewBox="0 0 180 58" fill="none" aria-hidden="true">
              <path
                d="M30,0 L30,58 M150,0 L150,58"
                stroke={isDark ? '#1e293b' : '#475569'}
                strokeWidth="5"
                strokeLinecap="round"
              />
              <path
                d="M30,12 L150,38 M150,12 L30,38"
                stroke={isDark ? '#334155' : '#64748b'}
                strokeWidth="2"
              />
              {isDark && (
                <path d="M30,0 L30,25 M150,0 L150,25" stroke="#38bdf8" strokeWidth="2" opacity="0.6" />
              )}
            </svg>
          </div>
        )}

        {/* Layer 3: The Bus Vehicle & Animations (sit ~20% from left) */}
        <div className="route-bus-anchor">
          <div className="route-bus-assembly bus-vehicle">
            {/* Speed Lines behind bus (visible when driving) */}
            {!isStopped && (
              <svg className="bus-speed-lines" viewBox="0 0 90 48" fill="none" aria-hidden="true">
                <line
                  x1="10"
                  y1="12"
                  x2="80"
                  y2="12"
                  stroke={isDark ? '#38bdf8' : '#3b82f6'}
                  strokeWidth="3"
                  strokeLinecap="round"
                  opacity={isDark ? 0.9 : 0.75}
                />
                <line
                  x1="30"
                  y1="22"
                  x2="88"
                  y2="22"
                  stroke="#60a5fa"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  opacity={isDark ? 0.75 : 0.6}
                />
                <line
                  x1="5"
                  y1="32"
                  x2="75"
                  y2="32"
                  stroke={isDark ? '#818cf8' : '#93c5fd'}
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity={0.8}
                />
                <line
                  x1="40"
                  y1="40"
                  x2="85"
                  y2="40"
                  stroke={isDark ? '#0284c7' : '#bfdbfe'}
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity={isDark ? 0.6 : 0.5}
                />
              </svg>
            )}

            {/* Bus SVG Graphic */}
            <svg className="route-bus-svg" viewBox="0 0 195 82" fill="none" aria-label="TN-01 Express Bus">
              {/* Ground Shadow */}
              <ellipse
                cx="98"
                cy="74"
                rx="84"
                ry="5.5"
                fill={isDark ? '#000000' : '#0f172a'}
                opacity={isDark ? 0.75 : 0.45}
              />

              {/* Lower Body */}
              <rect x="12" y="24" width="168" height="42" rx="10" fill={isDark ? '#1d4ed8' : '#2563eb'} />

              {/* Upper Roof Section */}
              <path
                d="M22,10 L168,10 Q178,10 178,22 L178,26 L12,26 L12,22 Q12,10 22,10 Z"
                fill={isDark ? '#e2e8f0' : '#ffffff'}
              />

              {/* Side Decal Stripe */}
              <path
                d="M12,48 L180,48 L178,54 L12,54 Z"
                fill={isDark ? '#38bdf8' : '#ffffff'}
                opacity={isDark ? 0.95 : 1}
              />
              <path d="M12,52 L178,52 L177,54 L12,54 Z" fill="#f59e0b" />

              {/* Front Windshield */}
              <path
                d="M148,15 L174,15 Q177,15 176,26 L175,40 L148,40 Z"
                fill={isDark ? '#070c18' : '#0f172a'}
              />

              {/* Passenger Windows */}
              {isDark ? (
                <>
                  {/* Warm Glowing Night Interior Windows */}
                  <rect x="22" y="16" width="22" height="24" rx="4" fill="#fef08a" opacity="0.88" />
                  <rect x="49" y="16" width="26" height="24" rx="4" fill="#fef08a" opacity="0.88" />
                  <rect x="80" y="16" width="26" height="24" rx="4" fill="#fef08a" opacity="0.88" />
                  <rect x="111" y="16" width="26" height="24" rx="4" fill="#fef08a" opacity="0.88" />
                  {/* Passenger Silhouettes */}
                  <circle cx="33" cy="25" r="3.5" fill="#1e293b" />
                  <circle cx="62" cy="25" r="3.5" fill="#1e293b" />
                  <circle cx="93" cy="25" r="3.5" fill="#1e293b" />
                  <circle cx="124" cy="25" r="3.5" fill="#1e293b" />
                </>
              ) : (
                <>
                  {/* Day Tinted Windows with Light Glare */}
                  <rect x="22" y="16" width="22" height="24" rx="4" fill="#0f172a" />
                  <rect x="49" y="16" width="26" height="24" rx="4" fill="#0f172a" />
                  <rect x="80" y="16" width="26" height="24" rx="4" fill="#0f172a" />
                  <rect x="111" y="16" width="26" height="24" rx="4" fill="#0f172a" />
                  <path
                    d="M24,36 L38,18 M52,36 L68,18 M83,36 L99,18 M114,36 L130,18 M152,36 L168,18"
                    stroke="#93c5fd"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    opacity="0.8"
                  />
                </>
              )}

              {/* Front Headlight Housing */}
              {isDark ? (
                <rect x="174" y="46" width="6" height="8" rx="2" fill="#ffffff" />
              ) : (
                <>
                  <rect
                    x="174"
                    y="46"
                    width="6"
                    height="8"
                    rx="2"
                    fill="#fef08a"
                    stroke="#d97706"
                    strokeWidth="1"
                  />
                  <polygon points="180,50 250,38 250,66" fill="#fef08a" opacity="0.15" />
                </>
              )}

              {/* Rear Crimson Taillight */}
              <rect x="12" y="46" width="4" height="8" rx="1.5" fill="#ef4444" />

              {/* Unit Badge */}
              <rect x="74" y="58" width="48" height="8" rx="2" fill={isDark ? '#0f172a' : '#1e3a8a'} />
              <text
                x="98"
                y="64.5"
                fill={isDark ? '#38bdf8' : '#ffffff'}
                fontFamily="'Space Grotesk', sans-serif"
                fontSize="6.5"
                fontWeight="800"
                textAnchor="middle"
                letterSpacing="0.5"
              >
                TN-01 · EXPR
              </text>

              {/* Wheel Well Cutouts */}
              <circle cx="48" cy="66" r="14" fill={isDark ? '#020617' : '#1e293b'} />
              <circle cx="142" cy="66" r="14" fill={isDark ? '#020617' : '#1e293b'} />

              {/* FRONT WHEEL (Right) with rotating spokes */}
              <g className="wheel-rotate" style={{ transformOrigin: '142px 66px' }}>
                <circle
                  cx="142"
                  cy="66"
                  r="11"
                  fill="#1e293b"
                  stroke={isDark ? '#0f172a' : '#334155'}
                  strokeWidth="2"
                />
                <circle cx="142" cy="66" r="6" fill={isDark ? '#475569' : '#94a3b8'} />
                <circle cx="142" cy="66" r="2.5" fill="#0f172a" />
                {/* Visible spokes */}
                <line x1="142" y1="56" x2="142" y2="76" stroke="#e2e8f0" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="132" y1="66" x2="152" y2="66" stroke="#e2e8f0" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="135" y1="59" x2="149" y2="73" stroke="#e2e8f0" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="135" y1="73" x2="149" y2="59" stroke="#e2e8f0" strokeWidth="1.2" strokeLinecap="round" />
              </g>

              {/* REAR WHEEL (Left) with rotating spokes */}
              <g className="wheel-rotate" style={{ transformOrigin: '48px 66px' }}>
                <circle
                  cx="48"
                  cy="66"
                  r="11"
                  fill="#1e293b"
                  stroke={isDark ? '#0f172a' : '#334155'}
                  strokeWidth="2"
                />
                <circle cx="48" cy="66" r="6" fill={isDark ? '#475569' : '#94a3b8'} />
                <circle cx="48" cy="66" r="2.5" fill="#0f172a" />
                {/* Visible spokes */}
                <line x1="48" y1="56" x2="48" y2="76" stroke="#e2e8f0" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="38" y1="66" x2="58" y2="66" stroke="#e2e8f0" strokeWidth="1.8" strokeLinecap="round" />
                <line x1="41" y1="59" x2="55" y2="73" stroke="#e2e8f0" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="41" y1="73" x2="55" y2="59" stroke="#e2e8f0" strokeWidth="1.2" strokeLinecap="round" />
              </g>
            </svg>

            {/* Night Mode Volumetric Headlight Cone projecting forward */}
            {isDark && (
              <svg className="route-headlight-cone" viewBox="0 0 280 95" fill="none" aria-hidden="true">
                <defs>
                  <linearGradient id="headlightConeGrad" x1="0%" y1="50%" x2="100%" y2="50%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
                    <stop offset="15%" stopColor="#e0f2fe" stopOpacity="0.7" />
                    <stop offset="60%" stopColor="#38bdf8" stopOpacity="0.3" />
                    <stop offset="100%" stopColor="#0284c7" stopOpacity="0" />
                  </linearGradient>
                  <linearGradient id="brightCore" x1="0%" y1="50%" x2="100%" y2="50%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
                    <stop offset="30%" stopColor="#bae6fd" stopOpacity="0.6" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <polygon points="0,50 280,18 280,82" fill="url(#headlightConeGrad)" />
                <polygon points="0,50 180,32 180,68" fill="url(#brightCore)" />
              </svg>
            )}
          </div>
        </div>

        {/* Layer 4: Road Strip with Scrolling Centerline */}
        <div className={`route-road ${isDark ? 'route-road--night' : 'route-road--day'}`}>
          <div className="route-curb" />
          {isDark && <div className="route-wet-sheen" />}

          {/* Scrolling Centerline */}
          <svg className="route-road-lines-svg" viewBox="0 0 1200 24" preserveAspectRatio="none">
            <line
              x1="0"
              y1="12"
              x2="1200"
              y2="12"
              stroke="#ffffff"
              strokeWidth="4"
              strokeLinecap="round"
              className="road-lines"
            />
          </svg>

          {/* Night specular ground reflections */}
          {isDark && (
            <>
              <div className="route-ground-streak-sign" />
              <div className="route-ground-streak-headlight" />
            </>
          )}
        </div>
      </div>

      {/* ── BOTTOM TELEMETRY BAR ───────────────────────────────── */}
      <footer className={`route-footer ${isDark ? 'route-footer--night' : 'route-footer--day'}`}>
        {/* Left: Current Speed */}
        <div className="route-speed-cluster">
          <span className="route-speed-dot" aria-hidden="true" />
          <div className="route-speed-text">
            <span className="route-footer-label">CURRENT SPEED:</span>
            <span className="route-footer-val">
              {isStopped ? '0' : '48'} <span className="route-footer-unit">km/h</span>
            </span>
          </div>
          <span className={`route-speed-badge ${isDark ? 'route-speed-badge--night' : 'route-speed-badge--day'}`}>
            {isStopped ? 'AT STATION' : isDark ? 'CRUISING OPTIMAL' : 'OPTIMAL'}
          </span>
        </div>

        {/* Center: Mini-Timeline Corridor */}
        <div className="route-timeline" role="list">
          {STOPS.map((stop, i) => {
            const isCurrent = i === stopIndex;
            return (
              <div key={stop} className="route-timeline__item" role="listitem">
                {isCurrent ? (
                  <span
                    className={`route-timeline__current ${
                      isDark ? 'route-timeline__current--night' : 'route-timeline__current--day'
                    }`}
                  >
                    {stop.toUpperCase()} ({isStopped ? 'AT STOP' : 'NEXT'})
                  </span>
                ) : (
                  <span
                    className={`route-timeline__node ${
                      i < stopIndex ? 'route-timeline__node--passed' : 'route-timeline__node--upcoming'
                    }`}
                  >
                    {stop.toUpperCase()}
                  </span>
                )}
                {i < STOPS.length - 1 && <span className="route-timeline__arrow">▶</span>}
              </div>
            );
          })}
        </div>

        {/* Right: Scheduled Arrival */}
        <div className="route-arrival-cluster">
          <span className="route-arrival-dot" aria-hidden="true" />
          <span className="route-footer-label">SCHEDULED ARRIVAL:</span>
          <span className="route-footer-val">
            14:45 <span className="route-footer-unit">IST</span>
          </span>
        </div>
      </footer>
    </section>
  );
}

