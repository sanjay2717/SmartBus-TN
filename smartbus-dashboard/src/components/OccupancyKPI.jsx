// src/components/OccupancyKPI.jsx
import { STATUS_COLOR } from '../config.js';

/**
 * @param {{ occupancy: number, capacity: number, percent: number,
 *           status: string, mode: string }} props
 */
export default function OccupancyKPI({ occupancy, capacity, percent, status, mode }) {
  const color = STATUS_COLOR[status] ?? STATUS_COLOR.GREEN;
  const isLive = mode === 'LIVE';

  return (
    <section className="panel kpi" aria-label="Occupancy KPI">
      <div className="panel__header">
        <h2 className="panel__title">Occupancy</h2>
        <span className={`tag ${isLive ? 'tag--live' : 'tag--sim'}`}>
          {isLive ? 'LIVE' : 'SIMULATION'}
        </span>
      </div>

      {/* Big count */}
      <div className="kpi__count" style={{ color }} aria-label={`${occupancy} of ${capacity} passengers`}>
        <span className="kpi__num">{occupancy}</span>
        <span className="kpi__sep">/</span>
        <span className="kpi__cap">{capacity}</span>
      </div>

      {/* Percent */}
      <div className="kpi__percent" style={{ color }}>
        {percent}%
      </div>

      {/* Bar */}
      <div className="kpi__bar-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div
          className="kpi__bar-fill"
          style={{
            width: `${Math.min(percent, 100)}%`,
            background: color,
          }}
        />
      </div>

      {/* Status word */}
      <div className="kpi__status" style={{ color }}>
        {status}
      </div>

      <p className="kpi__note">Demo capacity {capacity}</p>
    </section>
  );
}
