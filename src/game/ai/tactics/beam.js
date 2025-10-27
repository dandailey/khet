// Khet Tactics - Beam Influence Analysis
// Determines which squares are "beam-critical": in the current laser path or one move away from altering it

import { RED, SILVER, PHARAOH, SPHINX, PYRAMID, ANUBIS, SCARAB } from '../../types.js'
import { traceLaser, resolveLaser } from '../../laser.js'
import { getPieceAt, isValidPosition } from '../../state.js'
import { generateLegalMoves, applyMove } from '../../rules.js'

/**
 * Get beam influence set for both players
 * @param {Object} state - Game state
 * @returns {Object} { redInfluence: Set, silverInfluence: Set }
 */
export function getBeamInfluence(state) {
  // Trace both players' lasers
  const redBeam = traceLaser(state, RED)
  const silverBeam = traceLaser(state, SILVER)
  
  // Build influence sets
  const redInfluence = new Set()
  const silverInfluence = new Set()
  
  // Add current beam path squares
  redBeam.path.forEach(({ row, col }) => {
    redInfluence.add(`${row},${col}`)
  })
  
  silverBeam.path.forEach(({ row, col }) => {
    silverInfluence.add(`${row},${col}`)
  })
  
  // Add adjacent squares (one move away) that could alter the beam
  // by placing a mirror piece there
  const addAdjacentInfluence = (path, influenceSet) => {
    path.forEach(({ row, col }) => {
      // Check all 8 adjacent squares
      const adjacents = [
        { row: row - 1, col: col - 1 }, { row: row - 1, col }, { row: row - 1, col: col + 1 },
        { row, col: col - 1 }, { row, col: col + 1 },
        { row: row + 1, col: col - 1 }, { row: row + 1, col }, { row: row + 1, col: col + 1 }
      ]
      
      adjacents.forEach(pos => {
        if (isValidPosition(pos.row, pos.col)) {
          influenceSet.add(`${pos.row},${pos.col}`)
        }
      })
    })
  }
  
  addAdjacentInfluence(redBeam.path, redInfluence)
  addAdjacentInfluence(silverBeam.path, silverInfluence)
  
  return { redInfluence, silverInfluence }
}

/**
 * Check if a square is in the beam influence for a given player
 * @param {Object} state - Game state
 * @param {string} player - Player color
 * @param {number} row - Row to check
 * @param {number} col - Col to check
 * @returns {boolean} True if square influences the beam
 */
export function isInBeamInfluence(state, player, row, col) {
  const { redInfluence, silverInfluence } = getBeamInfluence(state)
  const key = `${row},${col}`
  
  if (player === RED) return redInfluence.has(key)
  return silverInfluence.has(key)
}

/**
 * Check if opponent has a one-move kill threat
 * @param {Object} state - Game state
 * @param {string} player - Current player (who might be threatened)
 * @returns {Object|null} Threat info or null
 */
export function detectImmediateThreat(state, player) {
  const opponent = player === RED ? SILVER : RED
  
  // Check if pharaoh exists
  const pharaoh = findPharaoh(state, player)
  if (!pharaoh) return null
  
  // Generate all legal opponent moves
  const opponentMoves = generateLegalMoves(state, opponent)
  
  // Check if any move results in our pharaoh being destroyed
  const killingMoves = []
  for (const move of opponentMoves) {
    const afterMove = applyMove(state, move)
    const result = resolveLaser(afterMove, opponent)
    
    // Check if our pharaoh was destroyed
    if (result.newState.gameOver && result.newState.winner === opponent) {
      killingMoves.push({
        move,
        resultState: result.newState,
        laserPath: result.laserResult
      })
    }
  }
  
  if (killingMoves.length > 0) {
    return {
      type: 'immediate',
      threatenedPiece: { type: PHARAOH, ...pharaoh },
      killingMoves,
      canBlock: true // If we detect it, there might be blocking moves
    }
  }
  
  return null
}

/**
 * Find pharaoh for a player
 * @param {Object} state - Game state
 * @param {string} player - Player color
 * @returns {Object|null} {row, col, piece} or null
 */
function findPharaoh(state, player) {
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 10; col++) {
      const piece = getPieceAt(state, row, col)
      if (piece && piece.type === PHARAOH && piece.player === player) {
        return { row, col, piece }
      }
    }
  }
  return null
}

/**
 * Detect which of our pieces are vulnerable to opponent captures
 * @param {Object} state - Game state
 * @param {string} player - Current player
 * @returns {Array} Array of vulnerable pieces with their threatening moves
 */
export function detectVulnerablePieces(state, player) {
  const opponent = player === RED ? SILVER : RED
  const vulnerable = []
  
  // Generate all legal opponent moves
  const opponentMoves = generateLegalMoves(state, opponent)
  
  // Check each move for captures
  for (const move of opponentMoves) {
    const afterMove = applyMove(state, move)
    const result = resolveLaser(afterMove, opponent)
    
    // Check if any of our pieces were destroyed
    if (result.laserResult.hits) {
      for (const hit of result.laserResult.hits) {
        if (hit.destroyed && hit.piece && hit.piece.player === player) {
          vulnerable.push({
            piece: hit.piece,
            row: hit.row,
            col: hit.col,
            threateningMove: move
          })
        }
      }
    }
  }
  
  return vulnerable
}

/**
 * Detect capture opportunities (opponent pieces we can destroy)
 * @param {Object} state - Game state
 * @param {string} player - Current player
 * @param {Array} legalMoves - Our legal moves (pre-generated for efficiency)
 * @returns {Array} Array of moves that capture opponent pieces
 */
export function detectCaptureOpportunities(state, player, legalMoves = null) {
  const opponent = player === RED ? SILVER : RED
  const captures = []
  
  const moves = legalMoves || generateLegalMoves(state, player)
  
  for (const move of moves) {
    const afterMove = applyMove(state, move)
    const result = resolveLaser(afterMove, player)
    
    // Check if any opponent pieces were destroyed
    if (result.laserResult.hits) {
      for (const hit of result.laserResult.hits) {
        if (hit.destroyed && hit.piece && hit.piece.player === opponent) {
          captures.push({
            move,
            capturedPiece: hit.piece,
            capturedRow: hit.row,
            capturedCol: hit.col,
            resultState: result.newState
          })
        }
      }
    }
  }
  
  return captures
}

/**
 * Check if a move would alter the beam (place/remove mirror on beam path)
 * @param {Object} state - Game state
 * @param {Object} move - Move to check
 * @param {string} player - Player making the move
 * @returns {boolean} True if move affects beam
 */
export function moveAffectsBeam(state, move, player) {
  const { redInfluence, silverInfluence } = getBeamInfluence(state)
  const influence = player === RED ? redInfluence : silverInfluence
  
  // Check if moving to/from beam influence square
  const fromKey = `${move.from.row},${move.from.col}`
  const toKey = `${move.to.row},${move.to.col}`
  
  return influence.has(fromKey) || influence.has(toKey)
}
