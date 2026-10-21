// src/hooks/useLenis.js
import { useEffect, useRef } from 'react';
import Lenis from 'lenis';

/**
 * Initialises Lenis smooth scrolling.
 * – Auto-disabled when OS prefers reduced motion.
 * – Cleans up the RAF loop and destroys the instance on unmount.
 * @returns {Lenis|null}
 */
export function useLenis() {
  const lenisRef = useRef(null);

  useEffect(() => {
    // Respect accessibility preference
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) return;

    const lenis = new Lenis({
      duration: 1.1,
      smoothWheel: true,
      wheelMultiplier: 1,
      touchMultiplier: 1.5,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });

    lenisRef.current = lenis;

    let rafId;
    function raf(time) {
      lenis.raf(time);
      rafId = requestAnimationFrame(raf);
    }
    rafId = requestAnimationFrame(raf);

    return () => {
      cancelAnimationFrame(rafId);
      lenis.destroy();
      lenisRef.current = null;
    };
  }, []);

  return lenisRef.current;
}
