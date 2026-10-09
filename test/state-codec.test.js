import test from 'node:test'
import assert from 'node:assert/strict'
import { newGame, toKFEN } from '../packages/khet-engine/src/index.ts'
import { gameStateToKFEN, kfenToBoard } from '../src/ai/bridge.js'
import { encodeState, decodeState, encodeFullState, decodeFullState } from '../src/game/stateCodec.js'

for (const setup of ['imhotep', 'dynasty']) {
  test(`${setup} starting layout shares losslessly through both state codecs`, () => {
    const state = { ...kfenToBoard(toKFEN(newGame(setup))), setup, gameOver: false, winner: null }
    for (const restored of [decodeState(encodeState(state)), decodeFullState(encodeFullState(state))]) {
      assert.deepEqual(restored.board, state.board)
      assert.equal(restored.currentPlayer, state.currentPlayer)
      assert.equal(restored.setup, setup)
      assert.equal(gameStateToKFEN(restored), gameStateToKFEN(state))
    }
  })
}

test('local computer options and ply survive reload; online states remain human only', () => {
  for (const humanSide of [1, 2]) for (const level of [1, 10]) {
    const state = { ...kfenToBoard(toKFEN(newGame())), setup: 'classic', computer: { humanSide, level }, ply: 0xfedcba98 }
    const restored = decodeState(encodeState(state))
    assert.deepEqual(restored.computer, state.computer)
    assert.equal(restored.ply, state.ply)
    assert.equal(decodeFullState(encodeFullState(state)).computer, null)
  }
})

test('legacy version 1 state links still decode', () => {
  const state = kfenToBoard(toKFEN(newGame()))
  const restored = decodeState(encodeState(state))
  assert.deepEqual(restored.board, state.board)
  assert.equal(restored.currentPlayer, state.currentPlayer)
  assert.equal(restored.computer, undefined)
})
