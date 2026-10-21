// src/context/ThemeContext.jsx
import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(null);

function getInitialTheme() {
  try {
    const stored = localStorage.getItem('smartbus-theme');
    if (stored === 'dark' || stored === 'light') return stored;
  } catch (_) { /* localStorage unavailable */ }

  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(getInitialTheme);

  const setTheme = (next) => {
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('smartbus-theme', next); } catch (_) {}
  };

  const toggleTheme = () => setTheme(theme === 'dark' ? 'light' : 'dark');

  // Sync data-theme attribute on mount and whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
