import test from 'node:test'
import assert from 'node:assert/strict'
import { createLaserEffects } from '../src/game/laserEffects.js'

function canvasHarness(reduced = false) {
  const names = ['document', 'window', 'ResizeObserver', 'requestAnimationFrame', 'cancelAnimationFrame', 'matchMedia']
  const previous = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
  const frames = new Map(), fills = [], positions = [], transforms = []
  let id = 0, resizeObserver
  const context = {
    globalAlpha: 1, clearRect() {}, save() {}, restore() {}, rotate() {},
    translate(x, y) { positions.push([x, y]) },
    fillRect(...args) { fills.push(args) },
    setTransform(...args) { transforms.push(args) },
    createRadialGradient() { return { addColorStop() {} } }
  }
  const canvas = { setAttribute() {}, getContext() { return context } }
  const board = { clientWidth: 700, clientHeight: 560 }
  const window = { devicePixelRatio: 2, addEventListener() {} }
  Object.assign(globalThis, {
    document: { createElement(name) { assert.equal(name, 'canvas'); return canvas } }, window,
    ResizeObserver: class { constructor(callback) { resizeObserver = callback } observe(element) { assert.equal(element, board) } },
    requestAnimationFrame(callback) { const next = ++id; frames.set(next, callback); return next },
    cancelAnimationFrame(frame) { frames.delete(frame) },
    matchMedia() { return { matches: reduced } }
  })
  const effects = createLaserEffects(board)
  return {
    effects, canvas, board, window, frames, fills, positions, transforms,
    resize() { resizeObserver() },
    draw(now) {
      fills.length = positions.length = 0
      const [frame, callback] = frames.entries().next().value
      frames.delete(frame)
      callback(now)
    },
    restore() {
      effects.clear()
      for (const [name, descriptor] of previous) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor)
        else delete globalThis[name]
      }
    }
  }
}

test('board particles resize at device pixel ratio and stop requesting frames after the burst', () => {
  const harness = canvasHarness()
  try {
    const { effects, canvas, board, window, frames, fills, positions } = harness
    effects.burst({ x: 50, y: 50, kind: 'destroy', color: '#f35b5b', direction: { row: 0, col: 1 } })
    const start = performance.now()
    assert.equal(canvas.width, 1400)
    assert.equal(canvas.height, 1120)
    harness.draw(start)
    assert.equal(fills.length, 32, 'shards and hot core use one canvas')
    const first = [...positions[0]]
    board.clientWidth = 350
    board.clientHeight = 280
    window.devicePixelRatio = 3
    harness.resize()
    assert.equal(canvas.width, 1050)
    assert.equal(canvas.height, 840)
    harness.draw(start)
    assert.deepEqual(positions[0], first.map(value => value / 2), 'live particles scale with their board')
    assert.deepEqual(harness.transforms.at(-1), [3, 0, 0, 3, 0, 0])
    harness.draw(start + 1000)
    assert.equal(fills.length, 0)
    assert.equal(frames.size, 0, 'idle canvas has no animation loop')
    effects.burst({ x: 50, y: 50, kind: 'pharaoh', color: '#7fd1ff', direction: { row: 1, col: 0 } })
    harness.draw(performance.now())
    assert.equal(fills.length, 40, 'Pharaoh has a bigger burst')
    effects.clear()
    assert.equal(frames.size, 0, 'reset cancels a running burst')
  } finally {
    harness.restore()
  }
})

test('shield sparks deflect into the incident half-plane', () => {
  const harness = canvasHarness()
  try {
    harness.effects.burst({ x: 50, y: 50, kind: 'shield', color: '#f35b5b', direction: { row: 0, col: 1 } })
    harness.draw(performance.now() + 100)
    assert.equal(harness.fills.length, 16)
    assert.ok(harness.positions.every(([x]) => x < 350), 'eastbound beam scatters sparks west from the shield')
  } finally {
    harness.restore()
  }
})

test('reduced motion caps every impact at six particles and completes quickly', () => {
  const harness = canvasHarness(true)
  try {
    for (const kind of ['destroy', 'pharaoh', 'shield', 'fizzle']) {
      harness.effects.burst({ x: 50, y: 50, kind, color: '#7fd1ff', direction: { row: 1, col: 0 } })
      const start = performance.now()
      harness.draw(start)
      assert.equal(harness.fills.length, 6, kind)
      harness.draw(start + 101)
      assert.equal(harness.frames.size, 0, kind)
    }
  } finally {
    harness.restore()
  }
})
