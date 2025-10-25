// Khet AI - Easy Difficulty Policy

import { RED, SILVER } from '../types.js'
import { generateLegalMoves, applyMove, switchPlayer } from '../rules.js'
import { resolveLaser } from '../laser.js'
import { evaluate } from '../eval.js'

/**
 * Choose move for Easy AI (1-ply greedy with safety checks)
 * @param {Object} state - Game state
 * @param {string} player - AI player color
 * @param {Object} options - Options object
 * @returns {Promise<Object>} Chosen move
 */
export async function chooseMove(state, player, options = {}) {
  const { timeMs = 50, rngSeed = Math.random() } = options
  
  const startTime = Date.now()
  const legalMoves = generateLegalMoves(state, player)
  
  if (legalMoves.length === 0) {
    return null // No legal moves
  }
  
  // Filter out moves that lead to immediate self-mate
  const safeMoves = legalMoves.filter(move => {
    const newState = applyMove(state, move)
    const afterLaser = resolveLaser(newState, player)
    
    // Check if this move leads to pharaoh death
    return !afterLaser.laserResult.winner || afterLaser.laserResult.winner === player
  })
  
  // Use safe moves if available, otherwise use all moves
  const movesToConsider = safeMoves.length > 0 ? safeMoves : legalMoves
  
  // Evaluate each move
  const moveScores = movesToConsider.map(move => {
    const newState = applyMove(state, move)
    const afterLaser = resolveLaser(newState, player)
    const finalState = switchPlayer(afterLaser.newState)
    
    const score = evaluate(finalState, player)
    
    return { move, score }
  })
  
  // Sort by score (highest first)
  moveScores.sort((a, b) => b.score - a.score)
  
  // Add some randomness to avoid predictability
  const topMoves = moveScores.slice(0, Math.min(3, moveScores.length))
  const randomIndex = Math.floor(rngSeed * topMoves.length)
  
  const chosenMove = topMoves[randomIndex].move
  
  // Simulate the move and laser firing
  const newState = applyMove(state, chosenMove)
  const laserResult = resolveLaser(newState, player)
  
  return {
    move: chosenMove,
    newState: laserResult.newState,
    laserResult: laserResult.laserResult,
    thinkingTime: Date.now() - startTime
  }
}

/**
 * Check if AI should fire laser after move
 * @param {Object} state - Game state
 * @param {string} player - AI player color
 * @returns {boolean} True if should fire laser
 */
export function shouldFireLaser(state, player) {
  // Easy AI always fires laser after move
  return true
}
