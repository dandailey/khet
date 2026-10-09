// All live turn animation durations, in milliseconds.
export const ANIMATION = Object.freeze({
  highlightMs: 150,
  moveMs: 600,
  rotateMs: 500,
  holdMs: 300,
  fireDelayMs: 50,
  laserMs: 1500,
  gameOverMs: 800,
  particleMs: 800,
  particleSpreadMs: 400,
  reducedMs: 100
})

export function animationMs(name) {
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    ? Math.min(ANIMATION[name], ANIMATION.reducedMs) : ANIMATION[name]
}
