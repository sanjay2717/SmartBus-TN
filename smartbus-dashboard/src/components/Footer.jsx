// src/components/Footer.jsx

export default function Footer() {
  return (
    <footer className="footer" role="contentinfo">
      <div className="footer__tags">
        <span className="tag tag--live">LIVE — camera counts</span>
        <span className="tag tag--sim">SIMULATED — bus position, ETA, next stop</span>
      </div>
      <p className="footer__hint">
        Press <kbd>Shift</kbd> + <kbd>D</kbd> for demo mode
        &nbsp;·&nbsp;
        <button
          id="footer-demo-link"
          className="footer__demo-link"
          onClick={() => {
            // Custom event picked up by App.jsx
            window.dispatchEvent(new CustomEvent('smartbus:toggledemo'));
          }}
        >
          Demo
        </button>
      </p>
      <p className="footer__copy">SmartBus TN — College project · Data is for demonstration purposes only</p>
    </footer>
  );
}
