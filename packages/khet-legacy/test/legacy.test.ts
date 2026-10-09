import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import * as ai from '../src/ai_opponent_adapter.ts'
import * as main from '../src/main_js_adapter.ts'
import type { LState, SpecPiece, PieceType, Color, LegacyPiece, LegacyAdapter } from '../src/adapter_types.ts'
import { generateLegalMoves } from '../src/ai_opponent/rules.js'
import { traceLaser } from '../src/ai_opponent/laser.js'
import { resolveLaserInteraction, withGameState, computeLaserPath } from '../src/main_js/rules.js'

// Independently transcribed from ENGINE_SPEC.md section 6, not the legacy setup.
const classic: SpecPiece[] = [
  [0, 0, 'sphinx', 'red', 2], [0, 4, 'anubis', 'red', 2], [0, 5, 'pharaoh', 'red', 0],
  [0, 6, 'anubis', 'red', 2], [0, 7, 'pyramid', 'red', 1],
  [1, 2, 'pyramid', 'red', 2], [2, 3, 'pyramid', 'silver', 3],
  [3, 0, 'pyramid', 'red', 0], [3, 2, 'pyramid', 'silver', 2],
  [3, 4, 'scarab', 'red', 1], [3, 5, 'scarab', 'red', 0],
  [3, 7, 'pyramid', 'red', 1], [3, 9, 'pyramid', 'silver', 3],
  [4, 0, 'pyramid', 'red', 1], [4, 2, 'pyramid', 'silver', 3],
  [4, 4, 'scarab', 'silver', 0], [4, 5, 'scarab', 'silver', 1],
  [4, 7, 'pyramid', 'red', 0], [4, 9, 'pyramid', 'silver', 2],
  [5, 6, 'pyramid', 'red', 1], [6, 7, 'pyramid', 'silver', 0],
  [7, 2, 'pyramid', 'silver', 3], [7, 3, 'anubis', 'silver', 0],
  [7, 4, 'pharaoh', 'silver', 0], [7, 5, 'anubis', 'silver', 0], [7, 9, 'sphinx', 'silver', 0],
].map(entry => {
  const [row, col, type, color, o] = entry as [number, number, PieceType, Color, number]
  return { type, color, o, row, col }
})

function boardOf(pieces: SpecPiece[]): (SpecPiece | null)[] {
  const result = Array<SpecPiece | null>(80).fill(null)
  for (const piece of pieces) {
    assert.equal(result[piece.row * 10 + piece.col], null, 'duplicate square')
    result[piece.row * 10 + piece.col] = piece
  }
  return result
}

// Only explicitly documented setup differences are accepted. Any other drift fails.
function documentedClassic(name: 'main_js' | 'ai_opponent'): SpecPiece[] {
  return classic.map(piece => {
    const old = { ...piece }
    if (name === 'main_js' && piece.type === 'scarab') {
      old.color = piece.color === 'red' ? 'silver' : 'red'
      old.o = 1 - piece.o
    }
    if (name === 'ai_opponent') {
      const relocated: Record<number, number> = {
        7: 9, 30: 31, 32: 33, 40: 41, 42: 43, 67: 66, 72: 73, 73: 74, 74: 75, 75: 76,
      }
      const to = relocated[piece.row * 10 + piece.col]
      if (to !== undefined) { old.row = Math.floor(to / 10); old.col = to % 10 }
      if (piece.type === 'scarab') old.o = 0
    }
    return old
  })
}

function random(seed: number): () => number {
  return () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0)
}

function testAdapter<S extends LState>(
  name: 'main_js' | 'ai_opponent', adapter: LegacyAdapter<S>, seed: number, expectedCount: number,
): void {
  test(`${name}: adapters load and Classic matches except documented piece-by-piece differences`, t => {
    const state = adapter.legacyNewGame()
    assert.equal(state.currentPlayer, name === 'main_js' ? 2 : 'silver')
    const actual = boardOf(adapter.legacyToPieces(state))
    const expected = boardOf(classic)
    const documented = boardOf(documentedClassic(name))
    const differences: number[] = []
    for (let sq = 0; sq < 80; sq++) {
      if (JSON.stringify(actual[sq]) !== JSON.stringify(expected[sq])) differences.push(sq)
      assert.deepEqual(actual[sq], documented[sq], `unexpected setup drift at square ${sq}`)
    }
    assert.deepEqual(differences, name === 'main_js'
      ? [34, 35, 44, 45]
      : [7, 9, 30, 31, 32, 33, 34, 40, 41, 42, 43, 45, 66, 67, 72, 73, 74, 75, 76])
    t.diagnostic(`Documented Classic mismatch squares: ${differences.join(', ')}; see README.md`)
    assert.equal(adapter.legacyToPieces(state).length, 26)
    assert.equal(adapter.legacyLegalMoves(state).length, expectedCount)
  })

  test(`${name}: 50 random legal moves, immutable inputs, stable square paths`, () => {
    const nextRandom = random(seed)
    let state = adapter.legacyNewGame()
    for (let ply = 0; ply < 50; ply++) {
      assert.equal(state.gameOver, false, `seed ended before ply ${ply}`)
      const before = structuredClone(state)
      const moves = adapter.legacyLegalMoves(state)
      assert.ok(moves.length > 0)
      assert.deepEqual(moves, [...moves].sort())
      assert.equal(new Set(moves).size, moves.length)
      const move = moves[nextRandom() % moves.length]!
      assert.match(move, /^[a-j][1-8](?:[-x][a-j][1-8]|[+-](?:@[NESW]{1,2})?)$/)
      if (name === 'main_js') assert.ok(!move.includes('@'))
      const result = adapter.legacyApply(state, move)
      assert.deepEqual(state, before, 'input was mutated')
      assert.notStrictEqual(result.state, state)
      assert.equal(result.state.currentPlayer, name === 'main_js'
        ? state.currentPlayer === 2 ? 1 : 2
        : state.currentPlayer === 'silver' ? 'red' : 'silver')
      for (const sq of result.laser.path) assert.ok(Number.isInteger(sq) && sq >= 0 && sq < 80)
      assert.ok(result.laser.destroyed === -1 || result.laser.path.at(-1) === result.laser.destroyed)
      if (result.laser.destroyed !== -1) {
        const sq = result.laser.destroyed
        assert.equal(result.state.board[Math.floor(sq / 10)]![sq % 10], null)
      }
      state = result.state
    }
  })

  test(`${name}: separate games and failed actions cannot contaminate state`, () => {
    const first = adapter.legacyNewGame()
    const second = adapter.legacyNewGame()
    const before = structuredClone(second)
    assert.throws(() => adapter.legacyApply(first, 'a8-a8'), /Illegal legacy move/)
    adapter.legacyApply(first, adapter.legacyLegalMoves(first)[0]!)
    assert.deepEqual(second, before)
    assert.deepEqual(first, before)
  })
}

testAdapter('main_js', main, 0x12345678, 77)
testAdapter('ai_opponent', ai, 4, 114)

function empty<P extends 'silver' | 2>(player: P): LState<P> {
  return { currentPlayer: player, board: Array.from({ length: 8 }, () => Array(10).fill(null)), gameOver: false, winner: null }
}

test('AI: every native rotation has a unique, applicable label, including non-spec facings', () => {
  const state = ai.legacyNewGame()
  const native = generateLegalMoves(state, state.currentPlayer) as {
    type: string; from: { row: number; col: number }; newFacing?: string
  }[]
  const labels = ai.legacyLegalMoves(state)
  assert.equal(labels.length, native.length)
  assert.equal(new Set(labels).size, labels.length)
  for (const move of labels) ai.legacyApply(state, move)
  assert.ok(labels.includes('d1+@N')) // Cardinal pyramid orientation must survive unchanged.
  const rotated = ai.legacyApply(state, 'd1+@N').state
  assert.equal(rotated.board[7]![3]!.facing, 'N')
  assert.equal(ai.legacyToPieces(rotated).find(p => p.row === 7 && p.col === 3)!.o, -1)
})

test('AI: perimeter restrictions and unchecked swaps are preserved', () => {
  const state = empty('silver') as ai.LState
  state.board[1]![4] = { type: 'pharaoh', player: 'silver', facing: 'N' }
  assert.ok(!ai.legacyLegalMoves(state).includes('e7-e8'))
  state.board[1]![0] = { type: 'scarab', player: 'silver', facing: 'NE' }
  state.board[0]![0] = { type: 'pyramid', player: 'red', facing: 'SE' }
  assert.ok(ai.legacyLegalMoves(state).includes('a7xa8'))
  assert.equal(ai.legacyApply(state, 'a7xa8').state.board[0]![0]!.player, 'silver')
})

test('main.js: swap validates only the scarab destination, not the displaced piece', () => {
  const state = empty(2) as main.LState
  state.board[1]![9] = { type: 'scarab', player: 2, facing: 'NE' }
  state.board[1]![8] = { type: 'pyramid', player: 1, facing: 'SE' }
  assert.ok(main.legacyLegalMoves(state).includes('j7xi7'))
  assert.equal(main.legacyApply(state, 'j7xi7').state.board[1]![9]!.player, 1)
})

test('AI: Anubis front is destroyed and NE pyramid exits W instead of E', () => {
  const state = empty('silver') as ai.LState
  state.board[7]![9] = { type: 'sphinx', player: 'silver', facing: 'N' }
  state.board[6]![9] = { type: 'anubis', player: 'red', facing: 'S' }
  const front = traceLaser(state, 'silver') as { hits: { row: number; col: number; destroyed: boolean }[] }
  assert.deepEqual(front.hits.map(hit => [hit.row, hit.col, hit.destroyed]), [[6, 9, true]])
  state.board[7]![9] = null
  state.board[0]![0] = { type: 'sphinx', player: 'silver', facing: 'S' }
  state.board[6]![9] = null
  state.board[1]![0] = { type: 'pyramid', player: 'red', facing: 'NE' }
  const pyramid = traceLaser(state, 'silver') as { path: { row: number; col: number }[] }
  assert.deepEqual(pyramid.path.map(sq => sq.row * 10 + sq.col), [10]) // Wrong W exits immediately.
  assert.deepEqual(resolveLaserInteraction({ type: 'pyramid', facing: 'NE' }, 'N'), { type: 'reflect', newDirection: 'E' })
})

test('main.js: Anubis front absorbs and path normalization omits off-board endpoints', () => {
  const state = empty(2) as main.LState
  state.board[7]![9] = { type: 'sphinx', player: 2, facing: 'N' }
  state.board[6]![9] = { type: 'anubis', player: 1, facing: 'S' }
  // Move a separate own piece to trigger the unchanged beam.
  state.board[4]![4] = { type: 'pharaoh', player: 2, facing: 'N' }
  const result = main.legacyApply(state, 'e4-e5')
  assert.deepEqual(result.laser, { path: [69], destroyed: -1 })
  assert.equal(result.state.board[6]![9]!.type, 'anubis')
  state.board[6]![9] = null
  const exit = main.legacyApply(state, 'e4-e5')
  assert.deepEqual(exit.laser, { path: [69, 59, 49, 39, 29, 19, 9], destroyed: -1 })
})

test('both: destroying the opponent Pharaoh still awards the win to the opponent', () => {
  const mainState = empty(2) as main.LState
  mainState.board[7]![9] = { type: 'sphinx', player: 2, facing: 'N' }
  mainState.board[6]![9] = { type: 'pharaoh', player: 1, facing: 'N' }
  mainState.board[4]![4] = { type: 'pyramid', player: 2, facing: 'NE' }
  const aiState = empty('silver') as ai.LState
  aiState.board[7]![9] = { type: 'sphinx', player: 'silver', facing: 'N' }
  aiState.board[6]![9] = { type: 'pharaoh', player: 'red', facing: 'N' }
  aiState.board[4]![4] = { type: 'pyramid', player: 'silver', facing: 'NE' }
  const mainResult = main.legacyApply(mainState, 'e4+')
  const aiResult = ai.legacyApply(aiState, 'e4+')
  assert.equal(mainResult.state.winner, 1)
  assert.equal(aiResult.state.winner, 'red')
  for (const result of [mainResult, aiResult]) {
    assert.equal(result.state.gameOver, true)
    assert.deepEqual(result.laser, { path: [69], destroyed: 69 })
  }
  assert.deepEqual(main.legacyLegalMoves(mainResult.state), [])
  assert.ok(ai.legacyLegalMoves(aiResult.state).length > 0) // Native generator has no terminal gate.
})

test('main.js: synchronous state binding restores previous state even on exceptions', () => {
  const state = main.legacyNewGame()
  withGameState(state, () => {
    const before = computeLaserPath()
    assert.throws(() => withGameState(empty(2), () => { throw new Error('probe') }), /probe/)
    assert.deepEqual(computeLaserPath(), before)
  })
})

// Extraction oracle: evaluate the original git blob, replacing only DOM/animation
// helpers. Its original move/rotate/fire/hit/turn callbacks still execute.
test('main.js: extraction agrees with original source for 50 plies and all UI move choices', () => {
  const source = readFileSync(new URL('./fixtures/main.js.txt', import.meta.url), 'utf8')
  const highlighted: string[] = []
  const buttons: { className?: string; click?: (e: { stopPropagation(): void }) => void }[] = []
  const container = { appendChild() {} }
  let segments: { endRow: number; endCol: number; outOfBounds?: boolean; destroyed?: boolean; hitRow?: number; hitCol?: number }[] = []
  const document = {
    addEventListener() {},
    querySelector(selector: string) {
      return { querySelector: () => container, classList: { add() { highlighted.push(selector) } } }
    },
    createElement() {
      const element = { className: '', appendChild() {}, addEventListener(_name: string, click: (e: { stopPropagation(): void }) => void) { this.click = click }, click: undefined as undefined | ((e: { stopPropagation(): void }) => void) }
      buttons.push(element)
      return element
    },
  }
  const oracle = runInNewContext(source.replace('import "./style.css"', '') + `
    clearSelection = () => { gameState.selectedPiece = null; gameState.selectedSquare = null }
    renderBoard = clearLaserLayer = updateLaserTipGlow = persistLaserPath = addDestructionAnimation = showGameOverOverlay = () => {}
    renderLaserPath = capturePath;
    ({
      setState(state) { gameState = state; laserActive = false },
      getState() { return gameState },
      setupClassicLayout, showMoveOptions, addPieceControls, movePiece, rotatePiece
    })
  `, {
    document, console: { log() {} },
    setTimeout(fn: () => void) { fn(); return 1 }, clearTimeout() {},
    capturePath(path: typeof segments) { segments = path },
  }) as {
    setState(s: main.LState): void; getState(): main.LState
    setupClassicLayout(): void; showMoveOptions(row: number, col: number, piece: LegacyPiece): void
    addPieceControls(row: number, col: number, piece: LegacyPiece): void
    movePiece(a: number, b: number, c: number, d: number): void
    rotatePiece(row: number, col: number, direction: string): void
  }
  let state = main.legacyNewGame()
  const oracleStart = structuredClone(state)
  oracleStart.board = Array.from({ length: 8 }, () => Array(10).fill(null))
  oracle.setState(oracleStart)
  oracle.setupClassicLayout()
  assert.deepEqual(structuredClone(oracle.getState()), state)
  const nextRandom = random(0x12345678)
  for (let ply = 0; ply < 50; ply++) {
    const choices = new Map<string, () => void>()
    oracle.setState(structuredClone(state))
    state.board.forEach((rank, row) => rank.forEach((piece, col) => {
      if (!piece || piece.player !== state.currentPlayer) return
      const from = `${String.fromCharCode(97 + col)}${8 - row}`
      highlighted.length = 0
      oracle.showMoveOptions(row, col, piece)
      for (const selector of highlighted) {
        const [, r, c] = selector.match(/data-row="(\d+)"\]\[data-col="(\d+)"/)!
        const toRow = Number(r), toCol = Number(c)
        const text = `${from}${state.board[toRow]![toCol] ? 'x' : '-'}${String.fromCharCode(97 + toCol)}${8 - toRow}`
        choices.set(text, () => oracle.movePiece(row, col, toRow, toCol))
      }
      buttons.length = 0
      oracle.addPieceControls(row, col, piece)
      for (const button of buttons.filter(b => b.click)) {
        const suffix = piece.type === 'scarab' || piece.type === 'sphinx' || button.className?.endsWith('-cw') ? '+' : '-'
        choices.set(`${from}${suffix}`, () => button.click!({ stopPropagation() {} }))
      }
    }))
    const legal = main.legacyLegalMoves(state)
    assert.deepEqual([...choices.keys()].sort(), legal, `UI move choices at ply ${ply}`)
    const text = legal[nextRandom() % legal.length]!
    choices.get(text)!()
    const result = main.legacyApply(state, text)
    assert.deepEqual(result.state, structuredClone(oracle.getState()), `native state after ${text}`)
    const hit = segments.find(s => s.destroyed)
    assert.deepEqual(result.laser, structuredClone({
      path: segments.filter(s => !s.outOfBounds).map(s => s.endRow * 10 + s.endCol),
      destroyed: hit ? hit.hitRow! * 10 + hit.hitCol! : -1,
    }))
    state = result.state
  }
})

test('AI modules are unchanged git-blob copies', () => {
  const checksums: Record<string, string> = {
    types: '815608bde36a617b6396e77a978c15d7f98f9e5c635b5560bddd58c5f2cd0ca2',
    state: 'fb654acc9b8db538b7c0c04ee6a1c26796f1a1c7bfd3eca9e77966899ccfe665',
    rules: '4d57271ad40715693ef669578db6ffc567df4f4e1d90ef6323985cdfcbd7760d',
    laser: 'e18e6360d07fde211c5c9a5d6f92a0d1b9063394024f0ef354f1eabb6aee04e8',
  }
  for (const [name, checksum] of Object.entries(checksums)) {
    const bytes = readFileSync(new URL(`../src/ai_opponent/${name}.js`, import.meta.url))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), checksum, `${name}.js was modified`)
  }
  const fixture = readFileSync(new URL('./fixtures/main.js.txt', import.meta.url))
  assert.equal(createHash('sha256').update(fixture).digest('hex'),
    'fecd6fdd50c034b31a2e0b1ecd1d1f1f128a95afce003818552de4b48c1f00da')
})

test('missing Sphinx: main.js keeps the mover, AI composition switches the mover', () => {
  const mainState = empty(2) as main.LState
  mainState.board[4]![4] = { type: 'pyramid', player: 2, facing: 'NE' }
  const mainResult = main.legacyApply(mainState, 'e4+')
  assert.equal(mainResult.state.currentPlayer, 2)
  assert.deepEqual(mainResult.laser, { path: [], destroyed: -1 })
  const aiState = empty('silver') as ai.LState
  aiState.board[4]![4] = { type: 'pyramid', player: 'silver', facing: 'NE' }
  const aiResult = ai.legacyApply(aiState, 'e4+')
  assert.equal(aiResult.state.currentPlayer, 'red')
  assert.deepEqual(aiResult.laser, { path: [], destroyed: -1 })
})
