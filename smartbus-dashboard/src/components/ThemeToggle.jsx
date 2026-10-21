// src/components/ThemeToggle.jsx
import { useTheme } from '../context/ThemeContext.jsx';

export default function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      id="theme-toggle"
      className={`theme-toggle ${isDark ? 'theme-toggle--dark' : 'theme-toggle--light'}`}
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
      title={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
    >
      <span className="theme-toggle__track">
        <span className="theme-toggle__knob" />
      </span>
      <span className="theme-toggle__icon" aria-hidden="true">
        {isDark ? '☾' : '☀'}
      </span>
    </button>
  );
}
