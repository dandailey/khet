import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { PHARAOH, PYRAMID, RED, SILVER, SPHINX, applyMove, bestMove, fromKFEN, fromPieces, legalMoves, newGame, toKFEN } from '../packages/khet-engine/src/index.ts'
import { engineMoveToGameAction, gameActionToEngineMove, gameStateToKFEN, kfenToBoard } from '../src/ai/bridge.js'
import { computeLaserPath } from '../src/game/laser.js'
import { applyBoardAction, actionFromTurn } from '../src/game/moves.js'
import { ANIMATION, animationMs } from '../src/game/animation.js'

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
  const timers = new Map(), workers = [], errors = [], toasts = [], calls = [], delays = []
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
  const confirmation = { hidden: true, classList: { toggle(name, hidden) { confirmation.hidden = hidden } } }
  const classes = { toggle() {}, add() {}, remove() {} }
  const container = { classList: classes, cloneNode() { return {} } }
  const board = { setAttribute() {}, classList: classes, appendChild() {} }
  const square = { remove() {}, offsetLeft: 0, offsetTop: 0, offsetWidth: 70, offsetHeight: 70, querySelector() { return container } }
  const context = vm.createContext({
    gameState: { ...kfenToBoard(toKFEN(newGame(setup))), computer: { humanSide, level: 2 }, gameOver: false, winner: null, sync: { lastTurnId: 0, turnHistory: [] } },
    syncContext: { enabled: false }, aiWorker: null, aiThinking: false, aiFailed: false,
    turnInProgress: false, laserActive: false,
    actionLaserTimeout: null, activeLaserTimeout: null, gameOverOverlayTimeout: null,
    pendingEngineTurn: null, pendingMoveInfo: null,
    stagedAction: null, stagedBoard: null, lastMove: null, activeMoveAnimations: [], replayingOnlineMove: false, laserLayerElement: { innerHTML: '' },
    AIWorker: Worker,
    crypto: { getRandomValues(values) { values[0] = workerSeed = (workerSeed + 0x9e3779b9) >>> 0; return values } },
    RED: 1, SILVER: 2, ANIMATION, animationMs, applyBoardAction, actionFromTurn,
    applyMove, fromKFEN, toKFEN, engineMoveToGameAction, gameActionToEngineMove, gameStateToKFEN,
    traceGameLaser: computeLaserPath,
    setTimeout(callback, delay) { delays.push(delay); const id = ++timerId; timers.set(id, callback); return id },
    clearTimeout(id) { timers.delete(id) },
    document: {
      getElementById(id) { return id === 'computer-status' ? status : id === 'move-confirmation' ? confirmation : board },
      querySelector(selector) { return selector.startsWith('.game-over-overlay') ? null : square }, querySelectorAll() { return [] },
      createElement() { return { className: '', style: {}, setAttribute() {}, appendChild() {}, animate(frames, options) { calls.push({ frames, options }); return { cancel() { calls.push('cancel-motion') } } } } }
    },
    console: { error(...args) { errors.push(args) } },
    clearSelection() {}, renderBoard() { calls.push('render'); context.updateMoveConfirmation() }, updateUrlHash() {},
    selectPiece() { calls.push('select') }, renderLaserPath() { calls.push('laser') },
    clearLaserLayer() {}, updateLaserTipGlow() {}, addDestructionAnimation() {}, persistLaserPath() {},
    stopSyncPolling() {}, showGameOverOverlay() {}, endTurnAndSync(moveInfo) { calls.push('sync'); context.recordTurn(moveInfo) },
    hideTurnOverlay() {}, showTurnStartOverlay() { calls.push('turn-overlay') }, updateSyncStatusUI() {}, saveSyncStorage() {},
    showToast(message) { toasts.push(message) }
  })
  vm.runInContext([
    'cancelComputerTurn', 'updateComputerStatus', 'canPerformAction', 'prepareEngineTurn',
    'checkComputerConsistency', 'maybeStartComputerTurn', 'isLocalPlayersTurn', 'isOpponentsTurn', 'ensureLocalTurn',
    'showTurnBlockedToast', 'movePiece', 'rotatePiece', 'stageAction', 'updateMoveConfirmation',
    'cancelStagedMove', 'confirmStagedMove', 'moveInfoForAction', 'animateOpponentAction', 'clearOpponentAnimation',
    'endTurn', 'handleFireLaser', 'receiveOnlineState', 'handleMoveKeydown', 'recordTurn', 'getCurrentPlayerSide',
    'computeLaserPath', 'handleLaserHit'
  ].map(functionSource).join('\n'), context)
  function nextTimer() {
    const [id, callback] = timers.entries().next().value
    timers.delete(id)
    callback()
  }
  function completeShot() {
    while (context.turnInProgress) nextTimer()
  }
  function play(move) {
    const action = engineMoveToGameAction(move, context.gameState)
    if (action.kind === 'rotate') context.rotatePiece(action.from.row, action.from.col, action.direction === 'cw' ? 'right' : 'left')
    else context.movePiece(action.from.row, action.from.col, action.to.row, action.to.col)
    context.confirmStagedMove()
  }
  return { context, timers, workers, errors, toasts, calls, delays, confirmation, play, nextTimer, completeShot }
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
    assert.equal(calls.filter(call => call?.options).length >= 10, true, 'all computer actions animate')
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


for (const mode of ['local', 'computer', 'online']) {
  test(`${mode}: staging, replacement and cancel leave the board and turn untouched until Fire`, () => {
    const game = liveGame('classic')
    const { context, timers, calls, confirmation } = game
    if (mode !== 'computer') context.gameState.computer = null
    if (mode === 'online') Object.assign(context.syncContext, { enabled: true, localSide: 'silver' })
    const before = JSON.stringify(context.gameState)
    for (const move of ['e1-e2', 'f4xg3', 'j1+', 'c1-']) {
      const action = engineMoveToGameAction(move, context.gameState)
      context.stageAction(action)
      assert.equal(JSON.stringify(context.gameState), before, `${move}: original state unchanged`)
      assert.equal(context.turnInProgress, false)
      assert.equal(context.pendingEngineTurn, null)
      assert.equal(timers.size, 0)
      assert.equal(confirmation.hidden, false)
      assert.deepEqual(context.stagedBoard, applyBoardAction(context.gameState.board, action))
    }
    context.cancelStagedMove()
    assert.equal(context.stagedBoard, null)
    assert.equal(context.stagedAction, null)
    assert.equal(confirmation.hidden, true)
    assert.equal(JSON.stringify(context.gameState), before)
    assert.equal(calls.includes('laser'), false)
    assert.equal(calls.includes('sync'), false)
    context.movePiece(7, 4, 6, 4)
    context.confirmStagedMove()
    assert.equal(context.turnInProgress, true)
    assert.equal(context.gameState.ply, 0, 'turn waits for the laser')
    assert.equal(context.gameState.board[7][4], null)
    assert.equal(context.gameState.board[6][4].type, 'pharaoh')
    assert.equal(confirmation.hidden, true)
    game.completeShot()
    assert.equal(context.gameState.ply, 1)
    assert.equal(calls.includes('laser'), true)
    assert.equal(calls.includes('sync'), mode === 'online')
    if (mode === 'online') assert.equal(context.gameState.sync.turnHistory[0].player, 'silver', 'history records the mover before the turn switches')
  })
}

test('Enter fires the staged move and Escape cancels it', () => {
  const game = liveGame('classic')
  const { context } = game
  const key = value => ({ key: value, target: { closest() { return null } }, preventDefault() {} })
  context.movePiece(7, 4, 6, 4)
  context.handleMoveKeydown(key('Escape'))
  assert.equal(context.stagedAction, null)
  assert.equal(context.gameState.board[7][4].type, 'pharaoh')
  context.movePiece(7, 4, 6, 4)
  context.handleMoveKeydown(key('Enter'))
  assert.equal(context.turnInProgress, true)
  game.completeShot()
  assert.equal(context.gameState.ply, 1)
})

for (const move of ['e1-e2', 'f4xg3', 'c1+', 'c1-']) {
  test(`online opponent ${move}: highlight, motion and hold precede laser without another sync`, () => {
    const game = liveGame('classic')
    const { context, calls, delays } = game
    context.gameState.computer = null
    Object.assign(context.syncContext, { enabled: true, localSide: 'red' })
    const before = gameStateToKFEN(context.gameState)
    const action = engineMoveToGameAction(move, context.gameState)
    const turn = { id: 1, ...context.moveInfoForAction(action) }
    // Older clients recorded the side receiving the turn; replay still works.
    turn.player = 'red'
    const remote = { ...kfenToBoard(toKFEN(applyMove(fromKFEN(before), move))), gameOver: false,
      sync: { lastTurnId: 1, turnHistory: [turn] } }
    context.receiveOnlineState(remote)
    assert.equal(gameStateToKFEN(context.gameState), before, 'highlight does not change placement')
    assert.equal(context.turnInProgress, true)
    assert.equal(delays.at(-1), ANIMATION.highlightMs)
    game.nextTimer()
    const motions = calls.filter(call => call?.frames)
    assert.equal(motions.length, action.kind === 'swap' ? 2 : 1)
    assert.equal(motions[0].options.duration, action.kind === 'rotate' ? ANIMATION.rotateMs : ANIMATION.moveMs)
    assert.equal(motions[0].options.easing, 'ease-in-out')
    if (action.kind === 'rotate') assert.equal(motions[0].frames.at(-1).transform, `rotate(${action.direction === 'cw' ? 90 : -90}deg)`)
    assert.equal(calls.includes('laser'), false)
    game.nextTimer()
    assert.equal(delays.at(-1), ANIMATION.holdMs)
    assert.equal(calls.includes('laser'), false, 'motion ends before the hold and laser')
    assert.deepEqual(context.gameState.board, applyBoardAction(kfenToBoard(before).board, action))
    game.completeShot()
    assert.equal(gameStateToKFEN(context.gameState), gameStateToKFEN(remote))
    assert.equal(context.gameState.sync.lastTurnId, 1)
    assert.equal(context.replayingOnlineMove, false)
    assert.equal(context.lastMove.kind, action.kind, 'last move remains highlighted')
    assert.equal(calls.filter(call => call === 'laser').length, 1)
    assert.equal(calls.includes('sync'), false, 'received turns never push or record another turn')
    assert.equal(calls.includes('turn-overlay'), true, 'turn overlay waits until replay finishes')
  })
}

test('reset during opponent motion cancels overlays and every pending turn timer', () => {
  const game = liveGame('classic', 1)
  game.context.maybeStartComputerTurn()
  game.workers[0].reply()
  game.nextTimer()
  assert.ok(game.context.activeMoveAnimations.length)
  game.context.cancelComputerTurn()
  assert.equal(game.context.activeMoveAnimations.length, 0)
  assert.equal(game.timers.size, 0)
  assert.equal(game.context.lastMove, null)
  assert.equal(game.context.turnInProgress, false)
  assert.ok(game.calls.includes('cancel-motion'))
})

test('reduced motion caps all turn durations at 100 ms', () => {
  const previous = globalThis.matchMedia
  globalThis.matchMedia = () => ({ matches: true })
  try {
    for (const name of ['highlightMs', 'moveMs', 'rotateMs', 'holdMs', 'laserMs']) {
      assert.equal(animationMs(name), 100, name)
    }
    assert.equal(animationMs('fireDelayMs'), 50)
  } finally {
    if (previous === undefined) delete globalThis.matchMedia
    else globalThis.matchMedia = previous
  }
})


test('winning online turn retains its action for the delayed final sync', () => {
  const game = liveGame('classic')
  const position = fromPieces([
    { row: 7, col: 9, type: SPHINX, color: SILVER, o: 3 },
    { row: 0, col: 0, type: SPHINX, color: RED, o: 2 },
    { row: 6, col: 4, type: PHARAOH, color: SILVER, o: 0 },
    { row: 7, col: 5, type: PHARAOH, color: RED, o: 0 },
    { row: 7, col: 6, type: PYRAMID, color: SILVER, o: 0 }
  ])
  Object.assign(game.context.gameState, kfenToBoard(toKFEN(position)), { computer: null })
  Object.assign(game.context.syncContext, { enabled: true, localSide: 'silver' })
  game.play('g1-g2')
  game.completeShot()
  assert.equal(game.context.gameState.gameOver, true)
  game.nextTimer()
  const turn = game.context.gameState.sync.turnHistory[0]
  assert.equal(turn.player, 'silver')
  assert.equal(turn.from.row, 7)
  assert.equal(turn.to.row, 6)
  assert.equal(turn.destroyed, 'pharaoh')
  assert.equal(actionFromTurn(turn, kfenToBoard(toKFEN(position)).board).kind, 'move')
})
