// Khet Game Evaluation Heuristics

import { RED, SILVER, PHARAOH, SPHINX, PYRAMID, ANUBIS, SCARAB } from './types.js'
import { getPlayerPieces, findPiece } from './state.js'
import { generateLegalMoves } from './rules.js'
import { traceLaser } from './laser.js'

// Piece values for material evaluation
const PIECE_VALUES = {
  [PHARAOH]: 1000,  // King - most valuable
  [SPHINX]: 100,    // Laser emitter
  [ANUBIS]: 50,     // Bodyguard
  [PYRAMID]: 30,    // Mirror piece
  [SCARAB]: 40      // Double mirror
}

/**
 * Evaluate board position for a player
 * @param {Object} state - Game state
 * @param {string} player - Player to evaluate for
 * @returns {number} Evaluation score (higher is better for player)
 */
export function evaluate(state, player) {
  // Check for immediate win/loss
  if (state.gameOver) {
    if (state.winner === player) {
      return 10000 // Win
    } else {
      return -10000 // Loss
    }
  }
  
  let score = 0
  
  // Material balance
  score += evaluateMaterial(state, player)
  
  // King safety
  score += evaluateKingSafety(state, player)
  
  // Mobility
  score += evaluateMobility(state, player)
  
  // Laser pressure
  score += evaluateLaserPressure(state, player)
  
  // Positional factors
  score += evaluatePosition(state, player)
  
  return score
}

/**
 * Evaluate material balance
 * @param {Object} state - Game state
 * @param {string} player - Player to evaluate for
 * @returns {number} Material score
 */
function evaluateMaterial(state, player) {
  const myPieces = getPlayerPieces(state, player)
  const opponentPieces = getPlayerPieces(state, player === RED ? SILVER : RED)
  
  let myMaterial = 0
  let opponentMaterial = 0
  
  myPieces.forEach(({ piece }) => {
    myMaterial += PIECE_VALUES[piece.type] || 0
  })
  
  opponentPieces.forEach(({ piece }) => {
    opponentMaterial += PIECE_VALUES[piece.type] || 0
  })
  
  return myMaterial - opponentMaterial
}

/**
 * Evaluate king (pharaoh) safety
 * @param {Object} state - Game state
 * @param {string} player - Player to evaluate for
 * @returns {number} King safety score
 */
function evaluateKingSafety(state, player) {
  const myPharaoh = findPiece(state, PHARAOH, player)
  const opponentPharaoh = findPiece(state, PHARAOH, player === RED ? SILVER : RED)
  
  if (!myPharaoh || !opponentPharaoh) {
    return 0
  }
  
  let score = 0
  
  // Check if my pharaoh is under immediate threat
  const myThreats = getLaserThreats(state, myPharaoh.row, myPharaoh.col, player === RED ? SILVER : RED)
  score -= myThreats * 200 // Heavy penalty for being under threat
  
  // Check if opponent pharaoh is under immediate threat
  const opponentThreats = getLaserThreats(state, opponentPharaoh.row, opponentPharaoh.col, player)
  score += opponentThreats * 200 // Bonus for threatening opponent
  
  // Evaluate pharaoh position (center is generally safer)
  score += evaluatePharaohPosition(myPharaoh.row, myPharaoh.col)
  score -= evaluatePharaohPosition(opponentPharaoh.row, opponentPharaoh.col)
  
  return score
}

/**
 * Evaluate piece mobility
 * @param {Object} state - Game state
 * @param {string} player - Player to evaluate for
 * @returns {number} Mobility score
 */
function evaluateMobility(state, player) {
  const myMoves = generateLegalMoves(state, player)
  const opponentMoves = generateLegalMoves(state, player === RED ? SILVER : RED)
  
  return (myMoves.length - opponentMoves.length) * 2
}

/**
 * Evaluate laser pressure and threats
 * @param {Object} state - Game state
 * @param {string} player - Player to evaluate for
 * @returns {number} Laser pressure score
 */
function evaluateLaserPressure(state, player) {
  let score = 0
  
  // Check my laser's potential
  const myLaserResult = traceLaser(state, player)
  score += myLaserResult.path.length * 5 // Longer laser paths are generally better
  
  // Check opponent's laser potential
  const opponentLaserResult = traceLaser(state, player === RED ? SILVER : RED)
  score -= opponentLaserResult.path.length * 5
  
  // Bonus for threatening opponent pharaoh
  const opponentPharaoh = findPiece(state, PHARAOH, player === RED ? SILVER : RED)
  if (opponentPharaoh && myLaserResult.path.some(point => 
    point.row === opponentPharaoh.row && point.col === opponentPharaoh.col)) {
    score += 500 // Big bonus for threatening pharaoh
  }
  
  // Penalty for my pharaoh being threatened
  const myPharaoh = findPiece(state, PHARAOH, player)
  if (myPharaoh && opponentLaserResult.path.some(point => 
    point.row === myPharaoh.row && point.col === myPharaoh.col)) {
    score -= 500 // Big penalty for pharaoh being threatened
  }
  
  return score
}

/**
 * Evaluate positional factors
 * @param {Object} state - Game state
 * @param {string} player - Player to evaluate for
 * @returns {number} Positional score
 */
function evaluatePosition(state, player) {
  let score = 0
  
  const myPieces = getPlayerPieces(state, player)
  
  myPieces.forEach(({ row, col, piece }) => {
    // Center control bonus
    const centerDistance = Math.abs(row - 3.5) + Math.abs(col - 4.5)
    score += (8 - centerDistance) * 2
    
    // Piece-specific positional bonuses
    switch (piece.type) {
      case PYRAMID:
        // Pyramids are better in defensive positions
        if (player === RED && row < 4) score += 10
        if (player === SILVER && row > 3) score += 10
        break
        
      case ANUBIS:
        // Anubis should protect pharaoh
        const pharaoh = findPiece(state, PHARAOH, player)
        if (pharaoh) {
          const distance = Math.abs(row - pharaoh.row) + Math.abs(col - pharaoh.col)
          score += (8 - distance) * 5
        }
        break
        
      case SCARAB:
        // Scarabs are valuable in center for swapping
        if (row >= 2 && row <= 5 && col >= 2 && col <= 7) {
          score += 15
        }
        break
    }
  })
  
  return score
}

/**
 * Get number of laser threats to a position
 * @param {Object} state - Game state
 * @param {number} row - Row position
 * @param {number} col - Column position
 * @param {string} threateningPlayer - Player who might threaten
 * @returns {number} Number of threats
 */
function getLaserThreats(state, row, col, threateningPlayer) {
  const laserResult = traceLaser(state, threateningPlayer)
  return laserResult.path.filter(point => point.row === row && point.col === col).length
}

/**
 * Evaluate pharaoh position
 * @param {number} row - Row position
 * @param {number} col - Column position
 * @returns {number} Position score
 */
function evaluatePharaohPosition(row, col) {
  // Center is generally safer
  const centerDistance = Math.abs(row - 3.5) + Math.abs(col - 4.5)
  return (8 - centerDistance) * 10
}

/**
 * Get piece value
 * @param {string} pieceType - Piece type
 * @returns {number} Piece value
 */
export function getPieceValue(pieceType) {
  return PIECE_VALUES[pieceType] || 0
}
