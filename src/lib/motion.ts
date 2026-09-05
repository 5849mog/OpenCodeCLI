/**
 * Motion tokens — the single source of truth for animation values.
 *
 * One cubic-bezier (fast start, long tail) plus a small set of durations and
 * springs. Components should import these instead of hardcoding
 * `transition={{ duration: 0.15 }}` so the motion language stays coherent.
 * Reduced-motion is handled globally by <MotionConfig reducedMotion="user">
 * in src/app/page.tsx.
 */

/** Soft-but-fast ease: covers 90% of the feel in 150ms. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Mount/fade passes (list items, cards, rows). */
export const fadeUp = {
  initial: { opacity: 0, y: 4 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.18, ease: EASE_OUT },
} as const;

/** Very small displacement — inline chips, badges. */
export const fadeUpSmall = {
  initial: { opacity: 0, y: 2 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.15, ease: EASE_OUT },
} as const;

/** Collapse/expand reveal for the round trace. */
export const reveal = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: "auto" },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.22, ease: EASE_OUT },
} as const;

/** Status change "pop" — completed step icon, badges. */
export const springPop = {
  initial: { scale: 0.6, opacity: 0 },
  animate: { scale: 1, opacity: 1 },
  transition: { type: "spring", stiffness: 480, damping: 24, mass: 0.7 },
} as const;
