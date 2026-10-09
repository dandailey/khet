import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { PHARAOH, PYRAMID, RED, SILVER, SPHINX, applyMove, bestMove, fromKFEN, fromPieces, legalMoves, newGame, toKFEN } from '../packages/khet-engine/src/index.ts'
import { engineMoveToGameAction, gameActionToEngineMove, gameStateToKFEN, kfenToBoard } from '../src/ai/bridge.js'
import { computeLaserPath } from '../src/game/laser.js'

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const workerSource = readFileSync(new URL('../src/ai/ai-worker.js', import.meta.url), 'utf8').replace(/^import .*\n/, '')
function functionSource(name) {
  const match = main.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'))
  assert.ok(match, `Missing live function ${name}`)
  return match[0]
}

// Execute the live turn functions and worker handler; stub only DOM presentation
// and the browser timer/worker transport so animation boundaries stay explicit.
function liveGame(setup, humanSide = 2) {
  const timers = new Map(), workers = [], errors = [], toasts = [], calls = []
  let timerId = 0
  let workerSeed = 0x4b484554
  class Worker {
    terminated = false
    constructor() { workers.push(this) }
    postMessage(data) { this.request = data }
    terminate() { this.terminated = true }
    reply() {
      const self = { postMessage: data => this.onmessage({ data }) }
      const worker = vm.createContext({ self, bestMove, fromKFEN })
      vm.runInContext(workerSource, worker)
      self.onmessage({ data: this.request })
    }
  }
  const status = { classList: { toggle() {} }, textContent: '' }
  const board = { setAttribute() {} }
  const context = vm.createContext({
    gameState: { ...kfenToBoard(toKFEN(newGame(setup))), computer: { humanSide, level: 2 }, gameOver: false, winner: null },
    syncContext: { enabled: false }, aiWorker: null, aiThinking: false, aiFailed: false,
    applyingComputerMove: false, turnInProgress: false, laserActive: false,
    actionLaserTimeout: null, activeLaserTimeout: null, gameOverOverlayTimeout: null,
    pendingEngineTurn: null, pendingMoveInfo: null,
    AIWorker: Worker,
    crypto: { getRandomValues(values) { values[0] = workerSeed = (workerSeed + 0x9e3779b9) >>> 0; return values } },
    RED: 1, SILVER: 2, LASER_DURATION: 1500,
    applyMove, fromKFEN, toKFEN, engineMoveToGameAction, gameActionToEngineMove, gameStateToKFEN,
    traceGameLaser: computeLaserPath,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id },
    clearTimeout(id) { timers.delete(id) },
    document: { getElementById(id) { return id === 'computer-status' ? status : board } },
    console: { error(...args) { errors.push(args) } },
    clearSelection() {}, renderBoard() { calls.push('render') }, updateUrlHash() {},
    selectPiece() { calls.push('select') }, renderLaserPath() { calls.push('laser') },
    clearLaserLayer() {}, updateLaserTipGlow() {}, addDestructionAnimation() {}, persistLaserPath() {},
    stopSyncPolling() {}, showGameOverOverlay() {}, endTurnAndSync() {},
    showToast(message) { toasts.push(message) }
  })
  vm.runInContext([
    'cancelComputerTurn', 'updateComputerStatus', 'canPerformAction', 'prepareEngineTurn',
    'checkComputerConsistency', 'maybeStartComputerTurn', 'isLocalPlayersTurn', 'ensureLocalTurn',
    'showTurnBlockedToast', 'movePiece', 'rotatePiece', 'endTurn', 'handleFireLaser',
    'computeLaserPath', 'handleLaserHit'
  ].map(functionSource).join('\n'), context)
  function nextTimer() {
    const [id, callback] = timers.entries().next().value
    timers.delete(id)
    callback()
  }
  function completeShot() { nextTimer(); nextTimer() }
  function play(move) {
    const action = engineMoveToGameAction(move, context.gameState)
    if (action.kind === 'rotate') context.rotatePiece(action.from.row, action.from.col, action.direction === 'cw' ? 'right' : 'left')
    else context.movePiece(action.from.row, action.from.col, action.to.row, action.to.col)
  }
  return { context, timers, workers, errors, toasts, calls, play, nextTimer, completeShot }
}

for (const setup of ['classic', 'imhotep', 'dynasty']) {
  test(`${setup}: live UI turn functions and classic worker complete 10 human/computer pairs`, () => {
    const game = liveGame(setup)
    const { context, errors, workers, calls } = game
    let random = 0x4b484554
    for (let turn = 0; turn < 10; turn += 1) {
      const pos = fromKFEN(gameStateToKFEN(context.gameState))
      const moves = legalMoves(pos).filter(move => {
        const next = applyMove(pos, move)
        return next.result === null && !next.hasWinInOne(next.side)
      })
      assert.ok(moves.length)
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0
      game.play(moves[random % moves.length])
      assert.equal(context.turnInProgress, true)
      assert.equal(workers.length, turn, 'search waits until the human laser completes')
      game.completeShot()
      assert.equal(context.aiThinking, true)
      const before = gameStateToKFEN(context.gameState)
      assert.equal(workers.at(-1).request.kfen, before)
      assert.equal(workers.at(-1).request.level, 2)
      assert.ok(Number.isInteger(workers.at(-1).request.seed))
      if (turn) assert.notEqual(workers.at(-1).request.seed, workers.at(-2).request.seed)
      context.rotatePiece(0, 0, 'right')
      assert.equal(gameStateToKFEN(context.gameState), before, 'human input is locked during search')
      workers.at(-1).reply()
      assert.equal(context.turnInProgress, true)
      game.completeShot()
      assert.equal(context.aiThinking, false)
      assert.equal(context.gameState.currentPlayer, 2)
      assert.equal(context.gameState.ply, (turn + 1) * 2)
      assert.equal(context.gameState.gameOver, false)
      assert.deepEqual(errors, [], 'no placement mismatches')
    }
    assert.equal(calls.filter(call => call === 'select').length, 10)
    assert.equal(calls.filter(call => call === 'laser').length, 20)
  })
}

test('Red receives an initial Silver computer move; canceled replies cannot mutate the new game', () => {
  const game = liveGame('dynasty', 1)
  game.context.maybeStartComputerTurn()
  const canceled = game.workers[0]
  game.context.cancelComputerTurn()
  const before = gameStateToKFEN(game.context.gameState)
  canceled.reply()
  assert.equal(gameStateToKFEN(game.context.gameState), before)
  assert.equal(game.context.aiThinking, false)
  game.context.maybeStartComputerTurn()
  game.workers.at(-1).reply()
  game.completeShot()
  assert.equal(game.context.gameState.currentPlayer, 1)
  assert.equal(game.context.gameState.ply, 1)
  assert.deepEqual(game.errors, [])
})

test('worker errors show a toast, terminate search and allow local play', () => {
  const game = liveGame('classic', 1)
  game.context.maybeStartComputerTurn()
  game.workers[0].onerror({ preventDefault() {} })
  assert.equal(game.context.aiThinking, false)
  assert.equal(game.context.canPerformAction(), true)
  assert.equal(game.workers[0].terminated, true)
  assert.equal(game.toasts.length, 1)
  game.play('e1-e2')
  game.completeShot()
  assert.equal(game.context.gameState.currentPlayer, 1)
  assert.equal(game.workers.length, 1, 'failed computer stays in local fallback')
})

test('live scarab swap and both physical rotations agree with complete engine turns', () => {
  for (const move of ['f4xg3', 'j1+', 'c1+', 'c1-']) {
    const game = liveGame('classic')
    game.play(move)
    game.completeShot()
    assert.deepEqual(game.errors, [], move)
    assert.equal(game.context.gameState.ply, 1)
    assert.equal(game.context.aiThinking, true)
  }
})

test('winning laser completes the consistency guard and unlocks without starting another search', () => {
  const game = liveGame('classic')
  const position = fromPieces([
    { row: 7, col: 9, type: SPHINX, color: SILVER, o: 3 },
    { row: 0, col: 0, type: SPHINX, color: RED, o: 2 },
    { row: 6, col: 4, type: PHARAOH, color: SILVER, o: 0 },
    { row: 7, col: 5, type: PHARAOH, color: RED, o: 0 },
    { row: 7, col: 6, type: PYRAMID, color: SILVER, o: 0 }
  ])
  Object.assign(game.context.gameState, kfenToBoard(toKFEN(position)))
  game.play('g1-g2')
  game.completeShot()
  assert.equal(game.context.gameState.gameOver, true)
  assert.equal(game.context.gameState.winner, 2)
  assert.equal(game.context.gameState.ply, 1)
  assert.equal(game.context.turnInProgress, false)
  assert.equal(game.context.pendingEngineTurn, null)
  assert.equal(game.workers.length, 0)
  assert.deepEqual(game.errors, [])
})

test('reset cancels pending move and laser timers as well as search', () => {
  for (const duringLaser of [false, true]) {
    const game = liveGame('classic')
    game.play('e1-e2')
    if (duringLaser) game.nextTimer()
    game.context.cancelComputerTurn()
    assert.equal(game.timers.size, 0)
    assert.equal(game.context.turnInProgress, false)
    assert.equal(game.context.laserActive, false)
    assert.equal(game.context.pendingEngineTurn, null)
  }
})

test('placement mismatch reports actual KFEN, expected KFEN and move without crashing', () => {
  const game = liveGame('imhotep')
  game.play('e1-e2')
  game.context.gameState.board[2][3] = null
  game.completeShot()
  assert.equal(game.errors.length, 1)
  const [, details] = game.errors[0]
  assert.equal(details.move, 'e1-e2')
  assert.notEqual(details.actual.split(' ')[0], details.expected.split(' ')[0])
  assert.equal(game.context.aiThinking, true, 'game continues after reporting mismatch')
})

test('classic worker returns only move, depth and score, and reports invalid requests', () => {
  const messages = []
  const self = { postMessage(data) { messages.push(data) } }
  vm.runInContext(workerSource, vm.createContext({ self, bestMove, fromKFEN }))
  self.onmessage({ data: { kfen: toKFEN(newGame()), level: 2, seed: 42 } })
  assert.deepEqual(Object.keys(messages[0]).sort(), ['depth', 'move', 'score'])
  assert.ok(legalMoves(newGame()).includes(messages[0].move))
  self.onmessage({ data: { kfen: 'invalid', level: 2, seed: 42 } })
  assert.equal(typeof messages[1].error, 'string')
})
