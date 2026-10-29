// src/config.js
// Central configuration — all env vars and constants live here.

// Derive API / WS base from the page's own origin so the app works
// whether accessed via localhost OR a LAN IP (e.g. 10.x.x.x:8000).
// VITE_* env vars still override when set explicitly.
const _origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8000';
const _wsOrigin = _origin.replace(/^http/, 'ws');

export const CONFIG = {
  WS_URL:
    import.meta.env.VITE_WS_URL || `${_wsOrigin}/ws`,

  API_URL:
    import.meta.env.VITE_API_URL || _origin,

  CAMERA_STREAM_URL:
    import.meta.env.VITE_CAMERA_URL || `${_origin}/video`,

  /** Mark data stale after this many ms without a backend frame */
  STALE_MS: 3000,

  /** Exponential-backoff reconnect window */
  RECONNECT_MIN_MS: 500,
  RECONNECT_MAX_MS: 8000,

  /** Fixed stops along the TN-01 route */
  ROUTE_STOPS: ['Tiruppur', 'Palladam', 'Dharapuram', 'Vellakoil', 'Karur'],

  /** Duration of the simulated journey animation in seconds */
  JOURNEY_SECONDS: 60,

  /** Fallback capacity when backend has not reported one yet */
  DEFAULT_CAPACITY: 10,
};

/** Semantic colour per status key — matched to styles.css accent values */
export const STATUS_COLOR = {
  GREEN:    '#22c55e',
  YELLOW:   '#f59e0b',
  RED:      '#ef4444',
  OVERFLOW: '#b91c1c',
};

/**
 * statusFor — DemoMode fallback ONLY.
 *
 * The live backend sends its own `status` field; the client MUST render
 * that verbatim and never call this function for live data.
 *
 * @param {number} occupancy
 * @param {number} capacity
 * @returns {'GREEN'|'YELLOW'|'RED'|'OVERFLOW'}
 */
export function statusFor(occupancy, capacity) {
  if (occupancy > capacity) return 'OVERFLOW';
  const pct = capacity > 0 ? (occupancy / capacity) * 100 : 0;
  if (pct >= 80) return 'RED';
  if (pct >= 50) return 'YELLOW';
  return 'GREEN';
}
