// All live turn animation durations, in milliseconds.
export const ANIMATION = Object.freeze({
  highlightMs: 150,
  moveMs: 600,
  rotateMs: 500,
  holdMs: 300,
  fireDelayMs: 50,
  chargeMs: 900,
  beamMs: 350,
  impactMs: 900,
  shieldMs: 450,
  fizzleMs: 300,
  flashMs: 180,
  shakeMs: 300,
  tipPulseMs: 2000,
  gameOverMs: 800,
  reducedMs: 100
})

export function prefersReducedMotion() {
  return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

export function animationMs(name) {
  if (!prefersReducedMotion()) return ANIMATION[name]
  return name === 'chargeMs' || name === 'shakeMs' ? 0 : Math.min(ANIMATION[name], ANIMATION.reducedMs)
}
