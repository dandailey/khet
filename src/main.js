// Khet - Laser Chess Main Entry Point

import "./style.css"
import { encodeState, decodeState, encodeFullState, decodeFullState } from './game/stateCodec.js'
import QRCode from 'qrcode'
import * as GameSync from './game/gameSync.js'
import { LEVELS, applyMove, fromKFEN, newGame, toKFEN } from '../packages/khet-engine/src/index.ts'
import { engineMoveToGameAction, gameActionToEngineMove, gameStateToKFEN, kfenToBoard } from './ai/bridge.js'
import AIWorker from './ai/ai-worker.js?worker&inline'
import { applyBoardAction, actionFromTurn } from './game/moves.js'
import { animationMs, prefersReducedMotion } from './game/animation.js'
import { createLaserEffects } from './game/laserEffects.js'
import { CARDINAL_VECTORS, computeLaserPath as traceGameLaser, findSphinx } from './game/laser.js'

// Direction helpers (clockwise starting at north)
const DIRECTIONS = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315
}

const LASER_THICKNESS_PERCENT = 8.57 // Percentage of square size (6/70 * 100)
const BOARD_ROWS = 8
const BOARD_COLS = 10

const RED = 1
const SILVER = 2

const RESERVED_RED = new Set([
  "0-0",
  "0-8",
  "1-0",
  "2-0",
  "3-0",
  "4-0",
  "5-0",
  "6-0",
  "7-0",
  "7-8"
])

const RESERVED_SILVER = new Set([
  "0-1",
  "0-9",
  "1-9",
  "2-9",
  "3-9",
  "4-9",
  "5-9",
  "6-9",
  "7-1",
  "7-9"
])

// Game state
let gameState = {
  currentPlayer: SILVER,  // Silver (blue) goes first
  selectedPiece: null,
  selectedSquare: null,
  board: [],
  setup: 'classic',
  computer: null,
  ply: 0,
  gameOver: false,
  winner: null,
  actionTaken: false, // Track if player has taken an action this turn
  // Sync state embedded in game state for serialization
  sync: {
    redId: null,      // Client ID of red player
    silverId: null,   // Client ID of silver player
    lastTurnId: 0,    // Incrementing turn ID
    turnHistory: []   // Recent turn history for summaries
  }
}

// Sync context (local only, not serialized)
const syncContext = {
  enabled: false,           // Is online sync enabled?
  serviceAvailable: false,  // Is GameSync service available?
  sessionId: null,          // Current session ID
  version: null,            // Current session version
  localSide: null,          // 'red' or 'silver' - which side we're playing
  isHost: false,            // Are we the host?
  syncStatus: 'offline',    // 'offline', 'online', 'waiting', 'your_turn', 'opponent_turn'
  lastSeenTurnId: 0         // Last turn ID we've acknowledged
}

let laserLayerElement = null
let laserEffects = null
let activeLaserTimeout = null
let listenersAttached = false
let laserActive = false
let isLoadingFromHash = false
let boardResizeObserver = null
let turnOverlayVisible = false
let aiWorker = null
let aiThinking = false
let aiFailed = false
let turnInProgress = false
let actionLaserTimeout = null
let gameOverOverlayTimeout = null
let pendingEngineTurn = null
let stagedAction = null
let stagedBoard = null
let lastMove = null
let activeMoveAnimations = []
let replayingOnlineMove = false

function cancelComputerTurn() {
  if (aiWorker) aiWorker.terminate()
  aiWorker = null
  aiThinking = false
  aiFailed = false
  turnInProgress = false
  pendingEngineTurn = null
  pendingMoveInfo = null
  stagedAction = null
  stagedBoard = null
  lastMove = null
  replayingOnlineMove = false
  clearOpponentAnimation()
  updateMoveConfirmation()
  for (const timer of [actionLaserTimeout, activeLaserTimeout, gameOverOverlayTimeout]) {
    if (timer) clearTimeout(timer)
  }
  actionLaserTimeout = null
  activeLaserTimeout = null
  gameOverOverlayTimeout = null
  laserActive = false
  clearLaserLayer()
  updateComputerStatus()
}

function updateComputerStatus() {
  const indicator = document.getElementById('computer-status')
  indicator.classList.toggle('hidden', !aiThinking)
  indicator.textContent = aiThinking ? 'Computer is thinking...' : ''
  document.getElementById('game-board').setAttribute('aria-busy', String(aiThinking || turnInProgress))
}

function canPerformAction() {
  if (gameState.gameOver || laserActive || turnInProgress || aiThinking) return false
  return ensureLocalTurn()
}

// Capture the engine's entire turn (action plus laser) before the UI mutates pieces.
function prepareEngineTurn(action) {
  if (!gameState.computer || syncContext.enabled) return
  const before = gameStateToKFEN(gameState)
  const move = gameActionToEngineMove(action, gameState)
  pendingEngineTurn = { move, expected: toKFEN(applyMove(fromKFEN(before), move)) }
}

function checkComputerConsistency() {
  if (!pendingEngineTurn) return
  const actual = gameStateToKFEN(gameState)
  const { expected, move } = pendingEngineTurn
  if (actual.split(' ')[0] !== expected.split(' ')[0]) {
    console.error('Computer turn placement mismatch', { actual, expected, move })
  }
  pendingEngineTurn = null
}

function maybeStartComputerTurn() {
  if (!gameState.computer || syncContext.enabled || gameState.gameOver || aiFailed ||
      aiThinking || turnInProgress || gameState.currentPlayer === gameState.computer.humanSide) return
  aiThinking = true
  clearSelection()
  updateComputerStatus()
  const fail = () => {
    if (aiWorker) aiWorker.terminate()
    aiWorker = null
    aiThinking = false
    aiFailed = true
    updateComputerStatus()
    showToast('Computer unavailable. You can play the remaining turns locally.', 'error')
  }
  try {
    const worker = new AIWorker()
    aiWorker = worker
    worker.onerror = (event) => {
      event.preventDefault()
      if (aiWorker !== worker) return
      fail()
    }
    worker.onmessageerror = () => {
      if (aiWorker === worker) fail()
    }
    worker.onmessage = ({ data }) => {
      if (aiWorker !== worker) return
      worker.terminate()
      aiWorker = null
      aiThinking = false
      try {
        if (data.error || !data.move) throw new Error(data.error || 'No computer move')
        const action = engineMoveToGameAction(data.move, gameState)
        const moveInfo = moveInfoForAction(action)
        prepareEngineTurn(action)
        animateOpponentAction(action, () => handleFireLaser(moveInfo))
        updateComputerStatus()
      } catch {
        fail()
      }
    }
    const seed = crypto.getRandomValues(new Uint32Array(1))[0]
    worker.postMessage({ kfen: gameStateToKFEN(gameState), level: gameState.computer.level, seed })
  } catch {
    fail()
  }
}

// Dev mode: enable history-based state management for testing encoding/decoding
// Set via URL parameter: ?dev=true or localStorage: khet-dev-mode=true
const DEV_MODE = new URLSearchParams(window.location.search).get('dev') === 'true' || 
                 localStorage.getItem('khet-dev-mode') === 'true'

// Make DEV_MODE available globally for stateCodec
if (typeof window !== 'undefined') {
  window.DEV_MODE = DEV_MODE
}

// =============================================================================
// TURN MANAGEMENT & SYNC HELPERS
// =============================================================================

/**
 * Check if it's the local player's turn
 */
function isLocalPlayersTurn() {
  if (!syncContext.enabled && gameState.computer && !aiFailed) {
    return gameState.currentPlayer === gameState.computer.humanSide
  }
  if (!syncContext.enabled || !syncContext.localSide) {
    return true // Local mode - always your turn
  }
  const localNumeric = syncContext.localSide === 'red' ? RED : SILVER
  return gameState.currentPlayer === localNumeric
}

/**
 * Check if it's the opponent's turn (online mode only)
 */
function isOpponentsTurn() {
  if (!syncContext.enabled || !syncContext.localSide) {
    return false
  }
  return !isLocalPlayersTurn()
}

/**
 * Guard function - returns false and shows message if not local player's turn
 */
function ensureLocalTurn(reason = "It's not your turn yet.") {
  if (isLocalPlayersTurn()) {
    return true
  }
  showTurnBlockedToast(reason)
  return false
}

/**
 * Show toast when action is blocked due to turn
 */
function showTurnBlockedToast(message) {
  showToast(message, 'info')
}

/**
 * Get the current player's side name
 */
function getCurrentPlayerSide() {
  return gameState.currentPlayer === RED ? 'red' : 'silver'
}

/**
 * Get the local player's numeric ID
 */
function getLocalPlayerNumericId() {
  return syncContext.localSide === 'red' ? RED : SILVER
}

/**
 * Record a turn in history
 */
function recordTurn(moveData) {
  gameState.sync.lastTurnId++
  const turnEntry = {
    id: gameState.sync.lastTurnId,
    player: getCurrentPlayerSide(),
    timestamp: Date.now(),
    ...moveData
  }
  
  // Keep only last 5 turns
  gameState.sync.turnHistory.push(turnEntry)
  if (gameState.sync.turnHistory.length > 5) {
    gameState.sync.turnHistory.shift()
  }
  
  return turnEntry
}

/**
 * Get recent opponent turns we haven't seen
 */
function getUnseenOpponentTurns() {
  if (!syncContext.localSide) return []
  const opponentSide = syncContext.localSide === 'red' ? 'silver' : 'red'
  return gameState.sync.turnHistory.filter(
    turn => turn.player === opponentSide && turn.id > syncContext.lastSeenTurnId
  )
}

/**
 * Mark all turns as seen
 */
function markTurnsSeen() {
  syncContext.lastSeenTurnId = gameState.sync.lastTurnId
}

/**
 * Format a move for display
 */
function formatMoveDescription(turnEntry) {
  if (!turnEntry) return ''
  
  const player = turnEntry.player === 'red' ? 'Red' : 'Silver'
  let desc = `${player} `
  
  if (turnEntry.rotation) {
    desc += `rotated a piece`
  } else if (turnEntry.from && turnEntry.to) {
    desc += `moved a piece`
  } else {
    desc += `made a move`
  }
  
  if (turnEntry.destroyed) {
    const destroyed = turnEntry.destroyed === 'pharaoh' ? 'Pharaoh' : 'piece'
    desc += ` and destroyed a ${destroyed}!`
  }
  
  return desc
}

/**
 * Update sync status based on current state
 */
function updateSyncStatus() {
  if (!syncContext.enabled) {
    syncContext.syncStatus = 'offline'
  } else if (gameState.gameOver) {
    syncContext.syncStatus = 'online'
  } else if (!gameState.sync.redId || !gameState.sync.silverId) {
    syncContext.syncStatus = 'waiting'
  } else if (isLocalPlayersTurn()) {
    syncContext.syncStatus = 'your_turn'
  } else {
    syncContext.syncStatus = 'opponent_turn'
  }
}

/**
 * Check if board should be rotated (red player perspective)
 */
function shouldRotateBoard() {
  if (syncContext.enabled && syncContext.localSide) {
    return syncContext.localSide === 'red'
  }
  if (gameState.computer && !aiFailed) return gameState.computer.humanSide === RED
  // In local mode, rotate when red is current player
  return gameState.currentPlayer === RED
}

/**
 * Transform coordinates for board rotation
 * When rotated, (row, col) -> (7-row, 9-col)
 */
function transformCoords(row, col) {
  if (shouldRotateBoard()) {
    return { row: 7 - row, col: 9 - col }
  }
  return { row, col }
}

/**
 * Inverse transform coordinates (for click handling)
 */
function inverseTransformCoords(row, col) {
  if (shouldRotateBoard()) {
    return { row: 7 - row, col: 9 - col }
  }
  return { row, col }
}

/**
 * Transform facing direction for board rotation
 * N->S, E->W, NE->SW, SE->NW, etc.
 */
function transformFacing(facing) {
  if (!shouldRotateBoard()) {
    return facing
  }
  
  const facingMap = {
    'N': 'S',
    'S': 'N',
    'E': 'W',
    'W': 'E',
    'NE': 'SW',
    'SW': 'NE',
    'NW': 'SE',
    'SE': 'NW'
  }
  
  return facingMap[facing] || facing
}

// Initialize the game
async function initGame(skipHash = false) {
  cancelComputerTurn()
  console.log('Initializing Khet game...')
  
  // Initialize GameSync service detection (non-blocking)
  try {
    const initPromise = GameSync.initialize()
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 2000))
    const result = await Promise.race([initPromise, timeoutPromise])
    
    console.log('[GameSync] Init result:', result)
    
    if (result) {
      syncContext.serviceAvailable = result.available
      console.log('[GameSync] Service available:', result.available)
    }
  } catch (error) {
    console.log('GameSync service check failed:', error)
    syncContext.serviceAvailable = false
  }
  
  // Check for session param in URL
  const urlParams = new URLSearchParams(window.location.search)
  const sessionParam = urlParams.get('session')
  const roleParam = urlParams.get('role')
  
  if (sessionParam && syncContext.serviceAvailable) {
    // Attempt to join existing session
    const joined = await tryJoinSession(sessionParam, roleParam)
    if (joined) {
      ensureLaserLayer()
      clearLaserLayer()
      renderBoard()
      setupBoardResizeObserver()
      setupEventListeners()
      updateSyncStatusUI()
      maybeShowTurnOverlay()
      console.log('Game loaded from online session!')
      return
    }
    // Join failed, continue to local mode
    showToast('Could not join session. Starting local game.', 'info')
  } else if (syncContext.serviceAvailable && !skipHash) {
    // Try to restore previous session from localStorage
    const restored = await tryRestoreSync()
    if (restored) {
      ensureLaserLayer()
      clearLaserLayer()
      renderBoard()
      setupBoardResizeObserver()
      setupEventListeners()
      startSyncPolling()
      updateSyncStatusUI()
      maybeShowTurnOverlay()
      console.log('Restored previous online session!')
      return
    }
  }
  
  // Check for state in URL hash first (unless skipping hash for reset)
  if (!skipHash) {
    const hashState = loadStateFromHash()
    if (hashState) {
      gameState = hashState
      // Ensure sync state exists
      if (!gameState.sync) {
        gameState.sync = { redId: null, silverId: null, lastTurnId: 0, turnHistory: [] }
      }
      ensureLaserLayer()
      clearLaserLayer()
      renderBoard()
      setupBoardResizeObserver()
      setupEventListeners()
      updateSyncStatusUI()
      console.log('Game loaded from URL hash!')
      maybeStartComputerTurn()
      return
    }
  }
  
  // Create empty board (8 rows x 10 columns)
  gameState.gameOver = false
  gameState.winner = null
  gameState.selectedPiece = null
  gameState.selectedSquare = null
  gameState.computer = null
  gameState.board = Array(8)
    .fill(null)
    .map(() => Array(10).fill(null))
  
  // Reset sync state
  gameState.sync = { redId: null, silverId: null, lastTurnId: 0, turnHistory: [] }
  
  // Set up initial piece positions (Classic setup)
  setupClassicLayout()
  
  ensureLaserLayer()
  clearLaserLayer()

  // Render the board
  renderBoard()
  setupBoardResizeObserver()
  
  // Set up event listeners
  setupEventListeners()
  
  // Update URL hash with initial state
  updateUrlHash()
  
  updateSyncStatusUI()
  showNewGameOptions()
  console.log('Game initialized!')
}

// All starting layouts come from the engine's SETUPS through the bridge.
function setupLayout(setup = 'classic') {
  Object.assign(gameState, kfenToBoard(toKFEN(newGame(setup))))
  gameState.setup = setup
}

function setupClassicLayout() {
  setupLayout('classic')
}

let newGameOnline = false

function showNewGameOptions(online = false) {
  newGameOnline = online
  document.getElementById('new-game-title').textContent = online ? 'New Online Game' : 'New Game'
  document.getElementById('new-game-setup').value = gameState.setup || 'classic'
  const mode = document.getElementById('new-game-mode')
  // Default to the computer opponent: most games are played against the AI.
  mode.value = online ? 'local' : 'computer'
  mode.disabled = online
  document.getElementById('computer-side').value = gameState.computer?.humanSide || SILVER
  document.getElementById('computer-level').value = gameState.computer?.level || 5
  updateComputerOptions()
  document.getElementById('new-game-overlay').classList.remove('hidden')
}

function updateComputerOptions() {
  document.getElementById('computer-options').classList.toggle('hidden',
    document.getElementById('new-game-mode').value !== 'computer')
}

function startLocalGame(setup, computer = null) {
  cancelComputerTurn()
  disableOnlinePlay()
  gameState.gameOver = false
  gameState.winner = null
  gameState.actionTaken = false
  gameState.selectedPiece = null
  gameState.selectedSquare = null
  gameState.computer = computer
  gameState.sync = { redId: null, silverId: null, lastTurnId: 0, turnHistory: [] }
  setupLayout(setup)
  hideGameOverOverlay()
  clearLaserLayer()
  renderBoard()
  updateUrlHash()
  maybeStartComputerTurn()
}

// Render the game board
function renderBoard() {
  const boardElement = document.getElementById('game-board')
  updateMoveConfirmation()
  boardElement.dataset.lastMove = lastMove ? JSON.stringify(lastMove) : ''
  for (const name of ['chargeMs', 'beamMs', 'impactMs', 'shieldMs', 'flashMs', 'shakeMs', 'tipPulseMs']) {
    boardElement.style.setProperty(`--${name}`, `${animationMs(name)}ms`)
  }
  document.body.style.setProperty('--flashMs', `${animationMs('flashMs')}ms`)
  document.body.style.setProperty('--shakeMs', `${animationMs('shakeMs')}ms`)
  boardElement.innerHTML = ''
  ensureLaserLayer()
  // Don't clear laser layer if game is over (keep winning laser path visible)
  if (!gameState.gameOver) {
    clearLaserLayer()
  }
  
  // Apply rotation transform for red player
  const rotate = shouldRotateBoard()
  if (rotate) {
    boardElement.style.transform = 'rotate(180deg)'
  } else {
    boardElement.style.transform = ''
  }
  
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const square = document.createElement('div')
      square.className = 'square'
      // Store original coordinates in data attributes
      square.dataset.row = row
      square.dataset.col = col
      
      // Alternate square colors
      square.classList.add((row + col) % 2 === 0 ? 'light' : 'dark')

      const squareKey = `${row}-${col}`
      if (RESERVED_RED.has(squareKey)) {
        square.classList.add('reserve-red')
      }
      if (RESERVED_SILVER.has(squareKey)) {
        square.classList.add('reserve-silver')
      }
      
      // Add piece if present
      const piece = (stagedBoard || gameState.board)[row][col]
      if (lastMove && [lastMove.from, lastMove.to].some(point => point && point.row === row && point.col === col)) {
        square.classList.add('last-move')
      }
      if (piece) {
        const pieceContainer = document.createElement('div')
        pieceContainer.className = 'piece-container'
        
        // Counter-rotate pieces so they appear upright when board is rotated
        if (rotate) {
          pieceContainer.style.transform = 'rotate(180deg)'
        }
        
        const pieceElement = document.createElement('div')
        pieceElement.className = `piece player${piece.player}`
        const isActivePlayer = piece.player === gameState.currentPlayer
        
        // Transform facing for display
        const displayPiece = { ...piece, facing: transformFacing(piece.facing) }
        pieceElement.innerHTML = getPieceSVG(displayPiece, isActivePlayer)
        
        pieceContainer.appendChild(pieceElement)
        square.appendChild(pieceContainer)
        
        // Add player piece styling for current player
        if (piece.player === gameState.currentPlayer) {
          square.classList.add('player-piece')
        } else {
          square.classList.add('not-player-piece')
        }
      }
      
      if (stagedAction && (stagedAction.from.row === row && stagedAction.from.col === col ||
          stagedAction.kind === 'swap' && stagedAction.to.row === row && stagedAction.to.col === col)) {
        const ghost = document.createElement('div')
        ghost.className = 'piece-container staged-ghost'
        if (rotate) ghost.style.transform = 'rotate(180deg)'
        const original = gameState.board[row][col]
        ghost.innerHTML = `<div class="piece player${original.player}">${getPieceSVG({ ...original, facing: transformFacing(original.facing) })}</div>`
        ghost.setAttribute('aria-hidden', 'true')
        square.appendChild(ghost)
        square.classList.add('staged-origin')
      }
      boardElement.appendChild(square)
    }
  }
  
  // Update grid positioning based on display coordinates
  updateBoardDimensions()
  // Add laser tip glow for current player's sphinx
  addLaserTipGlow()
}

// Add laser tip glow effect around current player's sphinx
function addLaserTipGlow() {
  if (gameState.gameOver) return
  
  const sphinxInfo = findCurrentPlayerSphinx()
  if (!sphinxInfo) return
  
  const { row, col, facing } = sphinxInfo
  const boardElement = document.getElementById('game-board')
  if (!boardElement) return
  
  const boardRect = boardElement.getBoundingClientRect()
  const squareWidth = boardRect.width / BOARD_COLS
  const squareHeight = boardRect.height / BOARD_ROWS
  
  // Calculate the position of the laser tip based on sphinx facing
  const squareCenter = getSquareCenter(row, col, boardRect)
  if (!squareCenter) return
  
  // Transform facing for display when board is rotated
  const displayFacing = transformFacing(facing)
  
  // Calculate laser tip position based on facing direction
  // SVG size is 60px, center is 30px, tip is at center - 20 = 10px from top when facing North
  // Piece is 82% of square, so actual rendered size is 0.82 * squareSize
  // SVG scales to fit: 20px in SVG (60px viewBox) = 20/60 * 0.82 * squareSize
  // For 70px square: 20/60 * 0.82 * 70 = ~19.13px, but we'll use the ratio directly
  const squareWidthPercent = 100 / BOARD_COLS
  const squareHeightPercent = 100 / BOARD_ROWS
  // Tip offset accounts for SVG scaling: 20px in 60px SVG, scaled by 0.82 piece size
  const tipOffsetRatio = (20 / 60) * 0.82 // Ratio of square size
  const tipOffsetPercentX = tipOffsetRatio * squareWidthPercent
  const tipOffsetPercentY = tipOffsetRatio * squareHeightPercent
  const directionVector = CARDINAL_VECTORS[displayFacing]
  const tipXPercent = squareCenter.x + directionVector.col * tipOffsetPercentX
  const tipYPercent = squareCenter.y + directionVector.row * tipOffsetPercentY
  
  // Create glow element
  const glowElement = document.createElement('div')
  glowElement.className = 'laser-tip-glow'
  // Glow is 40px originally = 57.14% of 70px square
  // Convert to percentage of board dimensions
  const glowWidthPercent = (40 / 70) * squareWidthPercent
  const glowHeightPercent = (40 / 70) * squareHeightPercent
  glowElement.style.width = `${glowWidthPercent}%`
  glowElement.style.height = `${glowHeightPercent}%`
  glowElement.style.left = `${tipXPercent - (glowWidthPercent / 2)}%`
  glowElement.style.top = `${tipYPercent - (glowHeightPercent / 2)}%`
  
  // Counter-rotate the glow when board is rotated so it stays in visual position
  if (shouldRotateBoard()) {
    glowElement.style.transform = 'rotate(180deg)'
  }
  
  // Add to board
  boardElement.appendChild(glowElement)
  
  // If laser is active, add the active class
  if (laserActive) {
    glowElement.classList.add('active')
  }
}

// Update laser tip glow state
function updateLaserTipGlow() {
  const glowElement = document.querySelector('.laser-tip-glow')
  if (!glowElement) return
  
  if (laserActive) {
    glowElement.classList.add('active')
  } else {
    glowElement.classList.remove('active')
  }
}

// Create SVG for a piece based on type and facing
function getPieceSVG(piece, isActivePlayer = false) {
  const size = 60
  const center = size / 2
  const rotation = getRotationDegrees(piece.facing)

  switch (piece.type) {
    case 'sphinx':
      return createSphinxSVG(size, center, rotation, piece.player, isActivePlayer)
    case 'pharaoh':
      return createPharaohSVG(size, center, piece.player)
    case 'pyramid':
      return createPyramidSVG(size, center, piece.facing, piece.player)
    case 'anubis':
      return createAnubisSVG(size, center, rotation, piece.player)
    case 'scarab':
      return createScarabSVG(size, center, piece.facing, piece.player)
    default:
      return ''
  }
}

function getRotationDegrees(facing) {
  switch (facing) {
    case 'N': return 0
    case 'NE': return 45
    case 'E': return 90
    case 'SE': return 135
    case 'S': return 180
    case 'SW': return 225
    case 'W': return 270
    case 'NW': return 315
    default: return 0
  }
}

function createSphinxSVG(size, center, rotation, player, isActivePlayer = false) {
  const head = `M ${center} ${center - 20} L ${center + 22} ${center + 20} L ${center - 22} ${center + 20} Z`
  const activeClass = isActivePlayer ? ' active-player' : ''
  return `
    <svg viewBox="0 0 ${size} ${size}" class="piece-svg player${player}${activeClass}">
      <path d="${head}" class="piece-body" transform="rotate(${rotation} ${center} ${center})" />
      <polygon points="${center},${center - 20} ${center + 10},${center} ${center - 10},${center}" class="piece-tip" transform="rotate(${rotation} ${center} ${center})" />
    </svg>
  `
}

function createPharaohSVG(size, center, player) {
  const width = size * 0.62
  const height = size * 0.64
  const left = center - width / 2
  const right = center + width / 2
  const top = center - height / 2
  const bottom = center + height / 2
  const gemRadius = size * 0.055

  // Body outline - an elongated pentagon/headdress shape
  const bodyPath = [
    `M ${left} ${bottom - size * 0.08}`,
    `Q ${center - width * 0.62} ${top + height * 0.28} ${center} ${top}`,
    `Q ${center + width * 0.62} ${top + height * 0.28} ${right} ${bottom - size * 0.08}`,
    `L ${center + width * 0.42} ${bottom}`,
    `L ${center - width * 0.42} ${bottom}`,
    'Z'
  ].join(' ')

  const lineWidth = size * 0.4
  const lineLeft = center - lineWidth / 2
  const lineRight = center + lineWidth / 2
  const lineTop = center - height * 0.43
  const lineBottom = center + height * 0.28

  return `
    <svg viewBox="0 0 ${size} ${size}" class="piece-svg player${player}">
      <path d="${bodyPath}" class="piece-body" />
      <line x1="${lineLeft}" y1="${lineTop}" x2="${lineLeft}" y2="${lineBottom}" class="pharaoh-line" />
      <line x1="${lineRight}" y1="${lineTop}" x2="${lineRight}" y2="${lineBottom}" class="pharaoh-line" />
      <path d="M ${lineLeft} ${lineBottom} Q ${center} ${lineBottom + size * 0.1} ${lineRight} ${lineBottom}" class="pharaoh-arc" />
      <circle cx="${center}" cy="${lineBottom}" r="${gemRadius}" class="pharaoh-gem" />
    </svg>
  `
}

function createPyramidSVG(size, center, facing, player) {
  const offset = size * 0.36
  let vertices = []

  // Pyramids: the facing direction indicates where the HYPOTENUSE (mirror) points
  // The 90° corner is on the opposite side from where the arrow points
  // The hypotenuse connects the two corners adjacent to the arrow direction
  
  switch (facing) {
    case 'NE':
      // Arrow points NE (↗), so 90° corner at lower-left
      // Hypotenuse runs from upper-left to lower-right (perpendicular to NE)
      vertices = [
        [center - offset, center + offset],  // lower-left (90° corner)
        [center - offset, center - offset],  // upper-left (hypotenuse end)
        [center + offset, center + offset]   // lower-right (hypotenuse end)
      ]
      break
    case 'NW':
      // Arrow points NW (↖), so 90° corner at lower-right
      // Hypotenuse runs from upper-right to lower-left (perpendicular to NW)
      vertices = [
        [center + offset, center + offset],  // lower-right (90° corner)
        [center + offset, center - offset],  // upper-right (hypotenuse end)
        [center - offset, center + offset]   // lower-left (hypotenuse end)
      ]
      break
    case 'SE':
      // Arrow points SE (↘), so 90° corner at upper-left
      // Hypotenuse runs from upper-right to lower-left (perpendicular to SE)
      vertices = [
        [center - offset, center - offset],  // upper-left (90° corner)
        [center + offset, center - offset],  // upper-right (hypotenuse end)
        [center - offset, center + offset]   // lower-left (hypotenuse end)
      ]
      break
    case 'SW':
      // Arrow points SW (↙), so 90° corner at upper-right
      // Hypotenuse runs from upper-left to lower-right (perpendicular to SW)
      vertices = [
        [center + offset, center - offset],  // upper-right (90° corner)
        [center - offset, center - offset],  // upper-left (hypotenuse end)
        [center + offset, center + offset]   // lower-right (hypotenuse end)
      ]
      break
    default:
      vertices = [
        [center - offset, center + offset],
        [center - offset, center - offset],
        [center + offset, center - offset]
      ]
  }

  const points = vertices.map(([x, y]) => `${x},${y}`).join(' ')

  let mirrorStart = null
  let mirrorEnd = null
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    const dx = Math.abs(a[0] - b[0])
    const dy = Math.abs(a[1] - b[1])
    if (dx > 0.1 && dy > 0.1) {
      mirrorStart = a
      mirrorEnd = b
      break
    }
  }

  return `
    <svg viewBox="0 0 ${size} ${size}" class="piece-svg player${player}">
      <polygon points="${points}" class="piece-body" />
      ${mirrorStart ? `<line x1="${mirrorStart[0]}" y1="${mirrorStart[1]}" x2="${mirrorEnd[0]}" y2="${mirrorEnd[1]}" class="mirror-line" />` : ''}
    </svg>
  `
}

function createAnubisSVG(size, center, rotation, player) {
  const frontWidth = size * 0.42
  const rearWidth = size * 0.22
  const depth = size * 0.24
  const trapezoid = `M ${center - frontWidth} ${center - depth} L ${center + frontWidth} ${center - depth} L ${center + rearWidth} ${center + depth} L ${center - rearWidth} ${center + depth} Z`
  return `
    <svg viewBox="0 0 ${size} ${size}" class="piece-svg player${player}">
      <path d="${trapezoid}" class="piece-body" transform="rotate(${rotation} ${center} ${center})" />
      <line x1="${center - frontWidth}" y1="${center - depth}" x2="${center + frontWidth}" y2="${center - depth}" class="blocker-line" transform="rotate(${rotation} ${center} ${center})" />
      <line x1="${center - rearWidth}" y1="${center + depth}" x2="${center + rearWidth}" y2="${center + depth}" class="piece-detail" transform="rotate(${rotation} ${center} ${center})" />
    </svg>
  `
}

function createScarabSVG(size, center, facing, player) {
  const length = size * 0.90
  const thickness = size * 0.20
  const innerThickness = thickness - 4
  const halfLength = length / 2
  const halfThickness = thickness / 2

  const createSlash = (angle) => `
    <g transform="rotate(${angle} ${center} ${center})">
      <rect x="${center - halfLength}" y="${center - halfThickness}" width="${length}" height="${thickness}" class="piece-body scarab-outer" rx="${halfThickness}" />
      <rect x="${center - halfLength}" y="${center - innerThickness / 2}" width="${length}" height="${innerThickness}" class="piece-body scarab-inner" rx="${innerThickness / 2}" />
      <line x1="${center - halfLength + halfThickness}" y1="${center - halfThickness}" x2="${center + halfLength - halfThickness}" y2="${center - halfThickness}" class="mirror-line" stroke-width="2.5" />
      <line x1="${center - halfLength + halfThickness}" y1="${center + halfThickness}" x2="${center + halfLength - halfThickness}" y2="${center + halfThickness}" class="mirror-line" stroke-width="2.5" />
    </g>
  `

  const angle = facing === 'NE' || facing === 'SE' ? 45 : -45

  return `
    <svg viewBox="0 0 ${size} ${size}" class="piece-svg player${player}">
      ${createSlash(angle)}
    </svg>
  `
}

// Set up event listeners
function setupEventListeners() {
  const boardElement = document.getElementById('game-board')
  const resetGameBtn = document.getElementById('reset-game')
  const playAgainBtn = document.getElementById('play-again-btn')
  
  if (!listenersAttached) {
    boardElement.addEventListener('click', handleSquareClick)
    resetGameBtn.addEventListener('click', handleResetGame)
    playAgainBtn.addEventListener('click', handlePlayAgain)
    document.addEventListener('click', handleDocumentClick)
    document.getElementById('fire-laser').addEventListener('click', confirmStagedMove)
    document.getElementById('cancel-move').addEventListener('click', cancelStagedMove)
    document.addEventListener('keydown', handleMoveKeydown)
    
    const levelSelect = document.getElementById('computer-level')
    for (const { level, name } of LEVELS) {
      const option = document.createElement('option')
      option.value = level
      option.textContent = `${level} — ${name}`
      levelSelect.appendChild(option)
    }
    document.getElementById('new-game-mode').addEventListener('change', updateComputerOptions)
    document.getElementById('cancel-new-game').addEventListener('click', () => {
      document.getElementById('new-game-overlay').classList.add('hidden')
    })
    document.getElementById('new-game-form').addEventListener('submit', (event) => {
      event.preventDefault()
      const setup = document.getElementById('new-game-setup').value
      const computer = document.getElementById('new-game-mode').value === 'computer' ? {
        humanSide: Number(document.getElementById('computer-side').value),
        level: Number(document.getElementById('computer-level').value)
      } : null
      document.getElementById('new-game-overlay').classList.add('hidden')
      if (newGameOnline) hostOnlineGame(setup)
      else startLocalGame(setup, computer)
    })

    // Share menu listeners
    const shareMenuBtn = document.getElementById('share-menu-btn')
    const shareMenu = document.getElementById('share-menu')
    const copyLinkBtn = document.getElementById('copy-link-btn')
    const copySessionIdBtn = document.getElementById('copy-session-id-btn')
    const shareBtn = document.getElementById('share-btn')
    const showQrBtn = document.getElementById('show-qr-btn')
    const pasteLinkBtn = document.getElementById('paste-link-btn')
    const qrCopyBtn = document.getElementById('qr-copy-btn')
    const qrCloseBtn = document.getElementById('qr-close-btn')
    
    if (shareMenuBtn && shareMenu) {
      shareMenuBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        toggleShareMenu()
      })
    }
    
    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', () => {
        copyGameLink()
        hideShareMenu()
      })
    }
    if (copySessionIdBtn) {
      copySessionIdBtn.addEventListener('click', () => {
        copySessionId()
        hideShareMenu()
      })
    }
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        shareGameLink()
        hideShareMenu()
      })
    }
    if (showQrBtn) {
      showQrBtn.addEventListener('click', () => {
        showQRCode()
        hideShareMenu()
      })
    }
    if (pasteLinkBtn) {
      pasteLinkBtn.addEventListener('click', () => {
        pasteOpponentLink()
        hideShareMenu()
      })
    }
    if (qrCopyBtn) qrCopyBtn.addEventListener('click', copyGameLink)
    if (qrCloseBtn) qrCloseBtn.addEventListener('click', hideQRCode)
    
    // Online play buttons
    const playOnlineBtn = document.getElementById('play-online-btn')
    const inviteBtn = document.getElementById('invite-btn')
    const leaveOnlineBtn = document.getElementById('leave-online-btn')
    const closeInviteBtn = document.getElementById('close-invite-btn')
    const copyCodeBtn = document.getElementById('copy-code-btn')
    const copyInviteLinkBtn = document.getElementById('copy-invite-link-btn')
    const startTurnBtn = document.getElementById('start-turn-btn')
    
    if (playOnlineBtn) {
      playOnlineBtn.addEventListener('click', () => {
        hideShareMenu()
        showNewGameOptions(true)
      })
    }
    
    if (inviteBtn) {
      inviteBtn.addEventListener('click', () => {
        hideShareMenu()
        showInviteModal()
      })
    }
    
    if (leaveOnlineBtn) {
      leaveOnlineBtn.addEventListener('click', () => {
        hideShareMenu()
        disableOnlinePlay()
        showToast('Left online game', 'info')
      })
    }
    
    if (closeInviteBtn) {
      closeInviteBtn.addEventListener('click', hideInviteModal)
    }
    
    if (copyCodeBtn) {
      copyCodeBtn.addEventListener('click', copySessionCode)
    }
    
    if (copyInviteLinkBtn) {
      copyInviteLinkBtn.addEventListener('click', copyInviteLink)
    }
    
    if (startTurnBtn) {
      startTurnBtn.addEventListener('click', hideTurnOverlay)
    }
    
    listenersAttached = true
  }
}

// Handle document clicks (for canceling piece selection when clicking outside board)
function handleDocumentClick(event) {
  if (gameState.gameOver) return
  
  // Check if the click is outside the game board
  const boardElement = document.getElementById('game-board')
  const clickedInsideBoard = boardElement.contains(event.target)
  
  // If clicking outside the board and we have a piece selected, cancel selection
  if (!clickedInsideBoard && gameState.selectedPiece) {
    clearSelection()
  }
  
  // Close share menu if clicking outside it
  const shareMenu = document.getElementById('share-menu')
  const shareMenuContainer = document.querySelector('.share-menu-container')
  if (shareMenu && shareMenuContainer && !shareMenuContainer.contains(event.target)) {
    hideShareMenu()
  }
}

// Share menu functions
function toggleShareMenu() {
  const shareMenu = document.getElementById('share-menu')
  if (shareMenu) {
    shareMenu.classList.toggle('hidden')
    updateBoardDimensions()
  }
}

function hideShareMenu() {
  const shareMenu = document.getElementById('share-menu')
  if (shareMenu) {
    shareMenu.classList.add('hidden')
    updateBoardDimensions()
  }
}

// Handle square clicks
function handleSquareClick(event) {
  if (gameState.gameOver || laserActive || turnInProgress || aiThinking) return
  if (!ensureLocalTurn("Wait for your opponent to finish their turn")) return
  
  const square = event.target.closest('.square')
  if (!square) {
    // Clicked on board but not on a square - cancel piece selection
    if (gameState.selectedPiece) {
      clearSelection()
    }
    return
  }
  
  // Get original coordinates (already stored correctly in dataset)
  let row = parseInt(square.dataset.row)
  let col = parseInt(square.dataset.col)
  // A staged piece at its destination still selects its original source.
  if (stagedAction) {
    const action = stagedAction
    if (action.kind !== 'rotate' && row === action.to.row && col === action.to.col) {
      row = action.from.row
      col = action.from.col
    }
    cancelStagedMove()
  }
  const piece = gameState.board[row][col]
  
  console.log(`Clicked square (${row}, ${col})`)
  
  // If no piece selected yet
  if (!gameState.selectedPiece) {
    // Only allow selecting current player's pieces
    if (piece && piece.player === gameState.currentPlayer) {
      selectPiece(row, col, piece)
    }
  } else {
    // Piece is selected, handle move or rotation
    if (square.classList.contains('moveable')) {
      // Moving to a highlighted square
      movePiece(gameState.selectedSquare.row, gameState.selectedSquare.col, row, col)
    } else if (piece && piece.player === gameState.currentPlayer) {
      // Check if clicking the same piece (cancel) or a different piece
      if (row === gameState.selectedSquare.row && col === gameState.selectedSquare.col) {
        // Clicking the same piece - cancel selection
        clearSelection()
      } else {
        // Selecting a different piece
        clearSelection()
        selectPiece(row, col, piece)
      }
    } else {
      // Clicking empty square or opponent piece - cancel selection
      clearSelection()
    }
  }
}

// Select a piece and show move options
function selectPiece(row, col, piece) {
  gameState.selectedPiece = piece
  gameState.selectedSquare = { row, col }
  
  // Highlight selected square
  const square = document.querySelector(`[data-row="${row}"][data-col="${col}"]`)
  square.classList.add('selected')
  
  // Show move options
  showMoveOptions(row, col, piece)
  
  // Add rotation controls and cancel button
  addPieceControls(row, col, piece)
}

// Clear piece selection
function clearSelection() {
  if (gameState.selectedSquare) {
    const square = document.querySelector(`[data-row="${gameState.selectedSquare.row}"][data-col="${gameState.selectedSquare.col}"]`)
    square.classList.remove('selected')
    removePieceControls()
  }
  
  gameState.selectedPiece = null
  gameState.selectedSquare = null
  clearMoveHighlights()
}

// Show move options around selected piece
function showMoveOptions(row, col, piece) {
  const directions = [
    [-1, -1], [-1, 0], [-1, 1],  // Top row
    [0, -1],           [0, 1],   // Middle row (skip center)
    [1, -1],  [1, 0],  [1, 1]    // Bottom row
  ]
  
  directions.forEach(([dr, dc]) => {
    const newRow = row + dr
    const newCol = col + dc
    
    // Check bounds
    if (newRow >= 0 && newRow < 8 && newCol >= 0 && newCol < 10) {
      const square = document.querySelector(`[data-row="${newRow}"][data-col="${newCol}"]`)
      const targetPiece = gameState.board[newRow][newCol]
      
      // Check if move is valid
      if (isValidMove(row, col, newRow, newCol, piece, targetPiece)) {
        square.classList.add('moveable')
      }
    }
  })
}

// Check if a move is valid
function isValidMove(fromRow, fromCol, toRow, toCol, piece, targetPiece) {
  // Can't move to same square
  if (fromRow === toRow && fromCol === toCol) return false
  
  // Check reserved squares - pieces cannot move to squares of the opposite color
  const squareKey = `${toRow}-${toCol}`
  if (gameState.currentPlayer === RED && RESERVED_SILVER.has(squareKey)) return false
  if (gameState.currentPlayer === SILVER && RESERVED_RED.has(squareKey)) return false
  
  // Sphinx cannot move
  if (piece.type === 'sphinx') return false
  
  // If target square is empty, it's valid
  if (!targetPiece) return true
  
  // Scarab can swap with Pyramid or Anubis
  if (piece.type === 'scarab' && (targetPiece.type === 'pyramid' || targetPiece.type === 'anubis')) {
    const sourceKey = `${fromRow}-${fromCol}`
    if (targetPiece.player === RED && RESERVED_SILVER.has(sourceKey)) return false
    if (targetPiece.player === SILVER && RESERVED_RED.has(sourceKey)) return false
    return true
  }
  
  // Can't move to occupied square (except scarab swaps)
  return false
}

// Clear move highlights
function clearMoveHighlights() {
  document.querySelectorAll('.moveable').forEach(square => {
    square.classList.remove('moveable')
  })
}

// Add rotation controls and cancel button
function addPieceControls(row, col, piece) {
  const square = document.querySelector(`[data-row="${row}"][data-col="${col}"]`)
  const pieceContainer = square.querySelector('.piece-container')
  
  // Only add rotation controls if piece can rotate
  if (piece.type !== 'pharaoh') {
    if (piece.type === 'sphinx') {
      // Sphinx shows directional arrow pointing where it WOULD fire after clicking
      // Add button directly to piece container (not wrapped in rotation-controls div)
      let arrowSymbol = ''
      let rotationDirection = ''
      let buttonClass = 'rotation-btn'
      
      if (row === 0 && col === 0) {
        // Red sphinx in top-left: can face E or S
        if (piece.facing === 'E') {
          // Currently facing East, clicking rotates to South
          arrowSymbol = '↓' // South arrow (where it would fire after rotation)
          rotationDirection = 'right'
          buttonClass = 'rotation-btn rotation-btn-bottom' // Position on bottom edge
        } else {
          // Currently facing South, clicking rotates to East
          arrowSymbol = '→' // East arrow (where it would fire after rotation)
          rotationDirection = 'left'
          buttonClass = 'rotation-btn rotation-btn-right' // Position on right edge
        }
      } else if (row === 7 && col === 9) {
        // Silver sphinx in bottom-right: can face W or N
        if (piece.facing === 'W') {
          // Currently facing West, clicking rotates to North
          arrowSymbol = '↑' // North arrow (where it would fire after rotation)
          rotationDirection = 'right'
          buttonClass = 'rotation-btn rotation-btn-top' // Position on top edge
        } else {
          // Currently facing North, clicking rotates to West
          arrowSymbol = '←' // West arrow (where it would fire after rotation)
          rotationDirection = 'left'
          buttonClass = 'rotation-btn rotation-btn-left' // Position on left edge
        }
      }
      
      const rotateBtn = document.createElement('button')
      rotateBtn.className = buttonClass
      rotateBtn.textContent = arrowSymbol
      rotateBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        rotatePiece(row, col, rotationDirection)
      })
      pieceContainer.appendChild(rotateBtn)
    } else {
      // Other pieces have both left and right rotation buttons wrapped in a container
      const rotationControls = document.createElement('div')
      rotationControls.className = 'rotation-controls'
      // Other pieces have both left and right rotation buttons
      const rotateLeftBtn = document.createElement('button')
      rotateLeftBtn.className = 'rotation-btn rotation-btn-ccw'
      rotateLeftBtn.textContent = '⤴'
      rotateLeftBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        rotatePiece(row, col, 'left')
      })
      
      const rotateRightBtn = document.createElement('button')
      rotateRightBtn.className = 'rotation-btn rotation-btn-cw'
      rotateRightBtn.textContent = '⤵'
      rotateRightBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        rotatePiece(row, col, 'right')
      })
      
      rotationControls.appendChild(rotateLeftBtn)
      rotationControls.appendChild(rotateRightBtn)
      pieceContainer.appendChild(rotationControls)
    }
  }
}

// Remove piece controls
function removePieceControls() {
  // Remove rotation controls wrappers (for non-sphinx pieces)
  document.querySelectorAll('.rotation-controls').forEach(el => {
    el.remove()
  })
  // Remove individual rotation buttons (for sphinx pieces)
  document.querySelectorAll('.rotation-btn-top, .rotation-btn-bottom, .rotation-btn-left, .rotation-btn-right').forEach(el => {
    el.remove()
  })
}

// Human input only stages an action; Fire is the sole commit point.
function movePiece(fromRow, fromCol, toRow, toCol) {
  if (!canPerformAction()) return
  const target = gameState.board[toRow][toCol]
  stageAction({ kind: target ? 'swap' : 'move', from: { row: fromRow, col: fromCol }, to: { row: toRow, col: toCol } })
}

function rotatePiece(row, col, direction) {
  if (!canPerformAction()) return
  stageAction({ kind: 'rotate', from: { row, col }, to: { row, col }, direction: direction === 'right' ? 'cw' : 'ccw' })
}

function stageAction(action) {
  clearSelection()
  stagedAction = action
  stagedBoard = applyBoardAction(gameState.board, action)
  lastMove = null
  renderBoard()
}

function updateMoveConfirmation() {
  document.getElementById('move-confirmation').classList.toggle('hidden', !stagedAction)
}

function cancelStagedMove() {
  stagedAction = null
  stagedBoard = null
  clearSelection()
  renderBoard()
}

function handleMoveKeydown(event) {
  if (!stagedAction || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return
  if (event.target.closest('input, select, textarea, [contenteditable="true"], [role="dialog"]') ||
      document.querySelector('.game-over-overlay:not(.hidden), .qr-overlay:not(.hidden), .invite-modal:not(.hidden)')) return
  if (event.key === 'Enter' || event.key === 'Escape') {
    event.preventDefault()
    if (event.key === 'Enter') confirmStagedMove()
    else cancelStagedMove()
  }
}

function moveInfoForAction(action) {
  const piece = gameState.board[action.from.row][action.from.col]
  const player = gameState.currentPlayer === RED ? 'red' : 'silver'
  return action.kind === 'rotate'
    ? { player, rotation: true, piece: piece?.type, from: action.from, direction: action.direction === 'cw' ? 'right' : 'left' }
    : { player, from: action.from, to: action.to, piece: piece?.type, swap: action.kind === 'swap' }
}

function confirmStagedMove() {
  if (!stagedAction || !canPerformAction()) return
  const action = stagedAction
  const moveInfo = moveInfoForAction(action)
  prepareEngineTurn(action)
  stagedAction = null
  stagedBoard = null
  clearSelection()
  turnInProgress = true
  lastMove = action
  gameState.board = applyBoardAction(gameState.board, action)
  updateComputerStatus()
  renderBoard()
  actionLaserTimeout = setTimeout(() => handleFireLaser(moveInfo), animationMs('fireDelayMs'))
}

function clearOpponentAnimation() {
  for (const animation of activeMoveAnimations) animation.cancel()
  activeMoveAnimations = []
  document.querySelectorAll('.move-animation').forEach(element => element.remove())
  document.querySelectorAll('.animating-piece').forEach(element => element.classList.remove('animating-piece'))
}

// Keep the board unchanged beneath overlay copies until their motion finishes.
function animateOpponentAction(action, fireLaser) {
  stagedAction = null
  stagedBoard = null
  clearSelection()
  turnInProgress = true
  lastMove = action
  updateComputerStatus()
  renderBoard()
  actionLaserTimeout = setTimeout(() => {
    const duration = animationMs(action.kind === 'rotate' ? 'rotateMs' : 'moveMs')
    const board = document.getElementById('game-board')
    const source = document.querySelector(`[data-row="${action.from.row}"][data-col="${action.from.col}"]`)
    const target = document.querySelector(`[data-row="${action.to.row}"][data-col="${action.to.col}"]`)
    if (gameState.board[action.from.row][action.from.col].type === 'sphinx') {
      document.querySelector('.laser-tip-glow')?.remove()
    }
    const slide = (origin, destination, lane = 0) => {
      const container = origin.querySelector('.piece-container')
      const overlay = document.createElement('div')
      overlay.className = 'move-animation'
      overlay.setAttribute('aria-hidden', 'true')
      Object.assign(overlay.style, { left: `${origin.offsetLeft}px`, top: `${origin.offsetTop}px`, width: `${origin.offsetWidth}px`, height: `${origin.offsetHeight}px` })
      overlay.appendChild(container.cloneNode(true))
      board.appendChild(overlay)
      container.classList.add('animating-piece')
      const dx = destination.offsetLeft - origin.offsetLeft
      const dy = destination.offsetTop - origin.offsetTop
      const frames = action.kind === 'rotate'
        ? [{ transform: 'rotate(0deg)' }, { transform: `rotate(${action.direction === 'cw' ? 90 : -90}deg)` }]
        : [{ transform: 'translate(0, 0)' },
          { transform: `translate(${dx / 2 - dy * lane}px, ${dy / 2 + dx * lane}px)` },
          { transform: `translate(${dx}px, ${dy}px)` }]
      activeMoveAnimations.push(overlay.animate(frames, { duration, easing: 'ease-in-out', fill: 'forwards' }))
    }
    slide(source, target, action.kind === 'swap' ? 0.18 : 0)
    if (action.kind === 'swap') slide(target, source, 0.18)
    actionLaserTimeout = setTimeout(() => {
      clearOpponentAnimation()
      gameState.board = applyBoardAction(gameState.board, action)
      renderBoard()
      actionLaserTimeout = setTimeout(fireLaser, animationMs('holdMs'))
    }, duration)
  }, animationMs('highlightMs'))
}

// End current player's turn
function endTurn(moveInfo = null) {
  turnInProgress = false
  gameState.ply = (gameState.ply ?? 0) + 1
  gameState.actionTaken = true
  gameState.currentPlayer = gameState.currentPlayer === RED ? SILVER : RED
  checkComputerConsistency()
  renderBoard()
  updateUrlHash()
  
  // Sync if online
  if (syncContext.enabled && moveInfo) {
    endTurnAndSync(moveInfo)
  }
  updateComputerStatus()
  maybeStartComputerTurn()
}

// Store move info between calls (set by handleFireLaser)
let pendingMoveInfo = null

// Handle laser firing
function handleFireLaser(moveInfo = null, onComplete = null) {
  if (gameState.gameOver) return
  if (laserActive) return
  
  // Store move info for use after laser animation
  pendingMoveInfo = moveInfo
  
  const path = computeLaserPath()
  if (!path || path.length === 0) {
    if (onComplete) onComplete()
    else endTurn(moveInfo)
    return
  }

  laserActive = true
  clearLaserLayer()
  const endpoint = path[path.length - 1]
  const complete = () => {
    activeLaserTimeout = null
    clearShotPresentation()
    if (!gameState.gameOver) {
      clearLaserLayer()
    }
    laserActive = false
    // Update laser tip glow back to normal state
    updateLaserTipGlow()
    if (onComplete) {
      pendingMoveInfo = null
      onComplete()
      return
    }
    if (gameState.gameOver) {
      turnInProgress = false
      gameState.ply = (gameState.ply ?? 0) + 1
      checkComputerConsistency()
      updateComputerStatus()
      updateUrlHash()
      // Show the game over overlay after a brief delay to let the laser remain visible
      stopSyncPolling()
      const completedMove = pendingMoveInfo
      gameOverOverlayTimeout = setTimeout(() => {
        showGameOverOverlay()
        // Final sync after game over
        if (syncContext.enabled) {
          endTurnAndSync(completedMove)
        }
      }, animationMs('gameOverMs'))
    } else {
      endTurn(pendingMoveInfo)
    }
    pendingMoveInfo = null
  }
  startLaserCharge(path[0])
  activeLaserTimeout = setTimeout(() => {
    clearShotPresentation()
    renderLaserPath(path)
    updateLaserTipGlow()
    activeLaserTimeout = setTimeout(() => {
      addLaserImpact(endpoint)
      if (endpoint.hit && endpoint.hitPiece) {
        handleLaserHit(endpoint)
        if (pendingMoveInfo) pendingMoveInfo.destroyed = endpoint.hitPiece.type
      }
      const duration = endpoint.hit ? 'impactMs' : endpoint.absorbed && endpoint.hitPiece?.type === 'anubis' ? 'shieldMs' : 'fizzleMs'
      activeLaserTimeout = setTimeout(complete, animationMs(duration))
    }, animationMs('beamMs'))
  }, animationMs('chargeMs'))
}

function computeLaserPath() {
  return traceGameLaser(gameState)
}

function startLaserCharge(segment) {
  if (prefersReducedMotion()) return
  ensureLaserLayer()
  const board = document.getElementById('game-board')
  const center = getSquareCenter(segment.startRow, segment.startCol, board.getBoundingClientRect())
  const square = document.querySelector(`[data-row="${segment.startRow}"][data-col="${segment.startCol}"]`)
  const color = gameState.currentPlayer === RED ? 'var(--player-red)' : 'var(--player-silver)'
  square.style.setProperty('--shot-color', color)
  square.classList.add('laser-charging')
  const ring = document.createElement('div')
  ring.className = 'laser-charge'
  ring.style.setProperty('--shot-color', color)
  Object.assign(ring.style, { left: `${center.x}%`, top: `${center.y}%`, width: `${100 / BOARD_COLS}%`, height: `${100 / BOARD_ROWS}%` })
  laserLayerElement.appendChild(ring)
}

function clearShotPresentation() {
  document.querySelectorAll('.laser-charging, .shield-hit').forEach(square => {
    square.classList.remove('laser-charging', 'shield-hit')
  })
  laserLayerElement?.querySelectorAll('.laser-charge').forEach(ring => ring.remove())
  document.body.classList.remove('pharaoh-hit', 'pharaoh-shake')
}

// The overlay is counter-rotated with the board, so use display coordinates for
// the travel vector too. At exits, end the ray at the actual outer board edge.
function laserEndpointCenter(segment, boardRect) {
  if (!segment.outOfBounds) {
    const center = getSquareCenter(segment.endRow, segment.endCol, boardRect)
    if (segment.absorbed && segment.hitPiece?.type === 'anubis') {
      const square = document.querySelector(`[data-row="${segment.endRow}"][data-col="${segment.endCol}"]`).getBoundingClientRect()
      const vector = CARDINAL_VECTORS[transformFacing(segment.direction)]
      // The shield face is 24% of the SVG size ahead of the Anubis center.
      center.x -= vector.col * square.width * 0.82 * 0.24 / boardRect.width * 100
      center.y -= vector.row * square.height * 0.82 * 0.24 / boardRect.height * 100
    }
    return center
  }
  const start = getSquareCenter(segment.startRow, segment.startCol, boardRect)
  const vector = CARDINAL_VECTORS[transformFacing(segment.direction)]
  return { x: vector.col ? (vector.col > 0 ? 100 : 0) : start.x,
    y: vector.row ? (vector.row > 0 ? 100 : 0) : start.y }
}

function addLaserImpact(endpoint) {
  const board = document.getElementById('game-board')
  const center = laserEndpointCenter(endpoint, board.getBoundingClientRect())
  const piece = endpoint.hitPiece
  const kind = endpoint.hit ? (piece.type === 'pharaoh' ? 'pharaoh' : 'destroy') : piece?.type === 'anubis' ? 'shield' : 'fizzle'
  const color = (piece?.player ?? gameState.currentPlayer) === RED ? '#f35b5b' : '#7fd1ff'
  laserEffects?.burst({ ...center, kind, color, direction: CARDINAL_VECTORS[transformFacing(endpoint.direction)] })
  if (kind === 'shield') {
    const square = document.querySelector(`[data-row="${endpoint.hitRow}"][data-col="${endpoint.hitCol}"]`)
    square.style.setProperty('--shot-color', color)
    square.classList.add('shield-hit')
  }
  if (kind === 'pharaoh') {
    document.body.classList.add('pharaoh-hit')
    if (!prefersReducedMotion()) document.body.classList.add('pharaoh-shake')
  }
  const indicator = laserLayerElement?.querySelector('.laser-impact')
  if (indicator) {
    indicator.style.setProperty('--impactMs', `${animationMs(kind === 'shield' ? 'shieldMs' : kind === 'fizzle' ? 'fizzleMs' : 'impactMs')}ms`)
    indicator.classList.add('laser-impact-active')
  }
}

function renderLaserPath(path) {
  if (!path || path.length === 0) return
  ensureLaserLayer()
  clearLaserLayer()

  if (!laserLayerElement) return

  const boardElement = document.getElementById('game-board')
  if (!boardElement) return

  const boardRect = boardElement.getBoundingClientRect()
  const squareWidthPercent = 100 / BOARD_COLS
  const squareHeightPercent = 100 / BOARD_ROWS
  // Laser thickness as percentage of square size (6px / 70px = 8.57% of square)
  // Convert to percentage of board: 8.57% of square = 8.57% * (100/BOARD_ROWS) of board height
  const laserThicknessPercentHeight = (LASER_THICKNESS_PERCENT / 100) * squareHeightPercent
  const laserThicknessPercentWidth = (LASER_THICKNESS_PERCENT / 100) * squareWidthPercent

  // Weight by distance so reflections and the short exit leg don't change speed.
  const segments = path.map(segment => {
    const startCenter = getSquareCenter(segment.startRow, segment.startCol, boardRect)
    const endCenter = laserEndpointCenter(segment, boardRect)
    const distance = Math.hypot((endCenter.x - startCenter.x) * boardRect.width, (endCenter.y - startCenter.y) * boardRect.height)
    return { segment, startCenter, endCenter, distance }
  })
  const totalDistance = segments.reduce((sum, item) => sum + item.distance, 0)
  let delay = 0
  segments.forEach(({ segment, startCenter, endCenter, distance }) => {
    const laserSegment = document.createElement('div')
    laserSegment.className = 'laser-path'

    const deltaX = endCenter.x - startCenter.x
    const deltaY = endCenter.y - startCenter.y
    const duration = totalDistance ? animationMs('beamMs') * distance / totalDistance : 0
    laserSegment.style.setProperty('--segment-ms', `${duration}ms`)
    laserSegment.style.setProperty('--segment-delay', `${delay}ms`)
    delay += duration

    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      const lengthPercent = Math.abs(deltaX)
      laserSegment.style.width = `${lengthPercent}%`
      laserSegment.style.height = `${laserThicknessPercentHeight}%`
      laserSegment.style.left = `${Math.min(startCenter.x, endCenter.x)}%`
      laserSegment.style.top = `${startCenter.y - (laserThicknessPercentHeight / 2)}%`
      laserSegment.style.setProperty('--beam-from', 'scaleX(0)')
      laserSegment.style.transformOrigin = deltaX >= 0 ? 'left center' : 'right center'
    } else {
      const lengthPercent = Math.abs(deltaY)
      laserSegment.style.width = `${laserThicknessPercentWidth}%`
      laserSegment.style.height = `${lengthPercent}%`
      laserSegment.style.left = `${startCenter.x - (laserThicknessPercentWidth / 2)}%`
      laserSegment.style.top = `${Math.min(startCenter.y, endCenter.y)}%`
      laserSegment.style.setProperty('--beam-from', 'scaleY(0)')
      laserSegment.style.transformOrigin = deltaY >= 0 ? 'center top' : 'center bottom'
    }

    laserLayerElement.appendChild(laserSegment)
    
    // Add impact indicator if this segment hits something
    if (segment.hit || segment.absorbed) {
      const hitIndicator = document.createElement('div')
      hitIndicator.className = 'laser-impact'
      // Impact indicator is 18px originally = 25.7% of 70px square
      // Convert to percentage of board
      const impactSizePercentWidth = (25.7 / 100) * squareWidthPercent
      const impactSizePercentHeight = (25.7 / 100) * squareHeightPercent
      hitIndicator.style.width = `${impactSizePercentWidth}%`
      hitIndicator.style.height = `${impactSizePercentHeight}%`
      hitIndicator.style.left = `${endCenter.x - (impactSizePercentWidth / 2)}%`
      hitIndicator.style.top = `${endCenter.y - (impactSizePercentHeight / 2)}%`
      laserLayerElement.appendChild(hitIndicator)
    }
  })
}

function persistLaserPath() {
  if (!laserLayerElement) return

  laserLayerElement.querySelectorAll('.laser-path').forEach(segment => {
    segment.classList.add('laser-path-persistent')
  })

  const impact = laserLayerElement.querySelector('.laser-impact')
  if (impact) {
    impact.classList.add('laser-impact-persistent')
  }
}

function handleLaserHit(endpoint) {
  const { hitPiece, hitRow, hitCol, absorbed } = endpoint
  if (!hitPiece) return

  // Only remove the piece if it was destroyed, not absorbed by Anubis shield
  if (!absorbed) {
    // Add destruction animation before removing the piece
    addDestructionAnimation(hitRow, hitCol)
    gameState.board[hitRow][hitCol] = null
    document.querySelector(`[data-row="${hitRow}"][data-col="${hitCol}"] .piece-container`)?.remove()
  }

  if (hitPiece.type === 'pharaoh') {
    gameState.gameOver = true
    // The owner of the destroyed Pharaoh loses, whoever fired the shot
    gameState.winner = hitPiece.player === RED ? SILVER : RED
    // Overlay will be shown after the laser animation in handleFireLaser
    persistLaserPath()
    if (!replayingOnlineMove) updateUrlHash()
    // Stop polling when game ends
    stopSyncPolling()
  }
}

// Add destruction animation for destroyed pieces
function addDestructionAnimation(row, col) {
  const boardElement = document.getElementById('game-board')
  if (!boardElement) return
  
  const boardRect = boardElement.getBoundingClientRect()
  const squareWidthPercent = 100 / BOARD_COLS
  const squareHeightPercent = 100 / BOARD_ROWS
  
  // Get the center of the square where the piece was destroyed
  const squareCenter = getSquareCenter(row, col, boardRect)
  if (!squareCenter) return
  
  // Create the pink glow effect (100% of square size in CSS, centered)
  const glowElement = document.createElement('div')
  glowElement.className = 'destruction-glow'
  // Center the glow (50% of square width/height)
  glowElement.style.left = `${squareCenter.x - (squareWidthPercent / 2)}%`
  glowElement.style.top = `${squareCenter.y - (squareHeightPercent / 2)}%`
  glowElement.style.width = `${squareWidthPercent}%`
  glowElement.style.height = `${squareHeightPercent}%`
  
  // Keep the existing destruction glow; shards now share the board canvas.
  ensureLaserLayer()
  laserLayerElement.appendChild(glowElement)
}

function ensureLaserLayer() {
  const boardElement = document.getElementById('game-board')
  if (!boardElement) return

  if (!laserLayerElement || !boardElement.contains(laserLayerElement)) {
    laserLayerElement = document.createElement('div')
    laserLayerElement.className = 'laser-layer'
    boardElement.insertBefore(laserLayerElement, boardElement.firstChild)
  }
  
  // Counter-rotate laser layer when board is rotated
  if (shouldRotateBoard()) {
    laserLayerElement.style.transform = 'rotate(180deg)'
  } else {
    laserLayerElement.style.transform = ''
  }
  if (!laserEffects) laserEffects = createLaserEffects(boardElement)
  if (!boardElement.contains(laserEffects.canvas)) boardElement.appendChild(laserEffects.canvas)
  laserEffects.canvas.style.transform = laserLayerElement.style.transform
}

function clearLaserLayer() {
  clearShotPresentation()
  laserEffects?.clear()
  if (laserLayerElement) {
    laserLayerElement.innerHTML = ''
  }
}

function updateBoardDimensions() {
  const boardElement = document.getElementById('game-board')
  const appElement = document.getElementById('app')
  const mainElement = boardElement?.parentElement
  if (!boardElement || !mainElement || !appElement) return

  // Get header and controls heights (they're flex-shrink: 0, so they have fixed heights)
  const headerElement = appElement.querySelector('header')
  const controlsElement = mainElement.querySelector('.controls')
  const mainStyles = window.getComputedStyle(mainElement)
  const appStyles = window.getComputedStyle(appElement)
  
  const gap = parseFloat(mainStyles.rowGap || mainStyles.gap || '0')
  const appPadding = parseFloat(appStyles.paddingTop || '0') + parseFloat(appStyles.paddingBottom || '0')
  const headerHeight = headerElement ? headerElement.offsetHeight + parseFloat(window.getComputedStyle(headerElement).marginBottom || '0') : 0
  const controlsHeight = controlsElement ? controlsElement.offsetHeight : 0
  const confirmation = document.getElementById('move-confirmation')
  // Reserve this space throughout the turn so staging never resizes the board.
  const confirmationHeight = Math.max(44, confirmation?.offsetHeight || 0)

  // Calculate available space from viewport, not from main element (which is constrained by board)
  const viewportHeight = window.innerHeight
  const viewportWidth = window.innerWidth
  
  // Get body padding (it's 1em on all sides)
  const bodyStyles = window.getComputedStyle(document.body)
  const bodyPaddingTop = parseFloat(bodyStyles.paddingTop || '0')
  const bodyPaddingBottom = parseFloat(bodyStyles.paddingBottom || '0')
  const bodyPaddingLeft = parseFloat(bodyStyles.paddingLeft || '0')
  const bodyPaddingRight = parseFloat(bodyStyles.paddingRight || '0')
  
  // Available height = viewport - body padding - app padding - header - controls - gap
  const availableHeight = Math.max(viewportHeight - bodyPaddingTop - bodyPaddingBottom - appPadding - headerHeight - controlsHeight - confirmationHeight - gap * 2, 0)
  // Available width = viewport - body padding - app padding
  const availableWidth = Math.max(viewportWidth - bodyPaddingLeft - bodyPaddingRight - appPadding, 0)

  if (availableWidth <= 0 || availableHeight <= 0) {
    boardElement.style.width = ''
    boardElement.style.height = ''
    return
  }

  const aspectRatio = BOARD_COLS / BOARD_ROWS
  let targetWidth = availableWidth
  let targetHeight = targetWidth / aspectRatio

  if (targetHeight > availableHeight) {
    targetHeight = availableHeight
    targetWidth = targetHeight * aspectRatio
  }

  boardElement.style.width = `${targetWidth}px`
  boardElement.style.height = `${targetHeight}px`
}

function setupBoardResizeObserver() {
  const appElement = document.getElementById('app')
  if (!appElement) return

  if (boardResizeObserver) {
    boardResizeObserver.disconnect()
  }

  // Observe the app element and window resize to catch all size changes
  boardResizeObserver = new ResizeObserver(() => {
    updateBoardDimensions()
  })

  boardResizeObserver.observe(appElement)
  
  // Also listen to window resize for viewport changes
  window.removeEventListener('resize', updateBoardDimensions)
  window.addEventListener('resize', updateBoardDimensions)
}

function getSquareCenter(row, col, boardRect) {
  const square = document.querySelector(`[data-row="${row}"][data-col="${col}"]`)
  if (!square) return null

  const squareRect = square.getBoundingClientRect()
  // Return percentages relative to board dimensions
  const xPercent = ((squareRect.left - boardRect.left + squareRect.width / 2) / boardRect.width) * 100
  const yPercent = ((squareRect.top - boardRect.top + squareRect.height / 2) / boardRect.height) * 100
  return {
    x: xPercent,
    y: yPercent,
    xPx: squareRect.left - boardRect.left + squareRect.width / 2,
    yPx: squareRect.top - boardRect.top + squareRect.height / 2
  }
}

function findCurrentPlayerSphinx() {
  return findSphinx(stagedBoard ? { ...gameState, board: stagedBoard } : gameState)
}

// Reset and play again both offer the same new-game choices.
function handleResetGame() {
  showNewGameOptions()
}

// Show game over overlay
function showGameOverOverlay() {
  const overlay = document.getElementById('game-over-overlay')
  const winnerText = document.getElementById('winner-text')
  
  if (!overlay || !winnerText) return
  
  const winnerColor = gameState.winner === RED ? 'Red' : 'Silver'
  const winnerClass = winnerColor.toLowerCase()
  
  winnerText.textContent = `${winnerColor.toUpperCase()} WINS!`
  winnerText.className = `winner-text ${winnerClass}`
  
  overlay.classList.remove('hidden')
}

// Hide game over overlay
function hideGameOverOverlay() {
  const overlay = document.getElementById('game-over-overlay')
  if (overlay) {
    overlay.classList.add('hidden')
  }
}

// Handle play again button
function handlePlayAgain() {
  hideGameOverOverlay()
  showNewGameOptions()
}

// =============================================================================
// SESSION MANAGEMENT & ONLINE PLAY
// =============================================================================

/**
 * Try to join an existing session
 */
async function tryJoinSession(sessionCode, roleHint) {
  try {
    const fullSessionId = GameSync.normalizeSessionId(sessionCode)
    const session = await GameSync.loadSession(fullSessionId)
    
    // Decode state
    const decoded = decodeFullState(session.state_blob)
    gameState = decoded
    
    // Determine our role
    const myId = GameSync.getClientId()
    
    // Check if we're already assigned
    if (gameState.sync.redId === myId) {
      syncContext.localSide = 'red'
      syncContext.isHost = true
    } else if (gameState.sync.silverId === myId) {
      syncContext.localSide = 'silver'
      syncContext.isHost = false
    } else if (roleHint === 'red' && !gameState.sync.redId) {
      // Reconnecting as host
      gameState.sync.redId = myId
      syncContext.localSide = 'red'
      syncContext.isHost = true
    } else if (!gameState.sync.silverId) {
      // Join as silver (guest)
      gameState.sync.silverId = myId
      syncContext.localSide = 'silver'
      syncContext.isHost = false
    } else if (!gameState.sync.redId) {
      // Rare case: silver joined but red left
      gameState.sync.redId = myId
      syncContext.localSide = 'red'
      syncContext.isHost = true
    } else {
      // Both seats taken and we're not one of them
      showToast('Game is full - both players already joined', 'error')
      return false
    }
    
    // Update sync context
    syncContext.enabled = true
    syncContext.sessionId = fullSessionId
    
    // Push our assignment
    await pushSyncState()
    
    // Update URL
    const url = new URL(window.location.href)
    url.searchParams.set('session', GameSync.trimSessionId(fullSessionId))
    url.searchParams.set('role', syncContext.localSide)
    url.hash = ''
    window.history.replaceState(null, '', url.toString())
    
    // Start polling
    startSyncPolling()
    
    console.log(`Joined session as ${syncContext.localSide}`)
    return true
  } catch (error) {
    console.error('Failed to join session:', error)
    if (error.type === 'not_found') {
      showToast('Session not found or expired', 'error')
    }
    return false
  }
}

/**
 * Host a new online game
 */
async function hostOnlineGame(setup = 'classic') {
  if (!syncContext.serviceAvailable) {
    showToast('Online play unavailable', 'error')
    return false
  }
  
  try {
    cancelComputerTurn()
    const myId = GameSync.getClientId()
    
    // Reset game state
    gameState.currentPlayer = SILVER
    gameState.selectedPiece = null
    gameState.selectedSquare = null
    gameState.gameOver = false
    gameState.winner = null
    gameState.actionTaken = false
    gameState.board = Array(8).fill(null).map(() => Array(10).fill(null))
    gameState.sync = {
      redId: myId,
      silverId: null,
      lastTurnId: 0,
      turnHistory: []
    }
    
    gameState.computer = null
    setupLayout(setup)
    
    // Encode and create session
    const encoded = encodeFullState(gameState)
    const session = await GameSync.createSession(encoded, {
      created_at: new Date().toISOString(),
      host: myId
    })
    
    // Update sync context
    syncContext.enabled = true
    syncContext.sessionId = session.session_id
    syncContext.localSide = 'red'
    syncContext.isHost = true
    
    // Update URL
    const url = new URL(window.location.href)
    url.searchParams.set('session', GameSync.trimSessionId(session.session_id))
    url.searchParams.set('role', 'red')
    url.hash = ''
    window.history.replaceState(null, '', url.toString())
    
    // Re-render
    ensureLaserLayer()
    clearLaserLayer()
    renderBoard()
    
    // Start polling
    startSyncPolling()
    
    // Show invite modal
    showInviteModal()
    
    updateSyncStatusUI()
    console.log('Hosted new game:', session.session_id)
    return true
  } catch (error) {
    console.error('Failed to host game:', error)
    showToast('Failed to start online game', 'error')
    return false
  }
}

/**
 * Push current state to server
 */
async function pushSyncState() {
  if (!syncContext.enabled || !syncContext.sessionId) return
  
  try {
    const encoded = encodeFullState(gameState)
    const result = await GameSync.updateSession(encoded)
    
    if (result && result.type === 'conflict') {
      // Handle conflict
      const remoteState = decodeFullState(result.current.state_blob)
      receiveOnlineState(remoteState)
      showToast('Game was updated by opponent', 'info')
    }
    
    // Save sync storage for reconnect
    saveSyncStorage()
  } catch (error) {
    console.error('Failed to push sync state:', error)
  }
}

/**
 * Start polling for sync updates
 */
function startSyncPolling() {
  if (!syncContext.enabled || gameState.gameOver) return
  
  GameSync.startPolling((session, error) => {
    if (error) {
      if (error.type === 'not_found') {
        showToast('Session ended', 'info')
        disableOnlinePlay()
      }
      return
    }
    
    try {
      const remoteState = decodeFullState(session.state_blob)
      
      // Check if opponent joined
      const wasWaiting = !gameState.sync.silverId && syncContext.isHost
      const opponentJoined = wasWaiting && remoteState.sync.silverId
      
      if (opponentJoined) {
        showToast('Opponent joined the game!', 'success')
        hideInviteModal()
      }
      receiveOnlineState(remoteState)
    } catch (error) {
      console.error('Failed to process sync update:', error)
    }
  })
}

// Replay one newly received opponent action against the previous board, then
// adopt the server's final state. Replays never record or push another turn.
function receiveOnlineState(remoteState) {
  if (replayingOnlineMove) return
  const turn = remoteState.sync.turnHistory.at(-1)
  const newOpponentTurn = remoteState.sync.lastTurnId === gameState.sync.lastTurnId + 1 &&
    turn && isOpponentsTurn() && !turnInProgress
  const action = newOpponentTurn ? actionFromTurn(turn, gameState.board) : null
  const finish = () => {
    replayingOnlineMove = false
    turnInProgress = false
    laserActive = false
    stagedAction = null
    stagedBoard = null
    gameState = remoteState
    gameState.computer = null
    gameState.selectedPiece = null
    gameState.selectedSquare = null
    const winningLaser = gameState.gameOver ? laserLayerElement?.innerHTML : null
    renderBoard()
    if (winningLaser) laserLayerElement.innerHTML = winningLaser
    updateComputerStatus()
    updateSyncStatusUI()
    saveSyncStorage()
    if (gameState.gameOver) showGameOverOverlay()
    else if (newOpponentTurn && isLocalPlayersTurn()) showTurnStartOverlay()
  }
  if (action) {
    hideTurnOverlay()
    replayingOnlineMove = true
    animateOpponentAction(action, () => handleFireLaser(turn, finish))
  } else {
    cancelComputerTurn()
    finish()
  }
}

/**
 * Stop sync polling
 */
function stopSyncPolling() {
  GameSync.stopPolling()
}

/**
 * Disable online play (return to local mode)
 */
function disableOnlinePlay() {
  if (replayingOnlineMove) {
    cancelComputerTurn()
    clearSelection()
    renderBoard()
  }
  if (stagedAction) cancelStagedMove()
  syncContext.enabled = false
  syncContext.sessionId = null
  syncContext.localSide = null
  syncContext.isHost = false
  syncContext.syncStatus = 'offline'
  
  GameSync.clearSession()
  clearSyncStorage()
  
  // Clear URL params
  const url = new URL(window.location.href)
  url.searchParams.delete('session')
  url.searchParams.delete('role')
  window.history.replaceState(null, '', url.toString())
  
  updateSyncStatusUI()
}

/**
 * Save sync context to localStorage for reconnect
 */
function saveSyncStorage() {
  if (!syncContext.enabled) return
  
  try {
    const data = {
      sessionId: syncContext.sessionId,
      localSide: syncContext.localSide,
      isHost: syncContext.isHost,
      version: GameSync.getVersion(),
      savedAt: Date.now()
    }
    localStorage.setItem('khet_sync_session', JSON.stringify(data))
  } catch (error) {
    console.warn('Failed to save sync storage:', error)
  }
}

/**
 * Clear sync storage
 */
function clearSyncStorage() {
  try {
    localStorage.removeItem('khet_sync_session')
  } catch (error) {
    // Ignore
  }
}

/**
 * Try to restore sync context from localStorage
 */
async function tryRestoreSync() {
  try {
    const stored = localStorage.getItem('khet_sync_session')
    if (!stored) return false
    
    const data = JSON.parse(stored)
    
    // Check if session is too old (1 hour)
    const age = Date.now() - data.savedAt
    if (age > 60 * 60 * 1000) {
      clearSyncStorage()
      return false
    }
    
    // Check URL for matching session
    const urlParams = new URLSearchParams(window.location.search)
    const urlSession = urlParams.get('session')
    
    // Only restore if URL matches or no URL session
    if (urlSession && GameSync.normalizeSessionId(urlSession) !== GameSync.normalizeSessionId(data.sessionId)) {
      // Different session in URL - don't restore
      return false
    }
    
    // Try to load the session
    const session = await GameSync.loadSession(data.sessionId)
    const decoded = decodeFullState(session.state_blob)
    
    // Verify we're still assigned
    const myId = GameSync.getClientId()
    if (decoded.sync.redId !== myId && decoded.sync.silverId !== myId) {
      // We're not in this session anymore
      clearSyncStorage()
      return false
    }
    
    // Restore state
    gameState = decoded
    syncContext.enabled = true
    syncContext.sessionId = data.sessionId
    syncContext.localSide = data.localSide
    syncContext.isHost = data.isHost
    
    // Update URL
    const url = new URL(window.location.href)
    url.searchParams.set('session', GameSync.trimSessionId(data.sessionId))
    url.searchParams.set('role', syncContext.localSide)
    url.hash = ''
    window.history.replaceState(null, '', url.toString())
    
    console.log('Restored sync session:', data.sessionId)
    return true
  } catch (error) {
    console.warn('Failed to restore sync:', error)
    clearSyncStorage()
    return false
  }
}

/**
 * End turn and push state
 */
async function endTurnAndSync(moveData) {
  if (syncContext.enabled) {
    // Record the turn
    recordTurn(moveData)
    
    // Flip to next player (already done in game logic)
    
    // Push to server
    await pushSyncState()
    
    updateSyncStatusUI()
    
    // Show waiting state if online
    if (!gameState.gameOver) {
      maybeShowWaitingState()
    }
  }
}

// =============================================================================
// SYNC UI - STATUS BADGES & OVERLAYS
// =============================================================================

/**
 * Update all sync status UI elements
 */
function updateSyncStatusUI() {
  updateSyncStatus()
  updateSyncBadge()
  updateShareMenuOnlineOptions()
}

/**
 * Update sync status badge
 */
function updateSyncBadge() {
  const indicator = document.getElementById('sync-indicator')
  if (!indicator) return
  
  if (!syncContext.enabled) {
    indicator.classList.add('hidden')
    return
  }
  
  indicator.classList.remove('hidden')
  
  // Update text and style based on status
  switch (syncContext.syncStatus) {
    case 'waiting':
      indicator.textContent = '⏳ Waiting'
      indicator.className = 'sync-indicator sync-waiting'
      break
    case 'your_turn':
      indicator.textContent = '✨ Your turn'
      indicator.className = 'sync-indicator sync-your-turn'
      break
    case 'opponent_turn':
      indicator.textContent = '⌛ Opponent'
      indicator.className = 'sync-indicator sync-opponent-turn'
      break
    default:
      indicator.textContent = '🔗 Online'
      indicator.className = 'sync-indicator sync-online'
  }
}

/**
 * Update share menu online-specific options
 */
function updateShareMenuOnlineOptions() {
  const playOnlineBtn = document.getElementById('play-online-btn')
  const inviteBtn = document.getElementById('invite-btn')
  const copySessionBtn = document.getElementById('copy-session-id-btn')
  const leaveGameBtn = document.getElementById('leave-online-btn')
  
  if (syncContext.enabled) {
    if (playOnlineBtn) playOnlineBtn.classList.add('hidden')
    if (inviteBtn) inviteBtn.classList.remove('hidden')
    if (copySessionBtn) copySessionBtn.classList.remove('hidden')
    if (leaveGameBtn) leaveGameBtn.classList.remove('hidden')
  } else {
    if (playOnlineBtn && syncContext.serviceAvailable) {
      playOnlineBtn.classList.remove('hidden')
    }
    if (inviteBtn) inviteBtn.classList.add('hidden')
    if (copySessionBtn) copySessionBtn.classList.add('hidden')
    if (leaveGameBtn) leaveGameBtn.classList.add('hidden')
  }
}

/**
 * Show turn start overlay
 */
function showTurnStartOverlay() {
  const overlay = document.getElementById('turn-overlay')
  if (!overlay) return
  
  // Get recent opponent moves
  const unseenTurns = getUnseenOpponentTurns()
  const summaryEl = overlay.querySelector('.turn-summary')
  
  if (summaryEl && unseenTurns.length > 0) {
    const lastTurn = unseenTurns[unseenTurns.length - 1]
    summaryEl.textContent = formatMoveDescription(lastTurn)
    summaryEl.classList.remove('hidden')
  } else if (summaryEl) {
    summaryEl.classList.add('hidden')
  }
  
  const titleEl = overlay.querySelector('.turn-title')
  if (titleEl) {
    titleEl.textContent = "It's your turn!"
  }
  
  overlay.classList.remove('hidden')
  turnOverlayVisible = true
}

/**
 * Hide turn overlay
 */
function hideTurnOverlay() {
  const overlay = document.getElementById('turn-overlay')
  if (overlay) {
    overlay.classList.add('hidden')
  }
  turnOverlayVisible = false
  markTurnsSeen()
}

/**
 * Maybe show turn overlay on page load
 */
function maybeShowTurnOverlay() {
  if (!syncContext.enabled) return
  if (gameState.gameOver) return
  
  if (isLocalPlayersTurn()) {
    const unseenTurns = getUnseenOpponentTurns()
    if (unseenTurns.length > 0) {
      showTurnStartOverlay()
    }
  }
}

/**
 * Show waiting state (opponent's turn)
 */
function maybeShowWaitingState() {
  if (!syncContext.enabled) return
  if (isLocalPlayersTurn()) return
  
  // Could show a subtle waiting indicator
  // For now just update the badge
  updateSyncBadge()
}

// =============================================================================
// INVITE MODAL
// =============================================================================

/**
 * Show invite modal with QR and links
 */
function showInviteModal() {
  const modal = document.getElementById('invite-modal')
  if (!modal) return
  
  const sessionId = GameSync.getSessionId()
  const shareUrl = GameSync.getSessionUrl('silver')
  const sessionCode = GameSync.trimSessionId(sessionId)
  
  // Update modal content
  const codeEl = modal.querySelector('.invite-code')
  if (codeEl) codeEl.textContent = sessionCode
  
  const linkEl = modal.querySelector('.invite-link')
  if (linkEl) linkEl.value = shareUrl
  
  // Generate QR code
  const qrEl = modal.querySelector('.invite-qr')
  if (qrEl && shareUrl) {
    QRCode.toCanvas(qrEl, shareUrl, {
      width: 180,
      margin: 2,
      color: { dark: '#ffffff', light: '#1a1a2e' }
    }).catch(err => console.error('QR generation failed:', err))
  }
  
  modal.classList.remove('hidden')
}

/**
 * Hide invite modal
 */
function hideInviteModal() {
  const modal = document.getElementById('invite-modal')
  if (modal) modal.classList.add('hidden')
}

/**
 * Copy invite link
 */
function copyInviteLink() {
  const shareUrl = GameSync.getSessionUrl('silver')
  if (!shareUrl) return
  
  navigator.clipboard.writeText(shareUrl).then(() => {
    showToast('Invite link copied!', 'success')
  }).catch(() => {
    // Fallback
    const input = document.createElement('input')
    input.value = shareUrl
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    showToast('Invite link copied!', 'success')
  })
}

/**
 * Copy session code
 */
function copySessionCode() {
  const sessionId = GameSync.getSessionId()
  if (!sessionId) return
  
  const code = GameSync.trimSessionId(sessionId)
  navigator.clipboard.writeText(code).then(() => {
    showToast('Session code copied!', 'success')
  }).catch(() => {
    showToast('Failed to copy', 'error')
  })
}

/**
 * Legacy function for backwards compatibility
 */
function copySessionId() {
  copyInviteLink()
}

/**
 * Sync current state to GameSync (called from updateUrlHash)
 */
async function syncToGameSync() {
  if (!syncContext.enabled) return
  await pushSyncState()
}

// URL Hash Management
async function updateUrlHash() {
  try {
    const encoded = encodeState(gameState)
    const hash = `#v=1.s=${encoded}`
    
    // Only update hash if not in online mode (online uses URL params)
    if (!syncContext.enabled) {
      if (DEV_MODE && !isLoadingFromHash) {
        // Dev mode: use pushState to create history entries (allows undo via back button)
        window.history.pushState({ gameState }, '', hash)
        console.log('[DEV MODE] State saved to history, hash updated')
        
        // Re-render from hash to verify encoding/decoding works
        if (!gameState.computer) setTimeout(() => {
          isLoadingFromHash = true
          const hashState = loadStateFromHash()
          if (hashState) {
            console.log('[DEV MODE] Re-rendering from hash to verify encoding/decoding')
            loadGameState(hashState)
          }
          isLoadingFromHash = false
        }, 100)
      } else {
        // Normal mode: use replaceState (no history entries)
        window.history.replaceState(null, '', hash)
      }
    }
  } catch (error) {
    console.error('Failed to update URL hash:', error)
  }
}

function loadStateFromHash() {
  const hash = window.location.hash
  if (!hash) return null

  try {
    // Parse hash format: #v=1.s=<base64url>
    const match = hash.match(/^#v=(\d+)\.s=(.+)$/)
    if (!match) {
      console.warn('Invalid hash format')
      return null
    }

    const version = parseInt(match[1], 10)
    const encoded = match[2]

    if (version !== 1) {
      console.warn(`Unsupported version: ${version}`)
      return null
    }

    const decodedState = decodeState(encoded)
    return decodedState
  } catch (error) {
    console.error('Failed to load state from hash:', error)
    showToast('Invalid game state in URL', 'error')
    return null
  }
}

function loadGameState(state) {
  // Validate state structure
  if (!state || !state.board || !Array.isArray(state.board)) {
    throw new Error('Invalid state structure')
  }

  if (DEV_MODE) {
    console.log('[DEV MODE] Loading game state:', {
      currentPlayer: state.currentPlayer,
      gameOver: state.gameOver,
      winner: state.winner,
      pieceCount: state.board.flat().filter(p => p !== null).length
    })
    
    // Log all scarabs for debugging
    const scarabs = []
    for (let row = 0; row < 8; row += 1) {
      for (let col = 0; col < 10; col += 1) {
        const piece = state.board[row][col]
        if (piece && piece.type === 'scarab') {
          scarabs.push({ row, col, player: piece.player, facing: piece.facing })
        }
      }
    }
    console.log('[DEV MODE] Scarabs in loaded state:', scarabs)
  }

  cancelComputerTurn()
  document.getElementById('new-game-overlay').classList.add('hidden')
  // Set game state
  gameState.setup = state.setup || 'classic'
  gameState.computer = syncContext.enabled ? null : state.computer || null
  gameState.ply = state.ply ?? 0
  gameState.currentPlayer = state.currentPlayer
  gameState.board = state.board
  gameState.gameOver = state.gameOver || false
  gameState.winner = state.winner || null
  gameState.selectedPiece = null
  gameState.selectedSquare = null
  gameState.actionTaken = false

  // Clear UI state
  clearSelection()

  // Render
  renderBoard()
  ensureLaserLayer()

  // Update URL hash to match (but don't create history entry in dev mode if we're loading from hash)
  if (!DEV_MODE) {
    updateUrlHash()
  }
  maybeStartComputerTurn()
}

// Share Functions
function copyGameLink() {
  const url = window.location.href
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link copied! Send to opponent', 'success')
  }).catch(() => {
    // Fallback: select text in a temporary input
    const input = document.createElement('input')
    input.value = url
    document.body.appendChild(input)
    input.select()
    document.execCommand('copy')
    document.body.removeChild(input)
    showToast('Link copied! Send to opponent', 'success')
  })
}

function shareGameLink() {
  const url = window.location.href
  if (navigator.share) {
    navigator.share({
      title: 'Khet - Laser Chess',
      text: 'Continue our game!',
      url: url
    }).catch(() => {
      // User cancelled or share failed, fallback to copy
      copyGameLink()
    })
  } else {
    copyGameLink()
  }
}

function showQRCode() {
  const url = window.location.href
  const qrOverlay = document.getElementById('qr-overlay')
  const qrCanvas = document.getElementById('qr-canvas')

  if (!qrOverlay || !qrCanvas) {
    console.error('QR overlay elements not found')
    return
  }

  // Generate QR code using library
  generateQRCode(url, qrCanvas).then(() => {
    qrOverlay.classList.remove('hidden')
  }).catch(error => {
    console.error('Failed to generate QR code:', error)
    showToast('Failed to generate QR code', 'error')
  })
}

function hideQRCode() {
  const qrOverlay = document.getElementById('qr-overlay')
  if (qrOverlay) {
    qrOverlay.classList.add('hidden')
  }
}

async function generateQRCode(text, canvas) {
  try {
    // Calculate QR code size relative to viewport (min of width/height, capped)
    const maxSize = Math.min(window.innerWidth, window.innerHeight) * 0.3
    const qrSize = Math.min(maxSize, 200)
    
    await QRCode.toCanvas(canvas, text, {
      width: qrSize,
      margin: 2,
      color: {
        dark: '#000000',
        light: '#ffffff'
      }
    })
  } catch (error) {
    console.error('Failed to generate QR code:', error)
    // Fallback: show error message on canvas
    const ctx = canvas.getContext('2d')
    const canvasSize = Math.min(window.innerWidth, window.innerHeight) * 0.3
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvasSize, canvasSize)
    ctx.fillStyle = '#000000'
    ctx.font = `${canvasSize * 0.06}px monospace`
    ctx.textAlign = 'center'
    ctx.fillText('QR Code Error', canvasSize / 2, canvasSize * 0.45)
    ctx.fillText('Use Copy Link instead', canvasSize / 2, canvasSize * 0.55)
  }
}

function pasteOpponentLink() {
  navigator.clipboard.readText().then(text => {
    // Extract hash from pasted URL
    let hash = text
    if (text.includes('#')) {
      hash = text.substring(text.indexOf('#'))
    } else if (text.startsWith('#')) {
      hash = text
    } else {
      showToast('Invalid link format', 'error')
      return
    }

    // Try to load state from hash
    try {
      const match = hash.match(/^#v=(\d+)\.s=(.+)$/)
      if (!match) {
        showToast('Invalid game state format', 'error')
        return
      }

      const version = parseInt(match[1], 10)
      const encoded = match[2]

      if (version !== 1) {
        showToast(`Unsupported version: ${version}`, 'error')
        return
      }

      const decodedState = decodeState(encoded)
      loadGameState(decodedState)
      showToast('Game state loaded', 'success')
    } catch (error) {
      console.error('Failed to load state:', error)
      showToast('Failed to load game state', 'error')
    }
  }).catch(() => {
    // Permission denied or clipboard empty, show input field
    showPasteInput()
  })
}

function showPasteInput() {
  const input = prompt('Paste the opponent\'s game link:')
  if (!input) return

  let hash = input
  if (input.includes('#')) {
    hash = input.substring(input.indexOf('#'))
  } else if (input.startsWith('#')) {
    hash = input
  } else {
    showToast('Invalid link format', 'error')
    return
  }

  try {
    const match = hash.match(/^#v=(\d+)\.s=(.+)$/)
    if (!match) {
      showToast('Invalid game state format', 'error')
      return
    }

    const version = parseInt(match[1], 10)
    const encoded = match[2]

    if (version !== 1) {
      showToast(`Unsupported version: ${version}`, 'error')
      return
    }

    const decodedState = decodeState(encoded)
    loadGameState(decodedState)
    showToast('Game state loaded', 'success')
  } catch (error) {
    console.error('Failed to load state:', error)
    showToast('Failed to load game state', 'error')
  }
}

function showToast(message, type = 'info') {
  // Remove existing toast if any
  const existingToast = document.querySelector('.toast')
  if (existingToast) {
    existingToast.remove()
  }

  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  document.body.appendChild(toast)

  // Trigger animation
  setTimeout(() => {
    toast.classList.add('show')
  }, 10)

  // Remove after delay
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => {
      if (toast.parentNode) {
        toast.remove()
      }
    }, 300)
  }, 3000)
}

// Handle browser back/forward in dev mode
if (DEV_MODE) {
  window.addEventListener('popstate', (event) => {
    console.log('[DEV MODE] History navigation detected')
    const hashState = loadStateFromHash()
    if (hashState) {
      loadGameState(hashState)
    } else {
      // If no hash, initialize new game
      initGame()
    }
  })
}

// Handle hash changes (when URL is pasted/changed in address bar)
window.addEventListener('hashchange', () => {
  console.log('Hash changed, reloading state from URL')
  const hashState = loadStateFromHash()
  if (hashState) {
    loadGameState(hashState)
  } else if (!window.location.hash) {
    // Hash was removed, initialize new game
    initGame()
  }
})

// Start the game when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  if (DEV_MODE) {
    console.log('[DEV MODE] Enabled - History entries will be created on each move')
    console.log('[DEV MODE] Use browser back/forward to undo/redo moves')
    console.log('[DEV MODE] Board will re-render from URL hash after each move to verify encoding')
    
    // Add visual indicator
    const indicator = document.createElement('div')
    indicator.style.cssText = 'position: fixed; top: 0.625em; right: 0.625em; background: #ff6b6b; color: white; padding: 0.5em 0.75em; border-radius: 0.25em; font-size: 0.75em; font-weight: bold; z-index: 9999; box-shadow: 0 0.125em 0.5em rgba(0,0,0,0.3);'
    indicator.textContent = 'DEV MODE'
    document.body.appendChild(indicator)
  }
  initGame()
  window.addEventListener('resize', updateBoardDimensions)
})
