// src/hooks/useBusSocket.js
import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '../config.js';

const INITIAL_DATA = {
  boarded: 0,
  alighted: 0,
  occupancy: 0,
  capacity: CONFIG.DEFAULT_CAPACITY,
  percent: 0,
  status: 'GREEN',
  camera_ok: false,
  timestamp: 0,
};

/**
 * Opens a WebSocket to CONFIG.WS_URL.
 * Handles partial updates, exponential-backoff reconnects, and staleness.
 *
 * @returns {{ data: object, connected: boolean, stale: boolean }}
 */
export function useBusSocket() {
  const [data, setData] = useState(INITIAL_DATA);
  const [connected, setConnected] = useState(false);
  const [stale, setStale] = useState(false);

  const wsRef = useRef(null);
  const retryDelayRef = useRef(CONFIG.RECONNECT_MIN_MS);
  const retryTimerRef = useRef(null);
  const staleTimerRef = useRef(null);
  const lastMsgAtRef = useRef(0);
  const unmountedRef = useRef(false);

  function resetStaleTimer() {
    clearTimeout(staleTimerRef.current);
    lastMsgAtRef.current = Date.now();
    setStale(false);
    staleTimerRef.current = setTimeout(() => {
      if (!unmountedRef.current) setStale(true);
    }, CONFIG.STALE_MS);
  }

  function connect() {
    if (unmountedRef.current) return;

    try {
      const ws = new WebSocket(CONFIG.WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        if (unmountedRef.current) { ws.close(); return; }
        setConnected(true);
        retryDelayRef.current = CONFIG.RECONNECT_MIN_MS; // reset backoff
        resetStaleTimer();
      };

      ws.onmessage = (evt) => {
        if (unmountedRef.current) return;
        try {
          const parsed = JSON.parse(evt.data);
          setData((prev) => ({ ...prev, ...parsed }));
          resetStaleTimer();
        } catch (_) {
          // Ignore malformed frames
        }
      };

      ws.onclose = () => {
        if (unmountedRef.current) return;
        setConnected(false);
        scheduleReconnect();
      };

      ws.onerror = () => {
        // onclose fires after onerror, so just close here
        ws.close();
      };
    } catch (_) {
      scheduleReconnect();
    }
  }

  function scheduleReconnect() {
    if (unmountedRef.current) return;
    const delay = retryDelayRef.current;
    retryDelayRef.current = Math.min(delay * 2, CONFIG.RECONNECT_MAX_MS);
    retryTimerRef.current = setTimeout(connect, delay);
  }

  useEffect(() => {
    unmountedRef.current = false;
    connect();

    return () => {
      unmountedRef.current = true;
      clearTimeout(retryTimerRef.current);
      clearTimeout(staleTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null; // prevent reconnect on intentional close
        wsRef.current.close();
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { data, connected, stale };
}
