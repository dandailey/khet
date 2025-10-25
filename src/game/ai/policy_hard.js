// Khet AI - Hard Difficulty Policy (Placeholder)

import { RED, SILVER } from '../types.js'

/**
 * Choose move for Hard AI (2-3 ply iterative deepening)
 * @param {Object} state - Game state
 * @param {string} player - AI player color
 * @param {Object} options - Options object
 * @returns {Promise<Object>} Chosen move
 */
export async function chooseMove(state, player, options = {}) {
  // TODO: Implement 2-3 ply iterative deepening with transposition table
  throw new Error('Hard AI not yet implemented')
}

/**
 * Check if AI should fire laser after move
 * @param {Object} state - Game state
 * @param {string} player - AI player color
 * @returns {boolean} True if should fire laser
 */
export function shouldFireLaser(state, player) {
  return true
}
