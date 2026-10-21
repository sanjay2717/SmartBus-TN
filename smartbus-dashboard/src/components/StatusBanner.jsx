// src/components/StatusBanner.jsx

/**
 * @param {{ status: string }} props
 * Renders only for RED or OVERFLOW statuses.
 */
export default function StatusBanner({ status }) {
  if (status !== 'RED' && status !== 'OVERFLOW') return null;

  const isOverflow = status === 'OVERFLOW';
  return (
    <div
      id="status-banner"
      className={`status-banner ${isOverflow ? 'status-banner--overflow' : 'status-banner--red'}`}
      role="alert"
      aria-live="assertive"
    >
      <span className="status-banner__icon" aria-hidden="true">⚠</span>
      {isOverflow
        ? 'OVERFLOW — counter error flagged, check the tally sheet'
        : 'HIGH CROWD: consider another bus if available.'}
    </div>
  );
}
