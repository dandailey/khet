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
  
  // Filter out obviously bad moves: any move that destroys one of our pieces
  // after our own laser fires (unless it immediately wins)
  const safeMoves = legalMoves.filter(move => {
    const newState = applyMove(state, move)
    const afterLaser = resolveLaser(newState, player)
    const { hits, winner } = afterLaser.laserResult
    
    // Allow if we immediately win
    if (winner && winner === player) return true
    
    // If any of our own pieces would be destroyed by our shot, treat as unsafe
    const selfLoss = hits.some(h => h.destroyed && h.piece && h.piece.player === player)
    return !selfLoss
  })
  
  // Use safe moves if available, otherwise use all moves
  const movesToConsider = safeMoves.length > 0 ? safeMoves : legalMoves
  
  // Evaluate each move
  const moveScores = movesToConsider.map(move => {
    const newState = applyMove(state, move)
    const afterLaser = resolveLaser(newState, player)
    const finalState = switchPlayer(afterLaser.newState)
    
    // Heuristic: reward capturing opponent pieces, heavily penalize self-destruction
    // This compounds with the board evaluation to strongly avoid suicides.
    const { hits, winner } = afterLaser.laserResult
    let captureDelta = 0
    if (hits && hits.length > 0) {
      for (const h of hits) {
        if (!h.destroyed || !h.piece) continue
        if (h.piece.player === player) captureDelta -= 4 // strong penalty for self-capture
        else captureDelta += 2 // bonus for capturing opponent material
      }
    }
    // Winning is best
    if (winner && winner === player) captureDelta += 1000
    
    const score = evaluate(finalState, player) + captureDelta
    
    return { move, score }
  })
  
  // Sort by score (highest first)
  moveScores.sort((a, b) => b.score - a.score)
  
  // Slightly reduce randomness: pick from top 2 when available
  const topBand = Math.min(2, moveScores.length)
  const topMoves = moveScores.slice(0, topBand)
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
