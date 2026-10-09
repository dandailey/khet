// Run after npm run build: node tools/play-ai-smoke.mjs
// Requires locally installed playwright-core and Chromium. Set CHROME_PATH if needed.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fromKFEN, legalMoves, applyMove, newGame, toKFEN } from '../packages/khet-engine/src/index.ts'
import { decodeState } from '../src/game/stateCodec.js'
import { gameStateToKFEN, engineMoveToGameAction, gameActionToEngineMove } from '../src/ai/bridge.js'
import { applyBoardAction } from '../src/game/moves.js'

let chromium
try {
  ;({ chromium } = await import('playwright-core'))
} catch {
  throw new Error('Install playwright-core locally, then run npm run build and node tools/play-ai-smoke.mjs. Set CHROME_PATH to a local Chromium executable.')
}
const executablePath = process.env.CHROME_PATH || chromium.executablePath()
assert.ok(existsSync(executablePath), `Chromium missing at ${executablePath}; set CHROME_PATH to an installed browser`)
const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] })
const errors = []
let seed = 0x4b484554
function randomIndex(length) {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed % length
}
function stateFromUrl(url) {
  const encoded = new URL(url).hash.match(/^#v=1\.s=(.+)$/)?.[1]
  assert.ok(encoded, 'persisted state in URL')
  return decodeState(encoded)
}
async function waitForHuman(page, minimumPly, humanSide = 2, allowGameOver = false) {
  await page.waitForFunction(() => {
    // UI lock covers both worker search and the normal laser animation.
    const board = document.getElementById('game-board')
    return board?.getAttribute('aria-busy') === 'false' &&
      document.getElementById('computer-status').classList.contains('hidden') &&
      !document.querySelector('.toast-error')
  }, null, { timeout: 20000 })
  const state = stateFromUrl(page.url())
  if (!state.gameOver) assert.equal(state.currentPlayer, humanSide, 'AI returned the turn to the human')
  assert.equal(state.ply, minimumPly, 'exactly one AI reply completed')
  if (!allowGameOver) assert.equal(state.gameOver, false, 'game remains playable')
  return state
}
async function openNewGame(page, state) {
  if (state.gameOver) await page.getByRole('button', { name: 'Play Again', exact: true }).click()
  else await page.locator('#reset-game').click()
}
async function clickAction(page, action, state) {
  const source = `[data-row="${action.from.row}"][data-col="${action.from.col}"]`
  await page.locator(source).dispatchEvent("click")
  if (action.kind === 'rotate') {
    const piece = state.board[action.from.row][action.from.col]
    const button = piece.type === 'sphinx' ? '.rotation-btn' :
      action.direction === 'cw' ? '.rotation-btn-cw' : '.rotation-btn-ccw'
    await page.locator(`${source} ${button}`).dispatchEvent("click")
  } else {
    await page.locator(`[data-row="${action.to.row}"][data-col="${action.to.col}"]`).dispatchEvent("click")
  }
}
async function boardPieces(page) {
  return page.locator('.square').evaluateAll(squares => squares.map(square => ({
    row: square.dataset.row, col: square.dataset.col,
    piece: square.querySelector('.piece-container:not(.staged-ghost) .piece')?.innerHTML || null
  })))
}
async function assertStaged(page, action, state) {
  const url = page.url()
  const before = await boardPieces(page)
  await clickAction(page, action, state)
  assert.deepEqual(stateFromUrl(page.url()), state, 'staging leaves saved game state unchanged')
  assert.equal(page.url(), url, 'staging does not persist a turn')
  assert.equal(await page.locator('#move-confirmation').isVisible(), true, 'Fire/Cancel bar is visible')
  assert.equal(await page.locator('.laser-path').count(), 0, 'staging never test-fires the laser')
  assert.equal(await page.locator('.staged-ghost').count(), action.kind === 'swap' ? 2 : 1, 'origin ghosts are visible')
  for (const button of ['#fire-laser', '#cancel-move']) {
    assert.ok((await page.locator(button).boundingBox()).height >= 44, 'confirmation buttons have phone-sized targets')
  }
  assert.notDeepEqual(await boardPieces(page), before, 'staged result appears on the board')
  await page.locator('#cancel-move').click()
  assert.deepEqual(await boardPieces(page), before, 'Cancel restores the board')
  assert.deepEqual(stateFromUrl(page.url()), state, 'Cancel leaves game state unchanged')
  assert.equal(await page.locator('#move-confirmation').isVisible(), false)
  await clickAction(page, action, state)
  await page.getByRole('button', { name: 'Fire laser', exact: true }).click()
  await page.locator('.laser-charge').waitFor({ state: 'attached', timeout: 5000 })
  assert.equal(await page.locator('.laser-path').count(), 0, 'charge precedes the beam')
  assert.equal(await page.locator('canvas.laser-particles').count(), 1, 'all impacts share one board canvas')
  await page.locator('.laser-path').first().waitFor({ state: 'attached', timeout: 5000 })
  assert.equal(await page.locator('.laser-charge').count(), 0, 'charge ring is cleaned up before the beam')
}
async function assertReplyDestination(page, before, after) {
  const action = await page.locator('#game-board').evaluate(board => JSON.parse(board.dataset.lastMove))
  const expected = applyBoardAction(before.board, action)
  const destination = action.to
  const piece = after.board[destination.row][destination.col]
  // A firing laser can destroy its own moved piece; the final state must agree
  // with the engine's complete turn as well as with the board's rendered piece.
  const engineMove = gameActionToEngineMove(action, before)
  const expectedKFEN = toKFEN(applyMove(fromKFEN(gameStateToKFEN(before)), engineMove))
  // The live game keeps the winner as side to move when a Pharaoh is hit.
  if (after.gameOver) assert.equal(gameStateToKFEN(after).split(' ')[0], expectedKFEN.split(' ')[0])
  else assert.equal(gameStateToKFEN(after), expectedKFEN)
  if (piece) assert.deepEqual(piece, expected[destination.row][destination.col], 'AI piece ends on its destination square')
  const square = page.locator(`[data-row="${destination.row}"][data-col="${destination.col}"]`)
  assert.equal(await square.locator('.piece-container:not(.staged-ghost) .piece').count(), piece ? 1 : 0, 'rendered AI destination matches final state')
  assert.equal(await square.evaluate(element => element.classList.contains('last-move')), true, 'last move remains highlighted')
  assert.equal(await page.locator('.move-animation').count(), 0, 'animation overlays are cleaned up')
}
try {
  for (const setup of ['classic', 'imhotep', 'dynasty']) {
    const context = await browser.newContext()
    // No network: cache the existing service detector as unavailable and block HTTP.
    await context.addInitScript(() => {
      sessionStorage.setItem('gamesync_available', 'false')
      sessionStorage.setItem('gamesync_check_time', String(Date.now()))
    })
    await context.route(/^https?:/, route => route.request().url().endsWith('/vite.svg') ? route.fulfill({ status: 200, contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg"/>' }) : (process.env.KHET_URL && new URL(route.request().url()).origin === new URL(process.env.KHET_URL).origin) ? route.continue() : route.abort())
    const page = await context.newPage()
    page.on('pageerror', error => errors.push(`${setup}: ${error.message}`))
    page.on('console', message => {
      if (message.type() === 'error') errors.push(`${setup}: ${message.text()}`)
    })
    await page.goto(process.env.KHET_URL || pathToFileURL(resolve('dist/index.html')).href)
    await page.locator('#new-game-overlay').waitFor({ state: 'visible' })
    await page.selectOption('#new-game-setup', setup)
    await page.selectOption('#new-game-mode', 'computer')
    await page.selectOption('#computer-level', '2')
    assert.equal(await page.locator('#computer-level option').count(), 10)
    await page.getByRole('button', { name: 'Start Game', exact: true }).click()
    let state = stateFromUrl(page.url())
    assert.equal(gameStateToKFEN(state), toKFEN(newGame(setup)))
    // Reload the real file URL to verify both state persistence and worker boot.
    await page.reload()
    await page.waitForFunction(() => document.querySelectorAll('.square').length === 80)
    state = stateFromUrl(page.url())
    assert.deepEqual(state.computer, { humanSide: 2, level: 2 })
    let humanTurns = 0, restarts = 0
    while (humanTurns < 10) {
      const pos = fromKFEN(gameStateToKFEN(state))
      // Random legal moves which permit a reply, avoiding an immediate game ending.
      const moves = legalMoves(pos).filter(move => {
        const next = applyMove(pos, move)
        return next.result === null && !next.hasWinInOne(next.side)
      })
      // Random play can force an early ending; keep counting completed replies
      // across fresh games rather than treating a legitimate win as a UI failure.
      if (state.gameOver || !moves.length) {
        assert.ok(restarts++ < 10, `${setup}: too many early endings`)
        await openNewGame(page, state)
        await page.getByRole('button', { name: 'Start Game', exact: true }).click()
        state = stateFromUrl(page.url())
        continue
      }
      const move = moves[randomIndex(moves.length)]
      const nextPly = state.ply + 2
      await assertStaged(page, engineMoveToGameAction(move, state), state)
      await page.waitForURL(url => stateFromUrl(url.href).ply === nextPly - 1, { timeout: 20000 })
      const beforeAI = stateFromUrl(page.url())
      await page.locator('.move-animation').first().waitFor({ state: 'attached', timeout: 20000 })
      // Wait for the human laser to finish and the AI turn to begin before checking idle.
      await page.waitForURL(url => stateFromUrl(url.href).ply >= nextPly, { timeout: 20000 })
      state = await waitForHuman(page, nextPly, 2, true)
      await assertReplyDestination(page, beforeAI, state)
      assert.equal(errors.length, 0, errors.join('\n'))
      humanTurns += 1
    }
    console.log(`${setup}: 10 human turns + 10 AI replies, level 2, staging/cancel/destination checks, file:// reload, no console/page errors`)
    // Red starts with a Silver AI move; reload while that search/animation is pending.
    await openNewGame(page, state)
    await page.selectOption('#computer-side', '1')
    await page.getByRole('button', { name: 'Start Game', exact: true }).click()
    await page.reload()
    await page.waitForURL(url => stateFromUrl(url.href).ply === 1, { timeout: 20000 })
    state = await waitForHuman(page, 1, 1)
    assert.deepEqual(state.computer, { humanSide: 1, level: 2 })
    assert.equal(errors.length, 0, errors.join('\n'))
    console.log(`${setup}: Red choice and reload during initial AI turn passed`)
    await context.close()
  }
  assert.deepEqual(errors, [])
  console.log('AI smoke: PASS (30 human turns, 33 AI replies, all three setups)')
} finally {
  await browser.close()
}
