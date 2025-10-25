// Khet Game Rules and Move Generation

import { 
  RED, SILVER, PHARAOH, SPHINX, PYRAMID, ANUBIS, SCARAB,
  CARDINAL_VECTORS, OPPOSITE_DIRECTIONS, RESERVED_RED, RESERVED_SILVER,
  BOARD_ROWS, BOARD_COLS, MOVE_TYPES
} from './types.js'
import { getPieceAt, isValidPosition, cloneState } from './state.js'

/**
 * Generate all legal moves for a player
 * @param {Object} state - Game state
 * @param {string} player - Player color
 * @returns {Array} Array of move objects
 */
export function generateLegalMoves(state, player) {
  const moves = []
  
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = getPieceAt(state, row, col)
      if (!piece || piece.player !== player) continue
      
      // Generate moves based on piece type
      switch (piece.type) {
        case PHARAOH:
          moves.push(...generatePharaohMoves(state, row, col, piece))
          break
        case SPHINX:
          moves.push(...generateSphinxMoves(state, row, col, piece))
          break
        case PYRAMID:
          moves.push(...generatePyramidMoves(state, row, col, piece))
          break
        case ANUBIS:
          moves.push(...generateAnubisMoves(state, row, col, piece))
          break
        case SCARAB:
          moves.push(...generateScarabMoves(state, row, col, piece))
          break
      }
    }
  }
  
  return moves
}

/**
 * Generate moves for Pharaoh
 * @param {Object} state - Game state
 * @param {number} row - Row position
 * @param {number} col - Column position
 * @param {Object} piece - Piece object
 * @returns {Array} Array of move objects
 */
function generatePharaohMoves(state, row, col, piece) {
  const moves = []
  
  // Pharaoh can move in all 8 directions
  const directions = [
    { row: -1, col: -1 }, { row: -1, col: 0 }, { row: -1, col: 1 },
    { row: 0, col: -1 }, { row: 0, col: 1 },
    { row: 1, col: -1 }, { row: 1, col: 0 }, { row: 1, col: 1 }
  ]
  
  directions.forEach(({ row: dRow, col: dCol }) => {
    const newRow = row + dRow
    const newCol = col + dCol
    
    if (isValidPosition(newRow, newCol) && !getPieceAt(state, newRow, newCol)) {
      if (isValidMove(state, row, col, newRow, newCol, piece)) {
        moves.push({
          type: MOVE_TYPES.MOVE,
          from: { row, col },
          to: { row: newRow, col: newCol },
          piece
        })
      }
    }
  })
  
  return moves
}

/**
 * Generate moves for Sphinx (rotation only)
 * @param {Object} state - Game state
 * @param {number} row - Row position
 * @param {number} col - Column position
 * @param {Object} piece - Piece object
 * @returns {Array} Array of move objects
 */
function generateSphinxMoves(state, row, col, piece) {
  const moves = []
  
  // Sphinx can only rotate, not move
  const rotations = ['N', 'E', 'S', 'W']
  rotations.forEach(facing => {
    if (facing !== piece.facing) {
      moves.push({
        type: MOVE_TYPES.ROTATE,
        from: { row, col },
        to: { row, col },
        piece,
        newFacing: facing
      })
    }
  })
  
  return moves
}

/**
 * Generate moves for Pyramid
 * @param {Object} state - Game state
 * @param {number} row - Row position
 * @param {number} col - Column position
 * @param {Object} piece - Piece object
 * @returns {Array} Array of move objects
 */
function generatePyramidMoves(state, row, col, piece) {
  const moves = []
  
  // Movement (all 8 directions)
  const directions = [
    { row: -1, col: -1 }, { row: -1, col: 0 }, { row: -1, col: 1 },
    { row: 0, col: -1 }, { row: 0, col: 1 },
    { row: 1, col: -1 }, { row: 1, col: 0 }, { row: 1, col: 1 }
  ]
  
  directions.forEach(({ row: dRow, col: dCol }) => {
    const newRow = row + dRow
    const newCol = col + dCol
    
    if (isValidPosition(newRow, newCol) && !getPieceAt(state, newRow, newCol)) {
      if (isValidMove(state, row, col, newRow, newCol, piece)) {
        moves.push({
          type: MOVE_TYPES.MOVE,
          from: { row, col },
          to: { row: newRow, col: newCol },
          piece
        })
      }
    }
  })
  
  // Rotation
  const rotations = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  rotations.forEach(facing => {
    if (facing !== piece.facing) {
      moves.push({
        type: MOVE_TYPES.ROTATE,
        from: { row, col },
        to: { row, col },
        piece,
        newFacing: facing
      })
    }
  })
  
  return moves
}

/**
 * Generate moves for Anubis
 * @param {Object} state - Game state
 * @param {number} row - Row position
 * @param {number} col - Column position
 * @param {Object} piece - Piece object
 * @returns {Array} Array of move objects
 */
function generateAnubisMoves(state, row, col, piece) {
  const moves = []
  
  // Movement (all 8 directions)
  const directions = [
    { row: -1, col: -1 }, { row: -1, col: 0 }, { row: -1, col: 1 },
    { row: 0, col: -1 }, { row: 0, col: 1 },
    { row: 1, col: -1 }, { row: 1, col: 0 }, { row: 1, col: 1 }
  ]
  
  directions.forEach(({ row: dRow, col: dCol }) => {
    const newRow = row + dRow
    const newCol = col + dCol
    
    if (isValidPosition(newRow, newCol) && !getPieceAt(state, newRow, newCol)) {
      if (isValidMove(state, row, col, newRow, newCol, piece)) {
        moves.push({
          type: MOVE_TYPES.MOVE,
          from: { row, col },
          to: { row: newRow, col: newCol },
          piece
        })
      }
    }
  })
  
  // Rotation
  const rotations = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
  rotations.forEach(facing => {
    if (facing !== piece.facing) {
      moves.push({
        type: MOVE_TYPES.ROTATE,
        from: { row, col },
        to: { row, col },
        piece,
        newFacing: facing
      })
    }
  })
  
  return moves
}

/**
 * Generate moves for Scarab
 * @param {Object} state - Game state
 * @param {number} row - Row position
 * @param {number} col - Column position
 * @param {Object} piece - Piece object
 * @returns {Array} Array of move objects
 */
function generateScarabMoves(state, row, col, piece) {
  const moves = []
  
  // Movement (all 8 directions)
  const directions = [
    { row: -1, col: -1 }, { row: -1, col: 0 }, { row: -1, col: 1 },
    { row: 0, col: -1 }, { row: 0, col: 1 },
    { row: 1, col: -1 }, { row: 1, col: 0 }, { row: 1, col: 1 }
  ]
  
  directions.forEach(({ row: dRow, col: dCol }) => {
    const newRow = row + dRow
    const newCol = col + dCol
    
    if (isValidPosition(newRow, newCol)) {
      const targetPiece = getPieceAt(state, newRow, newCol)
      
      if (!targetPiece) {
        // Regular move
        if (isValidMove(state, row, col, newRow, newCol, piece)) {
          moves.push({
            type: MOVE_TYPES.MOVE,
            from: { row, col },
            to: { row: newRow, col: newCol },
            piece
          })
        }
      } else if (targetPiece.type === PYRAMID || targetPiece.type === ANUBIS) {
        // Scarab swap
        moves.push({
          type: MOVE_TYPES.SWAP,
          from: { row, col },
          to: { row: newRow, col: newCol },
          piece,
          targetPiece
        })
      }
    }
  })
  
  // Rotation
  const rotations = ['NE', 'SE', 'SW', 'NW']
  rotations.forEach(facing => {
    if (facing !== piece.facing) {
      moves.push({
        type: MOVE_TYPES.ROTATE,
        from: { row, col },
        to: { row, col },
        piece,
        newFacing: facing
      })
    }
  })
  
  return moves
}

/**
 * Check if a move is valid (reserved squares, etc.)
 * @param {Object} state - Game state
 * @param {number} fromRow - From row
 * @param {number} fromCol - From column
 * @param {number} toRow - To row
 * @param {number} toCol - To column
 * @param {Object} piece - Piece being moved
 * @returns {boolean} True if move is valid
 */
function isValidMove(state, fromRow, fromCol, toRow, toCol, piece) {
  const squareKey = `${toRow}-${toCol}`
  
  // Check reserved squares
  if (piece.player === RED && RESERVED_SILVER.has(squareKey)) return false
  if (piece.player === SILVER && RESERVED_RED.has(squareKey)) return false
  
  return true
}

/**
 * Apply a move to the game state
 * @param {Object} state - Current game state
 * @param {Object} move - Move to apply
 * @returns {Object} New game state after move
 */
export function applyMove(state, move) {
  const newState = cloneState(state)
  
  switch (move.type) {
    case MOVE_TYPES.MOVE:
      newState.board[move.to.row][move.to.col] = move.piece
      newState.board[move.from.row][move.from.col] = null
      break
      
    case MOVE_TYPES.ROTATE:
      newState.board[move.from.row][move.from.col] = {
        ...move.piece,
        facing: move.newFacing
      }
      break
      
    case MOVE_TYPES.SWAP:
      newState.board[move.to.row][move.to.col] = move.piece
      newState.board[move.from.row][move.from.col] = move.targetPiece
      break
  }
  
  return newState
}

/**
 * Switch current player
 * @param {Object} state - Game state
 * @returns {Object} New game state with switched player
 */
export function switchPlayer(state) {
  const newState = cloneState(state)
  newState.currentPlayer = newState.currentPlayer === RED ? SILVER : RED
  return newState
}
