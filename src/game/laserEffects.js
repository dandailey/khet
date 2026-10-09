import { animationMs, prefersReducedMotion } from './animation.js'

// One reusable canvas; coordinates and velocities are relative to the board so
// an in-flight burst stays anchored when the board resizes.
export function createLaserEffects(board) {
  const canvas = document.createElement('canvas')
  canvas.className = 'laser-particles'
  canvas.setAttribute('aria-hidden', 'true')
  const context = canvas.getContext('2d')
  let particles = []
  let frame = null
  let width = 0, height = 0, ratio = 0

  function resize() {
    const nextWidth = board.clientWidth
    const nextHeight = board.clientHeight
    const nextRatio = window.devicePixelRatio || 1
    if (width === nextWidth && height === nextHeight && ratio === nextRatio) return
    width = nextWidth
    height = nextHeight
    ratio = nextRatio
    canvas.width = Math.round(width * ratio)
    canvas.height = Math.round(height * ratio)
    context?.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  const observer = new ResizeObserver(resize)
  observer.observe(board)
  // A display change can alter DPR without changing the board's CSS dimensions.
  window.addEventListener('resize', resize)

  function draw(now) {
    frame = null
    resize()
    context.clearRect(0, 0, width, height)
    particles = particles.filter(particle => now - particle.born < particle.life)
    const square = Math.min(width / 10, height / 8)
    for (const particle of particles) {
      const age = (now - particle.born) / 1000
      const progress = (now - particle.born) / particle.life
      const x = (particle.x + particle.vx * age) * width
      const y = (particle.y + particle.vy * age + particle.gravity * age * age / 2) * height
      context.globalAlpha = (1 - progress) ** 1.5
      if (particle.core) {
        const radius = square * particle.size * (1 + progress * 2)
        const glow = context.createRadialGradient(x, y, 0, x, y, radius)
        glow.addColorStop(0, '#ffffff')
        glow.addColorStop(0.2, '#fff5d6')
        glow.addColorStop(0.5, particle.color)
        glow.addColorStop(1, 'transparent')
        context.fillStyle = glow
        context.fillRect(x - radius, y - radius, radius * 2, radius * 2)
      } else {
        context.save()
        context.translate(x, y)
        context.rotate(particle.angle + age * particle.spin)
        context.fillStyle = particle.color
        const size = Math.max(1, square * particle.size * (1 - progress * 0.5))
        context.fillRect(-size / 2, -size / 2, size * 2.5, size)
        context.restore()
      }
    }
    context.globalAlpha = 1
    if (particles.length) frame = requestAnimationFrame(draw)
  }

  function clear() {
    if (frame !== null) cancelAnimationFrame(frame)
    frame = null
    particles = []
    context?.clearRect(0, 0, width, height)
  }

  function burst({ x, y, kind, color, direction }) {
    if (!context) return
    clear()
    resize()
    if (!width || !height) return
    const reduced = prefersReducedMotion()
    const count = reduced ? 6 : kind === 'pharaoh' ? 40 : kind === 'destroy' ? 32 : kind === 'shield' ? 16 : 8
    const life = animationMs(kind === 'shield' ? 'shieldMs' : kind === 'fizzle' ? 'fizzleMs' : 'impactMs')
    const square = Math.min(width / 10, height / 8)
    const born = performance.now()
    const baseAngle = Math.atan2(-direction.row, -direction.col)
    for (let i = 0; i < count; i++) {
      // Shield sparks spray back into the incident half-plane, away from its face.
      const angle = kind === 'shield'
        ? baseAngle + (Math.random() - 0.5) * Math.PI * 0.85
        : Math.PI * 2 * i / count + (Math.random() - 0.5) * 0.4
      const speed = reduced ? 0.25 : (kind === 'pharaoh' ? 3.2 : kind === 'destroy' ? 2.1 : 1.3) * (0.45 + Math.random() * 0.7)
      particles.push({
        x: x / 100, y: y / 100, born,
        life: i === 0 ? Math.min(life, animationMs('flashMs')) : life * (0.65 + Math.random() * 0.35),
        vx: Math.cos(angle) * speed * square / width,
        vy: Math.sin(angle) * speed * square / height,
        gravity: reduced ? 0 : square * 3.5 / height,
        color: i % 5 === 0 ? '#fff5d6' : color,
        core: i === 0, size: i === 0 ? (kind === 'pharaoh' ? 0.65 : 0.35) : 0.025 + Math.random() * 0.035,
        angle, spin: (Math.random() - 0.5) * 12
      })
    }
    frame = requestAnimationFrame(draw)
  }

  return { canvas, burst, clear }
}
