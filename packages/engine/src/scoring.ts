export const MAX_POINTS = 1000;
export const MIN_CORRECT_POINTS = 500;
export const STREAK_STEP = 100;
export const MAX_STREAK_BONUS = 400;
/** Answers arriving this long after the deadline still count (network jitter). */
export const LATENCY_GRACE_MS = 300;

/**
 * Correct answers earn 500-1000 points, linearly by speed, plus a streak bonus.
 * `streak` is the streak *including* this answer.
 */
export function pointsFor(correct: boolean, elapsedMs: number, limitMs: number, streak: number): number {
  if (!correct) return 0;
  const frac = Math.min(Math.max(elapsedMs / limitMs, 0), 1);
  const speed = Math.round(MAX_POINTS - (MAX_POINTS - MIN_CORRECT_POINTS) * frac);
  const bonus = Math.min(Math.max(streak - 1, 0) * STREAK_STEP, MAX_STREAK_BONUS);
  return speed + bonus;
}
