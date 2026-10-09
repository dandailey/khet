// Run after npm run build: node tools/play-ai-smoke.mjs
// Requires locally installed playwright-core and Chromium. Set CHROME_PATH if needed.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fromKFEN, legalMoves, applyMove, newGame, toKFEN } from '../packages/khet-engine/src/index.ts'
import { decodeState } from '../src/game/stateCodec.js'
import { gameStateToKFEN, engineMoveToGameAction } from '../src/ai/bridge.js'

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
      await clickAction(page, engineMoveToGameAction(move, state), state)
      const nextPly = state.ply + 2
      // Wait for the human laser to finish and the AI turn to begin before checking idle.
      await page.waitForURL(url => stateFromUrl(url.href).ply >= nextPly, { timeout: 20000 })
      state = await waitForHuman(page, nextPly, 2, true)
      assert.equal(errors.length, 0, errors.join('\n'))
      humanTurns += 1
    }
    console.log(`${setup}: 10 human turns + 10 AI replies, level 2, file:// reload, no console/page errors`)
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
