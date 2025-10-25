// Khet Game State Management

import { SILVER, BOARD_ROWS, BOARD_COLS, GAME_MODES } from './types.js'

// Classic Khet 2.0 starting positions
const CLASSIC_SETUP = [
  // Red pieces (top)
  { row: 0, col: 0, type: 'sphinx', player: 'red', facing: 'S' },
  { row: 0, col: 4, type: 'anubis', player: 'red', facing: 'S' },
  { row: 0, col: 5, type: 'pharaoh', player: 'red', facing: 'S' },
  { row: 0, col: 6, type: 'anubis', player: 'red', facing: 'S' },
  { row: 0, col: 9, type: 'pyramid', player: 'red', facing: 'SE' },
  
  { row: 1, col: 2, type: 'pyramid', player: 'red', facing: 'SW' },
  
  { row: 2, col: 3, type: 'pyramid', player: 'silver', facing: 'NW' },
  
  { row: 3, col: 1, type: 'pyramid', player: 'red', facing: 'NE' },
  { row: 3, col: 3, type: 'pyramid', player: 'silver', facing: 'SW' },
  { row: 3, col: 4, type: 'scarab', player: 'red', facing: 'NE' },
  { row: 3, col: 5, type: 'scarab', player: 'red', facing: 'SE' },
  { row: 3, col: 7, type: 'pyramid', player: 'red', facing: 'SE' },
  { row: 3, col: 9, type: 'pyramid', player: 'silver', facing: 'NW' },
  
  { row: 4, col: 1, type: 'pyramid', player: 'red', facing: 'SE' },
  { row: 4, col: 3, type: 'pyramid', player: 'silver', facing: 'NW' },
  { row: 4, col: 4, type: 'scarab', player: 'silver', facing: 'SE' },
  { row: 4, col: 5, type: 'scarab', player: 'silver', facing: 'NE' },
  { row: 4, col: 7, type: 'pyramid', player: 'red', facing: 'NE' },
  { row: 4, col: 9, type: 'pyramid', player: 'silver', facing: 'SW' },
  
  { row: 5, col: 6, type: 'pyramid', player: 'red', facing: 'SE' },
  
  { row: 6, col: 6, type: 'pyramid', player: 'silver', facing: 'NE' },
  
  // Silver pieces (bottom)
  { row: 7, col: 3, type: 'pyramid', player: 'silver', facing: 'NW' },
  { row: 7, col: 4, type: 'anubis', player: 'silver', facing: 'N' },
  { row: 7, col: 5, type: 'pharaoh', player: 'silver', facing: 'N' },
  { row: 7, col: 6, type: 'anubis', player: 'silver', facing: 'N' },
  { row: 7, col: 9, type: 'sphinx', player: 'silver', facing: 'N' }
]

/**
 * Create initial game state
 * @param {string} preset - Board setup preset ('classic', 'imhotep', 'dynasty')
 * @param {string} startingPlayer - Who goes first ('red' or 'silver')
 * @returns {Object} Initial game state
 */
export function createInitialState(preset = 'classic', startingPlayer = SILVER) {
  const board = Array(BOARD_ROWS).fill(null).map(() => Array(BOARD_COLS).fill(null))
  
  // Place pieces based on preset
  if (preset === 'classic') {
    CLASSIC_SETUP.forEach(({ row, col, type, player, facing }) => {
      board[row][col] = { type, player, facing }
    })
  }
  
  return {
    currentPlayer: startingPlayer,
    board,
    gameOver: false,
    winner: null,
    gameMode: GAME_MODES.PVP
  }
}

/**
 * Deep clone game state
 * @param {Object} state - Game state to clone
 * @returns {Object} Cloned game state
 */
export function cloneState(state) {
  return {
    currentPlayer: state.currentPlayer,
    board: state.board.map(row => row.map(cell => cell ? { ...cell } : null)),
    gameOver: state.gameOver,
    winner: state.winner,
    gameMode: state.gameMode
  }
}

/**
 * Get piece at board position
 * @param {Object} state - Game state
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @returns {Object|null} Piece or null
 */
export function getPieceAt(state, row, col) {
  if (row < 0 || row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) {
    return null
  }
  return state.board[row][col]
}

/**
 * Set piece at board position
 * @param {Object} state - Game state
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @param {Object|null} piece - Piece to place or null to remove
 * @returns {Object} New game state with piece placed
 */
export function setPieceAt(state, row, col, piece) {
  const newState = cloneState(state)
  newState.board[row][col] = piece
  return newState
}

/**
 * Check if position is on board
 * @param {number} row - Row index
 * @param {number} col - Column index
 * @returns {boolean} True if position is valid
 */
export function isValidPosition(row, col) {
  return row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS
}

/**
 * Get all pieces for a player
 * @param {Object} state - Game state
 * @param {string} player - Player color
 * @returns {Array} Array of {row, col, piece} objects
 */
export function getPlayerPieces(state, player) {
  const pieces = []
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = state.board[row][col]
      if (piece && piece.player === player) {
        pieces.push({ row, col, piece })
      }
    }
  }
  return pieces
}

/**
 * Find piece on board
 * @param {Object} state - Game state
 * @param {string} type - Piece type
 * @param {string} player - Player color
 * @returns {Object|null} {row, col, piece} or null if not found
 */
export function findPiece(state, type, player) {
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = state.board[row][col]
      if (piece && piece.type === type && piece.player === player) {
        return { row, col, piece }
      }
    }
  }
  return null
}
