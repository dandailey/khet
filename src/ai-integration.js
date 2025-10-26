// AI Integration Module for Khet

import { 
  chooseMoveEasy, shouldFireLaserEasy,
  RED, SILVER, GAME_MODES
} from './game/index.js'

/**
 * Check if current player is AI
 * @param {Object} gameState - Current game state
 * @returns {boolean} True if current player is AI
 */
export function isAITurn(gameState) {
  if (gameState.gameMode === 'pvp') return false
  
  // In PvC modes, Silver is always the AI
  return gameState.currentPlayer === SILVER
}

/**
 * Handle AI turn
 * @param {Object} gameState - Current game state
 * @param {Function} applyMove - Function to apply move to game state
 * @param {Function} fireLaser - Function to fire laser
 * @param {Function} endTurn - Function to end turn
 * @param {Function} showThinking - Function to show thinking indicator
 * @param {Function} hideThinking - Function to hide thinking indicator
 * @param {Function} disableInput - Function to disable human input
 * @param {Function} enableInput - Function to enable human input
 */
export async function handleAITurn(gameState, applyMove, fireLaser, endTurn, showThinking, hideThinking, disableInput, enableInput) {
  showThinking()
  disableInput()
  
  try {
    // Convert current game state to engine format
    const engineState = {
      currentPlayer: gameState.currentPlayer,
      board: gameState.board,
      gameOver: gameState.gameOver,
      winner: gameState.winner,
      gameMode: gameState.gameMode
    }
    
    // Get AI move
    const aiResult = await chooseMoveEasy(engineState, SILVER, { timeMs: 100 })
    
    if (aiResult && aiResult.move) {
      // Apply AI move
      applyMove(aiResult.move)
      
      // Fire laser after a short delay
      setTimeout(() => {
        fireLaser()
      }, 500)
    } else {
      // No legal moves, end turn
      endTurn()
    }
  } catch (error) {
    console.error('AI error:', error)
    endTurn()
  } finally {
    hideThinking()
    enableInput()
  }
}

/**
 * Apply AI move to game state
 * @param {Object} move - Move object from AI
 * @param {Object} gameState - Current game state
 */
export function applyAIMove(move, gameState) {
  switch (move.type) {
    case 'move':
      // Move piece
      const piece = gameState.board[move.from.row][move.from.col]
      gameState.board[move.to.row][move.to.col] = piece
      gameState.board[move.from.row][move.from.col] = null
      break
      
    case 'rotate':
      // Rotate piece
      const pieceToRotate = gameState.board[move.from.row][move.from.col]
      gameState.board[move.from.row][move.from.col] = {
        ...pieceToRotate,
        facing: move.newFacing
      }
      break
      
    case 'swap':
      // Swap pieces (Scarab)
      const scarab = gameState.board[move.from.row][move.from.col]
      const target = gameState.board[move.to.row][move.to.col]
      gameState.board[move.to.row][move.to.col] = scarab
      gameState.board[move.from.row][move.from.col] = target
      break
  }
}
