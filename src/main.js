// Khet - Laser Chess Main Entry Point

import "./style.css"

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
  currentPlayer: RED,
  selectedPiece: null,
  selectedSquare: null,
  board: [],
  gameOver: false,
  winner: null,
  actionTaken: false // Track if player has taken an action this turn
}

// Initialize the game
function initGame() {
  console.log('Initializing Khet game...')
  
  // Create empty board (8 rows x 10 columns)
  gameState.board = Array(8)
    .fill(null)
    .map(() => Array(10).fill(null))
  
  // Set up initial piece positions (Classic setup)
  setupClassicLayout()
  
  // Render the board
  renderBoard()
  
  // Update player display
  updatePlayerDisplay()
  
  // Set up event listeners
  setupEventListeners()
  
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
        pieceElement.innerHTML = getPieceSVG(piece)
        
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
}

// Create SVG for a piece based on type and facing
function getPieceSVG(piece) {
  const size = 60
  const center = size / 2
  const rotation = getRotationDegrees(piece.facing)

  switch (piece.type) {
    case 'sphinx':
      return createSphinxSVG(size, center, rotation, piece.player)
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

function createSphinxSVG(size, center, rotation, player) {
  const head = `M ${center} ${center - 20} L ${center + 22} ${center + 20} L ${center - 22} ${center + 20} Z`
  return `
    <svg viewBox="0 0 ${size} ${size}" class="piece-svg player${player}">
      <path d="${head}" class="piece-body" transform="rotate(${rotation} ${center} ${center})" />
      <polygon points="${center},${center - 20} ${center + 10},${center} ${center - 10},${center}" class="piece-tip" transform="rotate(${rotation} ${center} ${center})" />
    </svg>
  `
}

function createPharaohSVG(size, center, player) {
  const headdressWidth = size * 0.62
  const headdressHeight = size * 0.64
  const headdressTop = center - headdressHeight / 2
  const headdressBottom = center + headdressHeight / 2
  const headdressLeft = center - headdressWidth / 2
  const headdressRight = center + headdressWidth / 2

  const faceRadiusX = headdressWidth * 0.22
  const faceRadiusY = headdressHeight * 0.32
  const faceCenterY = center + headdressHeight * 0.05

  const collarWidth = size * 0.52
  const collarHeight = size * 0.16
  const baseWidth = size * 0.34
  const baseHeight = size * 0.2
  const baseTop = headdressBottom + size * 0.02
  const gemRadius = size * 0.055
  const chestTop = headdressBottom - collarHeight * 0.3

  const headdressPath = [
    `M ${headdressLeft} ${headdressBottom - size * 0.08}`,
    `Q ${center - headdressWidth * 0.62} ${headdressTop + headdressHeight * 0.28} ${center} ${headdressTop}`,
    `Q ${center + headdressWidth * 0.62} ${headdressTop + headdressHeight * 0.28} ${headdressRight} ${headdressBottom - size * 0.08}`,
    `L ${center + collarWidth / 2} ${headdressBottom}`,
    `L ${center - collarWidth / 2} ${headdressBottom}`,
    'Z'
  ].join(' ')

  const torsoPath = [
    `M ${center - collarWidth / 2} ${headdressBottom}`,
    `L ${center - baseWidth / 2} ${chestTop + baseHeight}`,
    `L ${center + baseWidth / 2} ${chestTop + baseHeight}`,
    `L ${center + collarWidth / 2} ${headdressBottom}`,
    'Z'
  ].join(' ')

  const stripeLeft = [
    `M ${center - faceRadiusX * 1.5} ${headdressTop + headdressHeight * 0.22}`,
    `Q ${center - headdressWidth * 0.32} ${center} ${center - collarWidth / 2 + collarHeight * 0.5} ${headdressBottom - collarHeight * 0.28}`
  ].join(' ')

  const stripeRight = [
    `M ${center + faceRadiusX * 1.5} ${headdressTop + headdressHeight * 0.22}`,
    `Q ${center + headdressWidth * 0.32} ${center} ${center + collarWidth / 2 - collarHeight * 0.5} ${headdressBottom - collarHeight * 0.28}`
  ].join(' ')

  const browPath = [
    `M ${center - faceRadiusX * 0.8} ${faceCenterY - faceRadiusY * 0.55}`,
    `Q ${center} ${faceCenterY - faceRadiusY * 0.85} ${center + faceRadiusX * 0.8} ${faceCenterY - faceRadiusY * 0.55}`
  ].join(' ')

  return `
    <svg viewBox="0 0 ${size} ${size}" class="piece-svg player${player}">
      <path d="${headdressPath}" class="piece-body pharaoh-headdress" />
      <ellipse cx="${center}" cy="${faceCenterY}" rx="${faceRadiusX}" ry="${faceRadiusY}" class="pharaoh-face" />
      <path d="${torsoPath}" class="piece-body pharaoh-torso" />
      <rect x="${center - collarWidth / 2}" y="${headdressBottom - collarHeight}" width="${collarWidth}" height="${collarHeight}" rx="${collarHeight / 3}" class="pharaoh-collar" />
      <rect x="${center - baseWidth / 2}" y="${baseTop}" width="${baseWidth}" height="${baseHeight}" rx="${baseHeight / 3}" class="pharaoh-base" />
      <circle cx="${center}" cy="${chestTop + baseHeight * 0.45}" r="${gemRadius}" class="pharaoh-gem" />
      <path d="${stripeLeft}" class="pharaoh-stripe" />
      <path d="${stripeRight}" class="pharaoh-stripe" />
      <path d="${browPath}" class="pharaoh-brow" />
      <line x1="${center}" y1="${faceCenterY - faceRadiusY * 0.45}" x2="${center}" y2="${faceCenterY + faceRadiusY * 0.6}" class="pharaoh-centerline" />
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
  const fireLaserBtn = document.getElementById('fire-laser')
  const resetGameBtn = document.getElementById('reset-game')
  
  boardElement.addEventListener('click', handleSquareClick)
  fireLaserBtn.addEventListener('click', handleFireLaser)
  resetGameBtn.addEventListener('click', handleResetGame)
}

// Update player display
function updatePlayerDisplay() {
  const display = document.getElementById('current-player-display')
  const playerName = gameState.currentPlayer === RED ? 'Red' : 'Silver'
  display.textContent = `Player ${playerName}'s Turn`
  display.className = `current-player player-${playerName.toLowerCase()}`
}

// Handle square clicks
function handleSquareClick(event) {
  if (gameState.gameOver) return
  
  const square = event.target.closest('.square')
  if (!square) return
  
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
    const rotationControls = document.createElement('div')
    rotationControls.className = 'rotation-controls'
    
    if (piece.type === 'sphinx') {
      // Sphinx only has one rotation button (they can only rotate in one direction)
      const rotateBtn = document.createElement('button')
      rotateBtn.className = 'rotation-btn'
      rotateBtn.textContent = '↷'
      rotateBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        rotatePiece(row, col, 'right')
      })
      rotationControls.appendChild(rotateBtn)
    } else {
      // Other pieces have both left and right rotation buttons
      const rotateLeftBtn = document.createElement('button')
      rotateLeftBtn.className = 'rotation-btn'
      rotateLeftBtn.textContent = '↶'
      rotateLeftBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        rotatePiece(row, col, 'left')
      })
      
      const rotateRightBtn = document.createElement('button')
      rotateRightBtn.className = 'rotation-btn'
      rotateRightBtn.textContent = '↷'
      rotateRightBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        rotatePiece(row, col, 'right')
      })
      
      rotationControls.appendChild(rotateLeftBtn)
      rotationControls.appendChild(rotateRightBtn)
    }
    
    pieceContainer.appendChild(rotationControls)
  }
}

// Remove piece controls
function removePieceControls() {
  document.querySelectorAll('.rotation-controls').forEach(el => {
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
  
  // Clear selection and end turn
  clearSelection()
  endTurn()
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
  
  // Clear selection and end turn
  clearSelection()
  endTurn()
}

// End current player's turn
function endTurn() {
  gameState.actionTaken = true
  gameState.currentPlayer = gameState.currentPlayer === RED ? SILVER : RED
  updatePlayerDisplay()
  renderBoard()
}

// Handle laser firing
function handleFireLaser() {
  if (gameState.gameOver) return
  
  console.log(`Player ${gameState.currentPlayer} fires laser!`)
  
  // TODO: Implement laser mechanics
}

// Handle game reset
function handleResetGame() {
  console.log('Resetting game...')
  gameState.currentPlayer = RED
  gameState.selectedPiece = null
  gameState.selectedSquare = null
  gameState.gameOver = false
  gameState.winner = null
  gameState.actionTaken = false
  
  initGame()
}

// Start the game when DOM is loaded
document.addEventListener('DOMContentLoaded', initGame)