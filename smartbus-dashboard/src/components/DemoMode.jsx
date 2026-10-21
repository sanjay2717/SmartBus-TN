// src/components/DemoMode.jsx
import { useEffect } from 'react';

/**
 * @param {{
 *   demo: { active: boolean, boarded: number, alighted: number, manual: boolean },
 *   setDemo: Function,
 *   onClose: Function
 * }} props
 */
export default function DemoMode({ demo, setDemo, onClose }) {
  // Keyboard: Shift+D toggles the panel visibility (handled in App, not here)
  // This component is always rendered; App controls visibility via demo.active

  function board() {
    setDemo((d) => {
      const boarded = d.boarded + 1;
      const alighted = d.alighted;
      const occupancy = Math.max(0, boarded - alighted);
      return { ...d, boarded, alighted, occupancy };
    });
  }

  function alight() {
    setDemo((d) => {
      const boarded = d.boarded;
      const alighted = d.alighted + 1;
      const occupancy = Math.max(0, boarded - alighted);
      return { ...d, boarded, alighted, occupancy };
    });
  }

  function reset() {
    setDemo((d) => ({ ...d, boarded: 0, alighted: 0, occupancy: 0 }));
  }

  function toggleManual(e) {
    setDemo((d) => ({ ...d, manual: e.target.checked }));
  }

  if (!demo.active) return null;

  return (
    <aside id="demo-mode-panel" className="demo-panel" role="complementary" aria-label="Demo mode panel">
      <div className="demo-panel__inner">
        <div className="demo-panel__header">
          <h3 className="demo-panel__title">
            <span className="tag tag--sim" style={{ marginRight: 8 }}>SIMULATION</span>
            not live AI
          </h3>
          <button
            id="demo-close"
            className="demo-panel__close"
            onClick={onClose}
            aria-label="Close demo mode"
          >
            ✕
          </button>
        </div>

        <label className="demo-panel__check">
          <input
            id="demo-manual-checkbox"
            type="checkbox"
            checked={demo.manual}
            onChange={toggleManual}
          />
          Manual mode
        </label>

        <div className="demo-panel__readout">
          <span>Boarded: <strong>{demo.boarded}</strong></span>
          <span>Alighted: <strong>{demo.alighted}</strong></span>
          <span>On board: <strong>{Math.max(0, demo.boarded - demo.alighted)}</strong></span>
        </div>

        {demo.manual && (
          <div className="demo-panel__btns">
            <button
              id="demo-btn-board"
              className="demo-btn demo-btn--board"
              onClick={board}
            >
              +Board
            </button>
            <button
              id="demo-btn-alight"
              className="demo-btn demo-btn--alight"
              onClick={alight}
            >
              +Alight
            </button>
            <button
              id="demo-btn-reset"
              className="demo-btn demo-btn--reset"
              onClick={reset}
            >
              Reset
            </button>
          </div>
        )}

        <p className="demo-panel__hint">Press Shift + D to dismiss</p>
      </div>
    </aside>
  );
}
