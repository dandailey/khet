// Extracted from main:src/main.js. See ../../README.md for the extraction boundary.

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

let gameState = {
  currentPlayer: SILVER,  // Silver (blue) goes first
  selectedPiece: null,
  selectedSquare: null,
  board: [],
  gameOver: false,
  winner: null,
  actionTaken: false // Track if player has taken an action this turn
}

function setPiece(row, col, type, player, facing = 'N') {
  gameState.board[row][col] = { type, player, facing }
}

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

function showMoveOptions(row, col, piece) {
  const moves = []
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
      const targetPiece = gameState.board[newRow][newCol]
      
      // Check if move is valid
      if (isValidMove(row, col, newRow, newCol, piece, targetPiece)) {
        moves.push({ row: newRow, col: newCol })
      }
    }
  })
  return moves
}

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
  
}

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
  
}

function endTurn() {
  gameState.actionTaken = true
  gameState.currentPlayer = gameState.currentPlayer === RED ? SILVER : RED
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

function handleLaserHit(endpoint) {
  const { hitPiece, hitRow, hitCol, absorbed } = endpoint
  if (!hitPiece) return

  // Only remove the piece if it was destroyed, not absorbed by Anubis shield
  if (!absorbed) {
    gameState.board[hitRow][hitCol] = null
  }

  if (hitPiece.type === 'pharaoh') {
    gameState.gameOver = true
    // Winner is the OPPOSITE player - whoever shot their own pharaoh loses
    gameState.winner = gameState.currentPlayer === RED ? SILVER : RED
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

// Minimal rules extracted from addPieceControls; rendering and event registration omitted.
function rotationDirections(row, col, piece) {
  if (piece.type !== 'pharaoh') {
    if (piece.type === 'sphinx') {
      let rotationDirection = ''
      
      if (row === 0 && col === 0) {
        // Red sphinx in top-left: can face E or S
        if (piece.facing === 'E') {
          // Currently facing East, clicking rotates to South
          rotationDirection = 'right'
        } else {
          // Currently facing South, clicking rotates to East
          rotationDirection = 'left'
        }
      } else if (row === 7 && col === 9) {
        // Silver sphinx in bottom-right: can face W or N
        if (piece.facing === 'W') {
          // Currently facing West, clicking rotates to North
          rotationDirection = 'right'
        } else {
          // Currently facing North, clicking rotates to West
          rotationDirection = 'left'
        }
      }
      
      return [rotationDirection]
    } else {
      return ['left', 'right']
    }
  }
  return []
}

// Headless plumbing: retain the original global-state functions in an isolated synchronous call.
export function withGameState(state, callback) {
  const previous = gameState
  gameState = state
  try {
    return callback()
  } finally {
    gameState = previous
  }
}

export function createInitialState() {
  return withGameState({
    currentPlayer: SILVER,
    selectedPiece: null,
    selectedSquare: null,
    board: Array(8).fill(null).map(() => Array(10).fill(null)),
    gameOver: false,
    winner: null,
    actionTaken: false
  }, () => {
    setupClassicLayout()
    return gameState
  })
}

// handleFireLaser without rendering, laserActive or timers; callback runs immediately.
export function fireLaser() {
  if (gameState.gameOver) return []
  const path = computeLaserPath()
  if (!path || path.length === 0) return []
  const endpoint = path[path.length - 1]
  if (endpoint.hit && endpoint.hitPiece) {
    handleLaserHit(endpoint)
  }
  if (!gameState.gameOver) {
    endTurn()
  }
  return path
}

export {
  RED, SILVER, showMoveOptions, isValidMove, rotationDirections,
  movePiece, rotatePiece, endTurn, computeLaserPath,
  resolveLaserInteraction, handleLaserHit, findCurrentPlayerSphinx, setupClassicLayout
}
