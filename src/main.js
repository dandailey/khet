// Khet - Laser Chess Main Entry Point

import "./style.css"
import { encodeState, decodeState } from './game/stateCodec.js'
import QRCode from 'qrcode'

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

const CARDINAL_VECTORS = {
  N: { row: -1, col: 0 },
  E: { row: 0, col: 1 },
  S: { row: 1, col: 0 },
  W: { row: 0, col: -1 }
}

const OPPOSITE_DIRECTIONS = {
  N: "S",
  E: "W",
  S: "N",
  W: "E"
}

const SCARAB_SLASH_FACINGS = new Set(["NE", "SE"])
const SCARAB_BACKSLASH_FACINGS = new Set(["NW", "SW"])

const SLASH_REFLECTION_MAPPING = {
  N: "E",
  E: "N",
  S: "W",
  W: "S"
}

const BACKSLASH_REFLECTION_MAPPING = {
  N: "W",
  W: "N",
  S: "E",
  E: "S"
}

// Pyramids: facing direction shows where mirrors point (the arrow direction)
// SW (↙) = mirrors on S and W sides → reflects from S/W, vulnerable from N/E
// NE (↗) = mirrors on N and E sides → reflects from N/E, vulnerable from S/W
const PYRAMID_MIRROR_ENTRIES = {
  NE: new Set(["N", "E"]),  // Reflects from N/E (mirrored), vulnerable from S/W
  SW: new Set(["S", "W"]),  // Reflects from S/W (mirrored), vulnerable from N/E
  NW: new Set(["N", "W"]),  // Reflects from N/W (mirrored), vulnerable from S/E
  SE: new Set(["S", "E"])   // Reflects from S/E (mirrored), vulnerable from N/W
}

const MAX_LASER_STEPS = 100
const LASER_THICKNESS_PERCENT = 8.57 // Percentage of square size (6/70 * 100)
const LASER_DURATION = 1500
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
  gameOver: false,
  winner: null,
  actionTaken: false // Track if player has taken an action this turn
}

let laserLayerElement = null
let activeLaserTimeout = null
let listenersAttached = false
let laserActive = false
let isLoadingFromHash = false
let boardResizeObserver = null

// Dev mode: enable history-based state management for testing encoding/decoding
// Set via URL parameter: ?dev=true or localStorage: khet-dev-mode=true
const DEV_MODE = new URLSearchParams(window.location.search).get('dev') === 'true' || 
                 localStorage.getItem('khet-dev-mode') === 'true'

// Make DEV_MODE available globally for stateCodec
if (typeof window !== 'undefined') {
  window.DEV_MODE = DEV_MODE
}

// Initialize the game
function initGame(skipHash = false) {
  console.log('Initializing Khet game...')
  
  // Check for state in URL hash first (unless skipping hash for reset)
  if (!skipHash) {
    const hashState = loadStateFromHash()
    if (hashState) {
      gameState = hashState
      ensureLaserLayer()
      clearLaserLayer()
      renderBoard()
      setupBoardResizeObserver()
      setupEventListeners()
      console.log('Game loaded from URL hash!')
      return
    }
  }
  
  // Create empty board (8 rows x 10 columns)
  gameState.board = Array(8)
    .fill(null)
    .map(() => Array(10).fill(null))
  
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
  
  console.log('Game initialized!')
}

// Helper to place a piece on the board
function setPiece(row, col, type, player, facing = 'N') {
  gameState.board[row][col] = { type, player, facing }
}

// Set up classic starting layout (Khet 2.0)
function setupClassicLayout() {
  // Row 0 (top)
  setPiece(0, 0, 'sphinx', RED, 'S')  // Top-left corner: Red Sphinx faces South
  setPiece(0, 4, 'anubis', RED, 'S')
  setPiece(0, 5, 'pharaoh', RED)
  setPiece(0, 6, 'anubis', RED, 'S')
  setPiece(0, 7, 'pyramid', RED, 'SE')

  // Row 1
  setPiece(1, 2, 'pyramid', RED, 'SW')

  // Row 2
  setPiece(2, 3, 'pyramid', SILVER, 'NW')

  // Row 3
  setPiece(3, 0, 'pyramid', RED, 'NE')
  setPiece(3, 2, 'pyramid', SILVER, 'SW')
  setPiece(3, 4, 'scarab', SILVER, 'NE') // C/ - forward slash mirrors (NE)
  setPiece(3, 5, 'scarab', SILVER, 'SW') // C\ - backslash mirrors (SW)
  setPiece(3, 7, 'pyramid', RED, 'SE')
  setPiece(3, 9, 'pyramid', SILVER, 'NW')

  // Row 4
  setPiece(4, 0, 'pyramid', RED, 'SE')
  setPiece(4, 2, 'pyramid', SILVER, 'NW')
  setPiece(4, 4, 'scarab', RED, 'SW') // C\ - backslash mirrors (SW)
  setPiece(4, 5, 'scarab', RED, 'NE') // C/ - forward slash mirrors (NE)
  setPiece(4, 7, 'pyramid', RED, 'NE')
  setPiece(4, 9, 'pyramid', SILVER, 'SW')

  // Row 5
  setPiece(5, 6, 'pyramid', RED, 'SE')

  // Row 6
  setPiece(6, 7, 'pyramid', SILVER, 'NE')

  // Row 7 (bottom)
  setPiece(7, 2, 'pyramid', SILVER, 'NW')
  setPiece(7, 3, 'anubis', SILVER, 'N')
  setPiece(7, 4, 'pharaoh', SILVER)
  setPiece(7, 5, 'anubis', SILVER, 'N')
  setPiece(7, 9, 'sphinx', SILVER, 'N')  // Bottom-right corner: Silver Sphinx faces North
}

// Render the game board
function renderBoard() {
  const boardElement = document.getElementById('game-board')
  boardElement.innerHTML = ''
  ensureLaserLayer()
  // Don't clear laser layer if game is over (keep winning laser path visible)
  if (!gameState.gameOver) {
    clearLaserLayer()
  }
  
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const square = document.createElement('div')
      square.className = 'square'
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
      const piece = gameState.board[row][col]
      if (piece) {
        const pieceContainer = document.createElement('div')
        pieceContainer.className = 'piece-container'
        
        const pieceElement = document.createElement('div')
        pieceElement.className = `piece player${piece.player}`
        const isActivePlayer = piece.player === gameState.currentPlayer
        pieceElement.innerHTML = getPieceSVG(piece, isActivePlayer)
        
        pieceContainer.appendChild(pieceElement)
        square.appendChild(pieceContainer)
        
        // Add player piece styling for current player
        if (piece.player === gameState.currentPlayer) {
          square.classList.add('player-piece')
        } else {
          square.classList.add('not-player-piece')
        }
      }
      
      boardElement.appendChild(square)
    }
  }
  
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
  const directionVector = CARDINAL_VECTORS[facing]
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
    
    // Share menu listeners
    const shareMenuBtn = document.getElementById('share-menu-btn')
    const shareMenu = document.getElementById('share-menu')
    const copyLinkBtn = document.getElementById('copy-link-btn')
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
  if (gameState.gameOver) return
  
  const square = event.target.closest('.square')
  if (!square) {
    // Clicked on board but not on a square - cancel piece selection
    if (gameState.selectedPiece) {
      clearSelection()
    }
    return
  }
  
  const row = parseInt(square.dataset.row)
  const col = parseInt(square.dataset.col)
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

// Move a piece
function movePiece(fromRow, fromCol, toRow, toCol) {
  const piece = gameState.board[fromRow][fromCol]
  const targetPiece = gameState.board[toRow][toCol]
  
  // Handle scarab swap
  if (piece.type === 'scarab' && targetPiece) {
    gameState.board[toRow][toCol] = piece
    gameState.board[fromRow][fromCol] = targetPiece
  } else {
    // Regular move
    gameState.board[toRow][toCol] = piece
    gameState.board[fromRow][fromCol] = null
  }
  
  // Clear selection, render the board to show the move, then fire laser
  clearSelection()
  renderBoard()
  
  // Use setTimeout to ensure the DOM updates before firing laser
  setTimeout(() => {
    handleFireLaser()
  }, 50)
}

// Rotate a piece
function rotatePiece(row, col, direction) {
  const piece = gameState.board[row][col]
  const currentFacing = piece.facing
  
  let newFacing = currentFacing
  
  // Different pieces have different rotation rules
  if (piece.type === 'sphinx') {
    // Sphinx: can only rotate between two directions based on position
    // Top-left corner (0,0): E <-> S
    // Bottom-right corner (7,9): W <-> N
    if (row === 0 && col === 0) {
      // Red sphinx in top-left: toggle between E and S
      newFacing = currentFacing === 'E' ? 'S' : 'E'
    } else if (row === 7 && col === 9) {
      // Silver sphinx in bottom-right: toggle between W and N
      newFacing = currentFacing === 'W' ? 'N' : 'W'
    }
  } else if (piece.type === 'anubis') {
    // Anubis: only cardinal directions (N, E, S, W) - 90° rotations
    const cardinalRotations = ['N', 'E', 'S', 'W']
    const currentIndex = cardinalRotations.indexOf(currentFacing)
    
    if (direction === 'left') {
      newFacing = cardinalRotations[(currentIndex - 1 + cardinalRotations.length) % cardinalRotations.length]
    } else {
      newFacing = cardinalRotations[(currentIndex + 1) % cardinalRotations.length]
    }
  } else if (piece.type === 'pyramid') {
    // Pyramids: only diagonal directions (NE, SE, SW, NW) - 90° rotations
    const diagonalRotations = ['NE', 'SE', 'SW', 'NW']
    const currentIndex = diagonalRotations.indexOf(currentFacing)
    
    if (direction === 'left') {
      newFacing = diagonalRotations[(currentIndex - 1 + diagonalRotations.length) % diagonalRotations.length]
    } else {
      newFacing = diagonalRotations[(currentIndex + 1) % diagonalRotations.length]
    }
  } else if (piece.type === 'scarab') {
    // Scarabs: flip between two orientations (NE/SW or NW/SE)
    // They're double-mirrored, so they effectively have only 2 positions
    if (currentFacing === 'NE') {
      newFacing = 'SW'
    } else if (currentFacing === 'SW') {
      newFacing = 'NE'
    } else if (currentFacing === 'NW') {
      newFacing = 'SE'
    } else if (currentFacing === 'SE') {
      newFacing = 'NW'
    }
  }
  
  piece.facing = newFacing
  
  // Clear selection, render the board to show the rotation, then fire laser
  clearSelection()
  renderBoard()
  
  // Use setTimeout to ensure the DOM updates before firing laser
  setTimeout(() => {
    handleFireLaser()
  }, 50)
}

// End current player's turn
function endTurn() {
  gameState.actionTaken = true
  gameState.currentPlayer = gameState.currentPlayer === RED ? SILVER : RED
  renderBoard()
  updateUrlHash()
}

// Handle laser firing
function handleFireLaser() {
  if (gameState.gameOver) return
  if (laserActive) return
  
  const path = computeLaserPath()
  if (!path || path.length === 0) return

  laserActive = true
  clearLaserLayer()
  renderLaserPath(path)
  
  // Update laser tip glow to active state
  updateLaserTipGlow()

  const endpoint = path[path.length - 1]
  if (endpoint.hit && endpoint.hitPiece) {
    handleLaserHit(endpoint)
  }

  if (activeLaserTimeout) {
    clearTimeout(activeLaserTimeout)
  }

  activeLaserTimeout = setTimeout(() => {
    if (!gameState.gameOver) {
      clearLaserLayer()
    }
    laserActive = false
    // Update laser tip glow back to normal state
    updateLaserTipGlow()
    if (gameState.gameOver) {
      // Show the game over overlay after a brief delay to let the laser remain visible
      setTimeout(() => {
        showGameOverOverlay()
      }, 800)
    } else {
      endTurn()
    }
  }, LASER_DURATION)
}

function computeLaserPath() {
  const sphinxInfo = findCurrentPlayerSphinx()
  if (!sphinxInfo) return []

  let { row: currentRow, col: currentCol, facing } = sphinxInfo
  let direction = facing
  if (!CARDINAL_VECTORS[direction]) return []

  const path = []
  const visited = new Set()

  for (let step = 0; step < MAX_LASER_STEPS; step += 1) {
    const stateKey = `${currentRow}-${currentCol}-${direction}`
    if (visited.has(stateKey)) break
    visited.add(stateKey)

    const vector = CARDINAL_VECTORS[direction]
    if (!vector) break

    const nextRow = currentRow + vector.row
    const nextCol = currentCol + vector.col

    const segment = {
      startRow: currentRow,
      startCol: currentCol,
      endRow: nextRow,
      endCol: nextCol,
      direction
    }

    if (nextRow < 0 || nextRow >= BOARD_ROWS || nextCol < 0 || nextCol >= BOARD_COLS) {
      segment.outOfBounds = true
      path.push(segment)
      break
    }

    const targetPiece = gameState.board[nextRow][nextCol]
    segment.targetPiece = targetPiece
    path.push(segment)

    if (!targetPiece) {
      currentRow = nextRow
      currentCol = nextCol
      continue
    }

    // Pass the direction the laser is coming FROM (opposite of travel direction)
    const entryDirection = OPPOSITE_DIRECTIONS[direction]
    const interaction = resolveLaserInteraction(targetPiece, entryDirection)

    if (interaction.type === 'reflect') {
      direction = interaction.newDirection
      currentRow = nextRow
      currentCol = nextCol
      segment.reflected = true
      continue
    }

    if (interaction.type === 'absorb') {
      segment.absorbed = true
      segment.hitPiece = targetPiece
      segment.hitRow = nextRow
      segment.hitCol = nextCol
      break
    }

    if (interaction.type === 'destroy') {
      segment.hit = true
      segment.hitPiece = targetPiece
      segment.hitRow = nextRow
      segment.hitCol = nextCol
      segment.destroyed = true
      break
    }
  }

  return path
}

function resolveLaserInteraction(piece, direction) {
  if (piece.type === 'scarab') {
    const isSlash = SCARAB_SLASH_FACINGS.has(piece.facing)
    const mapping = isSlash ? SLASH_REFLECTION_MAPPING : BACKSLASH_REFLECTION_MAPPING
    const newDirection = mapping[direction]
    if (!newDirection) return { type: 'absorb' }
    return { type: 'reflect', newDirection }
  }

  if (piece.type === 'pyramid') {
    const entries = PYRAMID_MIRROR_ENTRIES[piece.facing]
    const usesSlash = piece.facing === 'NE' || piece.facing === 'SW'
    const mapping = usesSlash ? SLASH_REFLECTION_MAPPING : BACKSLASH_REFLECTION_MAPPING
    
    if (entries && entries.has(direction)) {
      const newDirection = mapping[direction]
      if (!newDirection) return { type: 'absorb' }
      return { type: 'reflect', newDirection }
    }

    return { type: 'destroy' }
  }

  if (piece.type === 'anubis') {
    // Anubis shielded side is the same as its facing direction (the long side of trapezoid)
    const shieldedDirection = piece.facing
    if (direction === shieldedDirection) {
      return { type: 'absorb' }
    }

    return { type: 'destroy' }
  }

  if (piece.type === 'sphinx') {
    return { type: 'absorb' }
  }

  // Pharaohs and any other pieces are destroyed when hit
  return { type: 'destroy' }
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

  path.forEach(segment => {
    const startCenter = getSquareCenter(segment.startRow, segment.startCol, boardRect)
    if (!startCenter) return

    let endCenter = null
    if (segment.outOfBounds) {
      // Calculate end position as percentage
      endCenter = {
        x: startCenter.x + CARDINAL_VECTORS[segment.direction].col * (squareWidthPercent / 2),
        y: startCenter.y + CARDINAL_VECTORS[segment.direction].row * (squareHeightPercent / 2)
      }
    } else {
      endCenter = getSquareCenter(segment.endRow, segment.endCol, boardRect)
    }

    if (!endCenter) return

    const laserSegment = document.createElement('div')
    laserSegment.className = 'laser-path'

    const deltaX = endCenter.x - startCenter.x
    const deltaY = endCenter.y - startCenter.y

    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      const lengthPercent = Math.abs(deltaX)
      laserSegment.style.width = `${lengthPercent}%`
      laserSegment.style.height = `${laserThicknessPercentHeight}%`
      laserSegment.style.left = `${Math.min(startCenter.x, endCenter.x)}%`
      laserSegment.style.top = `${startCenter.y - (laserThicknessPercentHeight / 2)}%`
    } else {
      const lengthPercent = Math.abs(deltaY)
      laserSegment.style.width = `${laserThicknessPercentWidth}%`
      laserSegment.style.height = `${lengthPercent}%`
      laserSegment.style.left = `${startCenter.x - (laserThicknessPercentWidth / 2)}%`
      laserSegment.style.top = `${Math.min(startCenter.y, endCenter.y)}%`
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
  }

  if (hitPiece.type === 'pharaoh') {
    gameState.gameOver = true
    // Winner is the OPPOSITE player - whoever shot their own pharaoh loses
    gameState.winner = gameState.currentPlayer === RED ? SILVER : RED
    // Overlay will be shown after the laser animation in handleFireLaser
    persistLaserPath()
    updateUrlHash()
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
  
  // Create particle container
  const particleContainer = document.createElement('div')
  particleContainer.className = 'particle-container'
  particleContainer.style.left = `${squareCenter.x}%`
  particleContainer.style.top = `${squareCenter.y}%`
  
  // Create multiple particles flying in random directions
  const particleCount = 12
  for (let i = 0; i < particleCount; i++) {
    const particle = document.createElement('div')
    particle.className = 'destruction-particle'
    
    // Random direction and distance
    // Distance: 25-40px originally = 35.7-57.1% of 70px square
    // Use percentage of square size
    const angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5
    const distancePercent = (35.7 + Math.random() * 21.4) / 100 // 35.7-57.1% of square
    const duration = 800 + Math.random() * 400 // 800-1200ms duration
    
    // Calculate end position as percentage of board dimensions
    const endXPercent = Math.cos(angle) * distancePercent * squareWidthPercent
    const endYPercent = Math.sin(angle) * distancePercent * squareHeightPercent
    
    particle.style.setProperty('--end-x', `${endXPercent}%`)
    particle.style.setProperty('--end-y', `${endYPercent}%`)
    particle.style.setProperty('--duration', `${duration}ms`)
    
    particleContainer.appendChild(particle)
  }
  
  // Add to laser layer so they appear above pieces
  ensureLaserLayer()
  laserLayerElement.appendChild(glowElement)
  laserLayerElement.appendChild(particleContainer)
  
  // Remove the animation elements after they finish
  setTimeout(() => {
    if (glowElement.parentNode) {
      glowElement.remove()
    }
    if (particleContainer.parentNode) {
      particleContainer.remove()
    }
  }, 1500) // Remove after 1.5 seconds
}

function ensureLaserLayer() {
  const boardElement = document.getElementById('game-board')
  if (!boardElement) return

  if (!laserLayerElement || !boardElement.contains(laserLayerElement)) {
    laserLayerElement = document.createElement('div')
    laserLayerElement.className = 'laser-layer'
    boardElement.insertBefore(laserLayerElement, boardElement.firstChild)
  }
}

function clearLaserLayer() {
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
  const availableHeight = Math.max(viewportHeight - bodyPaddingTop - bodyPaddingBottom - appPadding - headerHeight - controlsHeight - gap, 0)
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
  const xPercent = ((squareRect.left - boardRect.left + (boardRect.width / BOARD_COLS) / 2) / boardRect.width) * 100
  const yPercent = ((squareRect.top - boardRect.top + (boardRect.height / BOARD_ROWS) / 2) / boardRect.height) * 100
  return {
    x: xPercent,
    y: yPercent,
    xPx: squareRect.left - boardRect.left + (boardRect.width / BOARD_COLS) / 2,
    yPx: squareRect.top - boardRect.top + (boardRect.height / BOARD_ROWS) / 2
  }
}

function findCurrentPlayerSphinx() {
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const piece = gameState.board[row][col]
      if (piece && piece.type === 'sphinx' && piece.player === gameState.currentPlayer) {
        return { row, col, facing: piece.facing }
      }
    }
  }

  return null
}

// Handle game reset
function handleResetGame() {
  showResetConfirmationOverlay()
}

// Show reset confirmation overlay
function showResetConfirmationOverlay() {
  const overlay = document.getElementById('game-over-overlay')
  const winnerText = document.getElementById('winner-text')
  const playAgainBtn = document.getElementById('play-again-btn')
  
  winnerText.textContent = 'Are you sure you want to reset the game?'
  
  // Remove existing cancel button if it exists
  const existingCancelBtn = document.querySelector('.game-over-content .btn-secondary')
  if (existingCancelBtn) {
    existingCancelBtn.remove()
  }
  
  // Add cancel button first (left side)
  const cancelBtn = document.createElement('button')
  cancelBtn.textContent = 'Nevermind'
  cancelBtn.className = 'btn btn-secondary'
  cancelBtn.style.marginRight = '0.625em'
  cancelBtn.onclick = hideResetConfirmationOverlay
  
  // Update play again button to be reset button (right side)
  playAgainBtn.textContent = 'Reset Game'
  playAgainBtn.onclick = confirmResetGame
  
  // Insert cancel button before the reset button
  playAgainBtn.parentNode.insertBefore(cancelBtn, playAgainBtn)
  
  overlay.classList.remove('hidden')
}

// Hide reset confirmation overlay
function hideResetConfirmationOverlay() {
  const overlay = document.getElementById('game-over-overlay')
  const playAgainBtn = document.getElementById('play-again-btn')
  
  // Restore original play again button
  playAgainBtn.textContent = 'Play Again'
  playAgainBtn.onclick = handlePlayAgain
  
  // Remove cancel button
  const cancelBtn = document.querySelector('.game-over-content .btn-secondary')
  if (cancelBtn) {
    cancelBtn.remove()
  }
  
  overlay.classList.add('hidden')
}

// Confirm reset game
function confirmResetGame() {
  hideResetConfirmationOverlay()
  
  console.log('Resetting game...')
  
  // Clear the hash so initGame doesn't reload old state
  if (DEV_MODE) {
    window.history.pushState(null, '', window.location.pathname + window.location.search)
  } else {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  
  gameState.currentPlayer = SILVER  // Silver always goes first
  gameState.selectedPiece = null
  gameState.selectedSquare = null
  gameState.gameOver = false
  gameState.winner = null
  gameState.actionTaken = false
  
  clearLaserLayer()
  laserActive = false
  if (activeLaserTimeout) {
    clearTimeout(activeLaserTimeout)
    activeLaserTimeout = null
  }

  // Initialize new game, skipping hash check
  initGame(true)
  
  // Update hash with new initial state
  updateUrlHash()
  updateLaserTipGlow() // Ensure laser tip glow reflects new current player
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
  
  // Clear the hash so initGame doesn't reload old state
  if (DEV_MODE) {
    window.history.pushState(null, '', window.location.pathname + window.location.search)
  } else {
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }
  
  // Reset game state
  gameState.currentPlayer = SILVER  // Silver always goes first
  gameState.selectedPiece = null
  gameState.selectedSquare = null
  gameState.gameOver = false
  gameState.winner = null
  gameState.actionTaken = false
  
  clearLaserLayer()
  laserActive = false
  if (activeLaserTimeout) {
    clearTimeout(activeLaserTimeout)
    activeLaserTimeout = null
  }

  // Initialize new game, skipping hash check
  initGame(true)
  
  // Update hash with new initial state
  updateUrlHash()
  updateLaserTipGlow() // Ensure laser tip glow reflects new current player
}

// URL Hash Management
function updateUrlHash() {
  try {
    const encoded = encodeState(gameState)
    const hash = `#v=1.s=${encoded}`
    
    if (DEV_MODE && !isLoadingFromHash) {
      // Dev mode: use pushState to create history entries (allows undo via back button)
      window.history.pushState({ gameState }, '', hash)
      console.log('[DEV MODE] State saved to history, hash updated')
      
      // Re-render from hash to verify encoding/decoding works
      setTimeout(() => {
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

  // Set game state
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