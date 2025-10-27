// Khet Tactics - Evaluation and Scoring
// Config-driven material, king safety, and beam pressure evaluation

import { PHARAOH, ANUBIS, PYRAMID, SCARAB } from '../../types.js'
import { getPlayerPieces, findPiece } from '../../state.js'
import { applyMove } from '../../rules.js'
import { resolveLaser } from '../../laser.js'
import { detectVulnerablePieces } from './beam.js'

// Default config (can be overridden per opponent)
export const DEFAULT_CONFIG = {
  material: {
    pharaoh: 100000,
    scarab: 15,    // Increased: scarabs are powerful mirrors
    anubis: 10,    // Increased: anubis pieces are valuable blockers
    pyramid: 5     // Increased: pyramids redirect beams
  },
  kingSafety: {
    pharaohExposure: -12,  // Increased penalty for exposed pharaoh
    anubisRadius: 2,
    anubisMissing: -6      // Increased penalty for missing anubis
  },
  beamPressure: {
    towardKing: 5,         // Increased: reward threatening opponent's pharaoh
    deflectionQuality: 2
  },
  structure: {
    trapped: -3,           // Increased penalty for trapped pieces
    edgePenalty: -2        // Increased penalty for edge positions
  },
  threats: {
    vulnerablePenalty: -35,  // Strong penalty per threatened material value
    opponentExposure: 6     // Reward for threatening opponent material
  }
}

/**
 * Evaluate material for both players
 * @param {Object} state - Game state
 * @param {Object} config - Scoring configuration
 * @returns {number} Material advantage for current player
 */
export function evaluateMaterial(state, player, config = DEFAULT_CONFIG) {
  const opponent = player === 'red' ? 'silver' : 'red'
  
  let myMaterial = 0
  let theirMaterial = 0
  
  // Count pieces
  const myPieces = getPlayerPieces(state, player)
  const theirPieces = getPlayerPieces(state, opponent)
  
  myPieces.forEach(({ piece }) => {
    const value = config.material[piece.type] || 0
    myMaterial += value
  })
  
  theirPieces.forEach(({ piece }) => {
    const value = config.material[piece.type] || 0
    theirMaterial += value
  })
  
  return myMaterial - theirMaterial
}

/**
 * Evaluate king safety
 * @param {Object} state - Game state
 * @param {string} player - Player to evaluate
 * @param {Object} config - Scoring configuration
 * @returns {number} Safety score
 */
export function evaluateKingSafety(state, player, config = DEFAULT_CONFIG) {
  let score = 0
  
  const pharaoh = findPiece(state, PHARAOH, player)
  if (!pharaoh) return -1000 // No pharaoh = instant loss
  
  // Check distance to anubis (protectors)
  const anubisPieces = []
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 10; col++) {
      const piece = state.board[row][col]
      if (piece && piece.type === ANUBIS && piece.player === player) {
        const dx = Math.abs(row - pharaoh.row)
        const dy = Math.abs(col - pharaoh.col)
        const distance = Math.sqrt(dx * dx + dy * dy)
        anubisPieces.push({ row, col, piece, distance })
      }
    }
  }
  
  if (anubisPieces.length === 0) {
    score += config.kingSafety.anubisMissing
  } else {
    const closestAnubis = anubisPieces.reduce((min, a) => a.distance < min.distance ? a : min)
    if (closestAnubis.distance <= config.kingSafety.anubisRadius) {
      score += 2 // Protected by anubis
    }
  }
  
  // Check if pharaoh is on board edge (weaker position)
  const { row, col } = pharaoh
  const isEdge = row === 0 || row === 7 || col === 0 || col === 9
  if (isEdge) {
    score += config.structure.edgePenalty
  }
  
  // TODO: Check if pharaoh is in laser danger zone
  // This would simulate opponent's laser and check if pharaoh is in path
  
  return score
}

/**
 * Evaluate beam pressure on opponent
 * @param {Object} state - Game state
 * @param {string} player - Player making the move
 * @param {Object} move - Move to evaluate
 * @param {Object} config - Scoring configuration
 * @returns {number} Pressure score
 */
export function evaluateBeamPressure(state, player, move, config = DEFAULT_CONFIG) {
  if (!move) return 0
  
  const opponent = player === 'red' ? 'silver' : 'red'
  
  // Simulate move and laser
  const newState = applyMove(state, move)
  const afterLaser = resolveLaser(newState, player)
  
  let score = 0
  
  // Check if laser destroys opponent pieces (highest priority)
  const { hits } = afterLaser.laserResult
  if (hits && hits.length > 0) {
    hits.forEach(hit => {
      if (hit.destroyed && hit.piece && hit.piece.player === opponent) {
        // Bonus for destroying opponent material
        const value = config.material[hit.piece.type] || 0
        score += value * 2 // Extra bonus for captures
      }
    })
  }
  
  // Evaluate if beam path threatens opponent's king area
  const opponentPharaoh = findPiece(newState, PHARAOH, opponent)
  if (opponentPharaoh && afterLaser.laserResult.path) {
    const path = afterLaser.laserResult.path
    
    // Check distance from beam path to pharaoh
    let minDistance = Infinity
    path.forEach(segment => {
      const dx = Math.abs(segment.row - opponentPharaoh.row)
      const dy = Math.abs(segment.col - opponentPharaoh.col)
      const distance = Math.sqrt(dx * dx + dy * dy)
      minDistance = Math.min(minDistance, distance)
    })
    
    // Reward beam paths that get close to opponent pharaoh
    if (minDistance <= 2) {
      score += config.beamPressure.towardKing * (3 - minDistance)
    }
    
    // Check if beam passes through squares adjacent to pharaoh
    const adjacentSquares = [
      { row: opponentPharaoh.row - 1, col: opponentPharaoh.col },
      { row: opponentPharaoh.row + 1, col: opponentPharaoh.col },
      { row: opponentPharaoh.row, col: opponentPharaoh.col - 1 },
      { row: opponentPharaoh.row, col: opponentPharaoh.col + 1 }
    ]
    
    adjacentSquares.forEach(adj => {
      if (path.some(seg => seg.row === adj.row && seg.col === adj.col)) {
        score += config.beamPressure.towardKing * 2 // Bonus for adjacent beam
      }
    })
  }
  
  return score
}

/**
 * Comprehensive evaluation
 * @param {Object} state - Game state
 * @param {string} player - Player to evaluate for
 * @param {Object} move - Move that was made (optional)
 * @param {Object} config - Scoring configuration
 * @returns {number} Total evaluation score
 */
export function evaluate(state, player, move = null, config = DEFAULT_CONFIG) {
  let score = 0
  
  // Material advantage (highest weight)
  const material = evaluateMaterial(state, player, config)
  score += material * 15 // Increased: material is critical
  
  // King safety (high priority)
  const mySafety = evaluateKingSafety(state, player, config)
  const opponent = player === 'red' ? 'silver' : 'red'
  const theirSafety = evaluateKingSafety(state, opponent, config)
  score += (mySafety - theirSafety) * 3 // Increased multiplier
  
  // Threat detection (penalize exposing pieces, reward pressure)
  const threatConfig = config.threats || DEFAULT_CONFIG.threats
  const myThreats = detectVulnerablePieces(state, player)
  const opponentThreats = detectVulnerablePieces(state, opponent)

  if (myThreats.length > 0 && threatConfig?.vulnerablePenalty) {
    const threatenedValue = myThreats.reduce((total, threat) => {
      const pieceValue = config.material[threat.piece.type] || 1
      return total + pieceValue
    }, 0)
    score += threatenedValue * threatConfig.vulnerablePenalty
  }

  if (opponentThreats.length > 0 && threatConfig?.opponentExposure) {
    const exposedValue = opponentThreats.reduce((total, threat) => {
      const pieceValue = config.material[threat.piece.type] || 1
      return total + pieceValue
    }, 0)
    score += exposedValue * threatConfig.opponentExposure
  }

  // Beam pressure from move (tactical advantage)
  if (move) {
    const pressure = evaluateBeamPressure(state, player, move, config)
    score += pressure * 2 // Increased: reward aggressive beam play
  }
  
  return score
}
