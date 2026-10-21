// src/components/RouteMap.jsx
import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config.js';

const STOPS = CONFIG.ROUTE_STOPS;
const JOURNEY_S = CONFIG.JOURNEY_SECONDS;

export default function RouteMap() {
  const [progress, setProgress] = useState(0); // 0..1
  const startRef = useRef(null);
  const rafRef = useRef(null);

  useEffect(() => {
    startRef.current = performance.now();

    function tick(now) {
      const elapsed = (now - startRef.current) / 1000; // seconds
      const t = (elapsed % JOURNEY_S) / JOURNEY_S;     // loops 0→1
      setProgress(t);
      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  // Which segment the bus is on (between stops)
  const segments = STOPS.length - 1;
  const segmentIndex = Math.min(Math.floor(progress * segments), segments - 1);
  const segmentProgress = (progress * segments) - segmentIndex; // 0..1 within segment

  const nextStopIndex = Math.min(segmentIndex + 1, STOPS.length - 1);
  const nextStop = STOPS[nextStopIndex];
  const etaSeconds = Math.ceil((1 - progress) * JOURNEY_S);
  const etaMin = Math.floor(etaSeconds / 60);
  const etaSec = etaSeconds % 60;
  const etaLabel = etaMin > 0 ? `${etaMin}m ${etaSec}s` : `${etaSec}s`;

  return (
    <section className="panel route" aria-label="Simulated route map">
      <div className="panel__header">
        <h2 className="panel__title">Route Progress</h2>
        <span className="tag tag--sim">SIMULATED</span>
      </div>

      {/* Stop track */}
      <div className="route-track" role="img" aria-label="Bus route progress track">
        {STOPS.map((stop, i) => {
          const stopPos = i / (STOPS.length - 1); // 0..1
          const isPast = progress >= stopPos;
          const isNext = i === nextStopIndex;
          return (
            <div
              key={stop}
              className={`route-stop ${isPast ? 'route-stop--past' : ''} ${isNext ? 'route-stop--next' : ''}`}
              style={{ left: `${stopPos * 100}%` }}
            >
              <div className="route-stop__dot" />
              <span className="route-stop__label">{stop}</span>
            </div>
          );
        })}

        {/* Track fill */}
        <div className="route-track__rail">
          <div
            className="route-track__fill"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Bus emoji */}
        <div
          className="route-bus"
          style={{ left: `calc(${progress * 100}% - 16px)` }}
          aria-hidden="true"
        >
          🚌
        </div>
      </div>

      {/* Info row */}
      <div className="route-info">
        <div className="route-info__item">
          <span className="route-info__label">Next stop</span>
          <span className="route-info__value">{nextStop}</span>
        </div>
        <div className="route-info__item">
          <span className="route-info__label">ETA</span>
          <span className="route-info__value">{etaLabel}</span>
        </div>
        <div className="route-info__item">
          <span className="route-info__label">Progress</span>
          <span className="route-info__value">{Math.round(progress * 100)}%</span>
        </div>
      </div>
    </section>
  );
}
