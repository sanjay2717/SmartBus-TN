// src/components/Counters.jsx

/**
 * @param {{ boarded: number, alighted: number, mode: string }} props
 */
export default function Counters({ boarded, alighted, mode }) {
  const isLive = mode === 'LIVE';
  const tagLabel = isLive ? 'LIVE (camera)' : 'SIMULATION';
  const tagClass = isLive ? 'tag--live' : 'tag--sim';

  return (
    <section className="panel counters" aria-label="Passenger counters">
      <div className="panel__header">
        <h2 className="panel__title">Counters</h2>
        <span className={`tag ${tagClass}`}>{tagLabel}</span>
      </div>

      <div className="counters__grid">
        <div className="counter-card counter-card--board" id="counter-boarded">
          <span className="counter-card__icon" aria-hidden="true">↑</span>
          <span className="counter-card__value">{boarded}</span>
          <span className="counter-card__label">Boarded</span>
        </div>
        <div className="counter-card counter-card--alight" id="counter-alighted">
          <span className="counter-card__icon" aria-hidden="true">↓</span>
          <span className="counter-card__value">{alighted}</span>
          <span className="counter-card__label">Alighted</span>
        </div>
      </div>
    </section>
  );
}
