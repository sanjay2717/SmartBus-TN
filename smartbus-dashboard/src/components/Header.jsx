// src/components/Header.jsx
import ThemeToggle from './ThemeToggle.jsx';

/**
 * @param {{ connected: boolean, stale: boolean }} props
 */
export default function Header({ connected, stale }) {
  let pillLabel, pillClass;
  if (connected && !stale) {
    pillLabel = 'CONNECTED';
    pillClass = 'conn-pill conn-pill--connected';
  } else if (!connected) {
    pillLabel = 'OFFLINE';
    pillClass = 'conn-pill conn-pill--offline';
  } else {
    pillLabel = 'RECONNECTING';
    pillClass = 'conn-pill conn-pill--reconnecting';
  }

  return (
    <header className="header" role="banner">
      <div className="header__left">
        <h1 className="header__title">SmartBus TN</h1>
        <p className="header__subtitle">TN-01 &middot; Tiruppur → Karur</p>
      </div>
      <div className="header__right">
        <span id="connection-status" className={pillClass} aria-live="polite">
          <span className="conn-pill__dot" aria-hidden="true" />
          {pillLabel}
        </span>
        <ThemeToggle />
      </div>
    </header>
  );
}
