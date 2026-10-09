import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import {
  ANUBIS, PHARAOH, PYRAMID, RED, SCARAB, SILVER, SPHINX,
  fromPieces, legalMoves, newGame, parseMove, toKFEN
} from '../packages/khet-engine/src/index.ts'
import { gameActionToEngineMove, gameStateToKFEN, engineMoveToGameAction, kfenToBoard } from '../src/ai/bridge.js'
import { computeLaserPath, findSphinx, resolveLaserInteraction } from '../src/game/laser.js'
import { applyBoardAction } from '../src/game/moves.js'

const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8')
const originalMain = readFileSync(new URL('../packages/khet-legacy/test/fixtures/main.js.txt', import.meta.url), 'utf8')

// Execute the live setup/validation/rotation functions themselves, with presentation stubbed.
// Their column-zero closing braces delimit the functions without importing the DOM entry point.
function functionSource(source, name) {
  const match = source.match(new RegExp(`^function ${name}\\([^]*?^}`, 'm'))
  assert.ok(match, `Missing live function ${name}`)
  return match[0]
}

function liveRules(state) {
  const reservations = main.slice(main.indexOf('const RESERVED_RED'), main.indexOf('// Game state'))
  const context = vm.createContext({
    stagedBoard: null,
    stageAction(action) { context.stagedBoard = applyBoardAction(state.board, action) },
    gameState: state, newGame, toKFEN, kfenToBoard, turnInProgress: false,
    clearSelection() {}, renderBoard() {}, setTimeout() {}, updateComputerStatus() {},
    canPerformAction() { return true }, prepareEngineTurn() {}
  })
  vm.runInContext(`const RED = 1, SILVER = 2;\n${reservations}\n` +
    ['setupLayout', 'setupClassicLayout', 'isValidMove', 'rotatePiece'].map(name => functionSource(main, name)).join('\n'), context)
  return context
}

const originalLaser = vm.createContext({ gameState: null })
vm.runInContext(originalMain.slice(originalMain.indexOf('const CARDINAL_VECTORS'), originalMain.indexOf('const LASER_THICKNESS')) +
  '\nconst BOARD_ROWS = 8, BOARD_COLS = 10;\n' +
  ['computeLaserPath', 'resolveLaserInteraction', 'findCurrentPlayerSphinx'].map(name => functionSource(originalMain, name)).join('\n'), originalLaser)

function random(seed) {
  return () => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return seed >>> 0
  }
}

// One shared, reproducible corpus for all three differential checks. Restart on a
// result or after 60 plies, cycling setups so games and later positions are represented.
const positions = []
const rng = random(0x4b484554)
let games = 0
while (positions.length < 300) {
  const pos = newGame(['classic', 'imhotep', 'dynasty'][games++ % 3])
  for (let ply = 0; ply < 60 && positions.length < 300; ply += 1) {
    const moves = legalMoves(pos)
    if (!moves.length) break
    pos.makeMove(parseMove(moves[rng() % moves.length], pos))
    positions.push(pos.clone())
  }
}

const CARDINAL = ['N', 'E', 'S', 'W']
const VECTORS = [[-1, 0], [0, 1], [1, 0], [0, -1]]
// Independent entry-face tables from ENGINE_SPEC section 3.
const PYRAMID_EXIT = [[1, 0, -1, -1], [-1, 2, 1, -1], [-1, -1, 3, 2], [3, -1, -1, 0]]
const SCARAB_EXIT = [[1, 0, 3, 2], [3, 2, 1, 0]]

function engineTrace(pos, color) {
  const { path, hit } = pos.traceLaser(color)
  let exit = null
  if (path.length && hit === -1) {
    const last = path.at(-1), piece = pos.pieceAt(last)
    if (path.length === 1 || !piece || piece.type === PYRAMID || piece.type === SCARAB) {
      let travel
      if (path.length === 1) travel = piece.o
      else {
        const previous = path.at(-2)
        const dr = Math.floor(last / 10) - Math.floor(previous / 10), dc = last % 10 - previous % 10
        travel = VECTORS.findIndex(([r, c]) => r === dr && c === dc)
        if (piece) travel = (piece.type === PYRAMID ? PYRAMID_EXIT : SCARAB_EXIT)[piece.o][(travel + 2) % 4]
      }
      assert.ok(travel >= 0)
      const [dr, dc] = VECTORS[travel]
      exit = { row: Math.floor(last / 10) + dr, col: last % 10 + dc, direction: CARDINAL[travel] }
      assert.ok(exit.row < 0 || exit.row >= 8 || exit.col < 0 || exit.col >= 10, 'Engine exited the board')
    }
  }
  return { path, hit, exit }
}

function gameTrace(state, color) {
  const segments = computeLaserPath(state, color)
  const sphinx = findSphinx(state, color)
  const path = sphinx ? [sphinx.row * 10 + sphinx.col] : []
  for (const segment of segments) {
    if (!segment.outOfBounds) path.push(segment.endRow * 10 + segment.endCol)
  }
  const last = segments.at(-1)
  return {
    path,
    hit: last?.destroyed ? last.hitRow * 10 + last.hitCol : -1,
    exit: last?.outOfBounds ? { row: last.endRow, col: last.endCol, direction: last.direction } : null
  }
}

function checkLaser(pos, color, label) {
  const state = kfenToBoard(toKFEN(pos))
  assert.deepEqual(gameTrace(state, color === RED ? 1 : 2), engineTrace(pos, color), label)
}

test('Live Classic start converts to the exact engine Classic KFEN', () => {
  const state = { board: Array.from({ length: 8 }, () => Array(10).fill(null)), currentPlayer: 2 }
  liveRules(state).setupClassicLayout()
  assert.equal(gameStateToKFEN(state), toKFEN(newGame('classic')))
})

test('Live scarab swap checks reservations for both pieces and both colours', () => {
  for (const player of [1, 2]) for (const type of ['pyramid', 'anubis']) {
    const from = player === 2 ? { row: 1, col: 9 } : { row: 6, col: 0 }
    const to = { row: from.row, col: player === 2 ? 8 : 1 }
    const state = { board: Array.from({ length: 8 }, () => Array(10).fill(null)), currentPlayer: player }
    const piece = { type: 'scarab', player, facing: 'NE' }
    const displaced = { type, player: player === 1 ? 2 : 1, facing: 'N' }
    state.board[from.row][from.col] = piece
    state.board[to.row][to.col] = displaced
    const rules = liveRules(state)
    assert.equal(rules.isValidMove(from.row, from.col, to.row, to.col, piece, displaced), false)
    displaced.player = player
    assert.equal(rules.isValidMove(from.row, from.col, to.row, to.col, piece, displaced), true)
    // Opposing piece may land on an unreserved origin.
    displaced.player = player === 1 ? 2 : 1
    assert.equal(rules.isValidMove(4, 4, 4, 5, piece, displaced), true)
    // The scarab itself may not enter an opposing reservation.
    assert.equal(rules.isValidMove(4, 4, 4, player === 1 ? 9 : 0, piece, displaced), false)
  }
})

test('300 seeded random positions: KFEN -> game board -> KFEN round trips', () => {
  for (const pos of positions) {
    const kfen = toKFEN(pos)
    const state = kfenToBoard(kfen)
    assert.equal(gameStateToKFEN(state), kfen)
    assert.equal(state.currentPlayer, pos.side === RED ? 1 : 2)
    assert.equal(state.ply, pos.ply)
  }
  console.log(`Bridge round trips: ${positions.length} positions from ${games} seeded random games`)
})

test('Every laser interaction: all entry faces, orientations, victim colours and shooters', () => {
  let shots = 0
  const emitters = [34, 45, 54, 43], target = 44
  const placed = (sq, type, color, o = 0) => ({ row: Math.floor(sq / 10), col: sq % 10, type, color, o })
  for (const shooter of [SILVER, RED]) {
    for (const type of [PYRAMID, SCARAB, ANUBIS, PHARAOH, SPHINX]) {
      const orientations = type === PHARAOH ? 1 : type === SCARAB ? 2 : 4
      for (let o = 0; o < orientations; o += 1) for (let face = 0; face < 4; face += 1) {
        for (const victim of [SILVER, RED]) {
          if (type === SPHINX && victim === shooter) continue
          const pos = fromPieces([placed(emitters[face], SPHINX, shooter, (face + 2) % 4), placed(target, type, victim, o)], shooter)
          checkLaser(pos, shooter, `type=${type} o=${o} entry=${face} victim=${victim} shooter=${shooter}`)
          shots += 1
          if (type === SCARAB) {
            // Both native aliases must have the same physical behaviour.
            const state = kfenToBoard(toKFEN(pos))
            state.board[4][4].facing = o === 0 ? 'SE' : 'SW'
            assert.deepEqual(gameTrace(state, shooter === RED ? 1 : 2), engineTrace(pos, shooter))
            assert.equal(gameStateToKFEN(state), toKFEN(pos))
          }
        }
      }
    }
    for (let o = 0; o < 4; o += 1) {
      checkLaser(fromPieces([placed(target, SPHINX, shooter, o)], shooter), shooter, `empty edge exit ${o}`)
      shots += 1
    }
    checkLaser(fromPieces([], shooter), shooter, 'missing emitter')
    shots += 1
  }
  console.log(`Laser interaction coverage: ${shots} shots, plus all scarab facing aliases`)
})

test('300 seeded random positions: live laser agrees with engine for both colours', () => {
  for (const [index, pos] of positions.entries()) {
    for (const color of [SILVER, RED]) checkLaser(pos, color, `position=${index} color=${color} ${toKFEN(pos)}`)
  }
  console.log(`Random laser parity: ${positions.length * 2} shots; paths, destroyed squares and exits agree`)
})

test('Extracted laser preserves the original live computation over the same corpus', () => {
  for (const pos of positions) for (const currentPlayer of [1, 2]) {
    const state = { ...kfenToBoard(toKFEN(pos)), currentPlayer }
    originalLaser.gameState = state
    // VM objects have different prototypes; JSON compares the complete segment data.
    assert.equal(JSON.stringify(computeLaserPath(state)), JSON.stringify(originalLaser.computeLaserPath()))
  }
})

test('Every engine legal move on 300 positions converts to a game action and back', () => {
  let count = 0
  const kinds = new Set(), directions = new Set()
  for (const pos of positions) {
    const state = kfenToBoard(toKFEN(pos)), before = JSON.stringify(state)
    const rules = liveRules(state)
    for (const move of legalMoves(pos)) {
      const action = engineMoveToGameAction(move, state)
      assert.equal(gameActionToEngineMove(action, state), move)
      kinds.add(action.kind)
      if (action.direction) directions.add(action.direction)
      const piece = state.board[action.from.row][action.from.col]
      if (action.kind !== 'rotate') {
        assert.equal(rules.isValidMove(action.from.row, action.from.col, action.to.row, action.to.col,
          piece, state.board[action.to.row][action.to.col]), true, move)
      } else {
        // Confirm physical rotation against the live function, not just text inversion.
        const facing = piece.facing
        rules.rotatePiece(action.from.row, action.from.col, action.direction === 'cw' ? 'right' : 'left')
        const rotatedPiece = rules.stagedBoard[action.from.row][action.from.col]
        assert.equal(piece.facing, facing, 'rotation stages without mutating the original piece')
        if (piece.type === 'pyramid' || piece.type === 'anubis') {
          const facings = piece.type === 'pyramid' ? ['NE', 'SE', 'SW', 'NW'] : CARDINAL
          assert.equal(rotatedPiece.facing, facings[(facings.indexOf(facing) + (action.direction === 'cw' ? 1 : 3)) % 4])
        } else if (piece.type === 'scarab') {
          assert.notEqual(resolveLaserInteraction({ ...piece, facing }, 'N').newDirection, resolveLaserInteraction(rotatedPiece, 'N').newDirection)
        } else {
          assert.equal(rotatedPiece.facing, CARDINAL[(CARDINAL.indexOf(facing) + (action.direction === 'cw' ? 1 : 3)) % 4])
        }
        piece.facing = facing
      }
      count += 1
    }
    assert.equal(JSON.stringify(state), before, 'Conversions do not mutate the game state')
  }
  assert.deepEqual([...kinds].sort(), ['move', 'rotate', 'swap'])
  assert.deepEqual([...directions].sort(), ['ccw', 'cw'])
  console.log(`Move round trips: ${count} legal moves; live movement and rotation checks agree`)
})

test('Sphinx canonical + describes the actual turn at both corners and supplied positions', () => {
  for (const [row, col, player, facing, expected] of [
    [0, 0, 1, 'S', 'ccw'], [0, 0, 1, 'E', 'cw'],
    [7, 9, 2, 'N', 'ccw'], [7, 9, 2, 'W', 'cw'],
    [4, 4, 2, 'N', 'cw'], [0, 4, 1, 'E', 'cw']
  ]) {
    const state = { board: Array.from({ length: 8 }, () => Array(10).fill(null)), currentPlayer: player }
    state.board[row][col] = { type: 'sphinx', player, facing }
    const move = String.fromCharCode(97 + col) + (8 - row) + '+'
    const action = engineMoveToGameAction(move, state)
    assert.equal(action.direction, expected)
    assert.equal(gameActionToEngineMove(action, state), move)
  }
  // Both rotations remain distinct when both first steps are on board.
  const pos = fromPieces([{ row: 4, col: 4, type: SPHINX, color: SILVER, o: 0 }], SILVER)
  const state = kfenToBoard(toKFEN(pos))
  const action = engineMoveToGameAction('e4-', state)
  assert.equal(action.direction, 'ccw')
  assert.equal(gameActionToEngineMove(action, state), 'e4-')
})

test('Bridge rejects invalid states and action notation; optional ply defaults to zero', () => {
  const state = kfenToBoard(toKFEN(newGame()))
  delete state.ply
  assert.equal(gameStateToKFEN(state), toKFEN(newGame()))
  assert.throws(() => kfenToBoard('10/10 s'))
  assert.throws(() => gameStateToKFEN({ ...state, currentPlayer: 0 }))
  assert.throws(() => gameStateToKFEN({ ...state, ply: -1 }))
  assert.throws(() => engineMoveToGameAction('z9+', state))
  assert.throws(() => engineMoveToGameAction('a8+', state)) // Opposing piece.
  assert.throws(() => gameActionToEngineMove({ kind: 'move', from: { row: 8, col: 0 } }, state))
  assert.throws(() => gameActionToEngineMove({ kind: 'rotate', from: { row: 7, col: 4 }, direction: 'cw' }, state))
  state.board[7][2].facing = 'N'
  assert.throws(() => gameStateToKFEN(state), /Invalid pyramid facing/)
})
