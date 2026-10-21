// src/components/CameraPanel.jsx
import { useState } from 'react';
import { CONFIG } from '../config.js';

/**
 * @param {{ camera_ok: boolean, stale: boolean, mode: string }} props
 */
export default function CameraPanel({ camera_ok, stale, mode }) {
  const [imgError, setImgError] = useState(false);
  const isLive = mode === 'LIVE';
  const showFeed = camera_ok && !stale && isLive && !imgError;
  const tagClass = showFeed ? 'tag--live' : 'tag--offline';
  const tagLabel = showFeed ? 'LIVE (camera)' : 'OFFLINE';

  return (
    <section className="panel camera" aria-label="Camera feed">
      <div className="panel__header">
        <h2 className="panel__title">Camera</h2>
        <span className={`tag ${tagClass}`}>{tagLabel}</span>
      </div>

      <div className="camera__viewport">
        {showFeed ? (
          <img
            id="camera-feed"
            src={CONFIG.CAMERA_STREAM_URL}
            alt="Live MJPEG camera feed"
            className="camera__img"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="camera__offline" id="camera-offline">
            <span className="camera__offline-icon" aria-hidden="true">📷</span>
            <span className="camera__offline-text">Camera offline</span>
            {isLive && !camera_ok && (
              <span className="camera__offline-sub">Backend reported camera_ok=false</span>
            )}
            {!isLive && (
              <span className="camera__offline-sub">Not available in simulation mode</span>
            )}
            {stale && isLive && (
              <span className="camera__offline-sub">Data stream stale</span>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
