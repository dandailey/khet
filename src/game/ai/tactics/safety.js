// Khet Tactics - Safety Filters
// Hard rules to prevent obviously terrible moves

import { PHARAOH, ANUBIS, PYRAMID } from '../../types.js'
import { applyMove } from '../../rules.js'
import { resolveLaser } from '../../laser.js'
import { getPieceAt, findPiece } from '../../state.js'

/**
 * Check if a move would result in destroying one of our own pieces
 * @param {Object} state - Game state
 * @param {Object} move - Move to check
 * @param {string} player - Player making the move
 * @returns {Object} { isValid: boolean, destroyedPiece: Object|null, score: number }
 */
export function checkSelfZap(state, move, player) {
  const newState = applyMove(state, move)
  const laserResult = resolveLaser(newState, player)
  const { hits, winner } = laserResult.laserResult
  
  // Immediate win is always valid
  if (winner && winner === player) {
    return { isValid: true, destroyedPiece: null, score: 1000 }
  }
  
  // Check for self-destruction
  if (hits && hits.length > 0) {
    for (const hit of hits) {
      if (hit.destroyed && hit.piece && hit.piece.player === player) {
        return { 
          isValid: false, 
          destroyedPiece: hit.piece, 
          score: -1000 
        }
      }
    }
  }
  
  return { isValid: true, destroyedPiece: null, score: 0 }
}

/**
 * Check if a move leaves pharaoh in immediate danger
 * @param {Object} state - Game state
 * @param {Object} move - Move to check
 * @param {string} player - Player making the move
 * @returns {boolean} True if move is dangerous
 */
export function checkPharaohExposure(state, move, player) {
  const newState = applyMove(state, move)
  const pharaoh = findPiece(newState, PHARAOH, player)
  if (!pharaoh) return 0 // No pharaoh to protect
  
  // TODO: Check if pharaoh is in a position where opponent can kill next turn
  // This requires simulating opponent's possible moves and their lasers
  // For now, we just check if pharaoh is on the board edge (weaker position)
  const { row, col } = pharaoh
  const isEdge = row === 0 || row === 7 || col === 0 || col === 9
  
  return isEdge ? -0.5 : 0 // Small penalty for edge positions
}

/**
 * Check Anubis positioning relative to pharaoh
 * @param {Object} state - Game state
 * @param {string} player - Player to check
 * @returns {number} Score for anubis positioning
 */
export function checkAnubisPositioning(state, player) {
  const pharaoh = findPiece(state, PHARAOH, player)
  if (!pharaoh) return 0
  
  // Find all anubis pieces
  const anubisPieces = []
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 10; col++) {
      const piece = getPieceAt(state, row, col)
      if (piece && piece.type === ANUBIS && piece.player === player) {
        anubisPieces.push({ row, col, piece })
      }
    }
  }
  
  if (anubisPieces.length === 0) return -2 // Missing anubis is bad
  
  // Check distance to pharaoh
  let minDistance = Infinity
  anubisPieces.forEach(anubis => {
    const dx = Math.abs(anubis.row - pharaoh.row)
    const dy = Math.abs(anubis.col - pharaoh.col)
    const distance = Math.sqrt(dx * dx + dy * dy)
    minDistance = Math.min(minDistance, distance)
  })
  
  // Reward close anubis (within 2-3 squares)
  if (minDistance <= 3) return 1
  if (minDistance <= 5) return 0
  return -1 // Anubis too far from pharaoh
}

/**
 * Check if anubis is facing dangerously (back exposed)
 * @param {Object} state - Game state  
 * @param {Object} move - Move to check
 * @param {string} player - Player making the move
 * @returns {number} Score for anubis facing
 */
export function checkAnubisFacing(state, move, player) {
  if (move.type !== 'rotate') return 0
  
  const piece = getPieceAt(state, move.from.row, move.from.col)
  if (!piece || piece.type !== ANUBIS || piece.player !== player) return 0
  
  // Anubis's back is opposite its facing
  const backSide = getOppositeDirection(move.newFacing || piece.facing)
  const { row, col } = move.from
  
  // Check if back is facing toward board center (dangerous)
  // Rough heuristic: if facing away from pharaoh, that's risky
  const pharaoh = findPiece(state, PHARAOH, player)
  if (!pharaoh) return 0
  
  const dx = Math.sign(pharaoh.row - row)
  const dy = Math.sign(pharaoh.col - col)
  
  const dirMap = { 'N': { r: -1, c: 0 }, 'E': { r: 0, c: 1 }, 
                   'S': { r: 1, c: 0 }, 'W': { r: 0, c: -1 } }
  const facingDir = dirMap[move.newFacing || piece.facing]
  
  // If anubis is facing away from pharaoh
  if (facingDir && facingDir.r === -dx && facingDir.c === -dy) {
    return -1 // Penalty for exposing back
  }
  
  return 0
}

/**
 * Get opposite direction
 * @param {string} facing - Current facing
 * @returns {string} Opposite facing
 */
function getOppositeDirection(facing) {
  const opposites = {
    'N': 'S', 'S': 'N', 'E': 'W', 'W': 'E',
    'NE': 'SW', 'SW': 'NE', 'NW': 'SE', 'SE': 'NW'
  }
  return opposites[facing] || facing
}

/**
 * Comprehensive safety check combining all filters
 * @param {Object} state - Game state
 * @param {Object} move - Move to check
 * @param {string} player - Player making the move
 * @param {Object} config - Safety configuration
 * @returns {Object} { isValid: boolean, score: number, reasons: string[] }
 */
export function checkMoveSafety(state, move, player, config = {}) {
  const {
    forbidSelfZap = true,
    forbidOneMoveMate = true,
    checkPharaoh = true,
    checkAnubis = true
  } = config
  
  let score = 0
  const reasons = []
  
  // Check self-zap
  if (forbidSelfZap) {
    const zapCheck = checkSelfZap(state, move, player)
    if (!zapCheck.isValid) {
      return { isValid: false, score: -1000, reasons: ['Would destroy own piece'] }
    }
    score += zapCheck.score
  }
  
  // Check pharaoh exposure
  if (checkPharaoh) {
    const exposurePenalty = checkPharaohExposure(state, move, player)
    score += exposurePenalty
    if (exposurePenalty < 0) {
      reasons.push('Pharaoh on board edge')
    }
  }
  
  // Check anubis positioning (applies to current state, not the move itself)
  if (checkAnubis) {
    const anubisScore = checkAnubisPositioning(state, player)
    score += anubisScore * 0.5
    if (anubisScore < 0) {
      reasons.push('Anubis too far from pharaoh')
    }
    
    if (move.type === 'rotate') {
      const facingScore = checkAnubisFacing(state, move, player)
      score += facingScore
      if (facingScore < 0) {
        reasons.push('Anubis back exposed')
      }
    }
  }
  
  return { isValid: true, score, reasons }
}
