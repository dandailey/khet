// Khet Laser Mechanics

import { 
  RED, SILVER, PHARAOH, SPHINX, PYRAMID, ANUBIS, SCARAB,
  CARDINAL_VECTORS, OPPOSITE_DIRECTIONS,
  SLASH_REFLECTION_MAPPING, BACKSLASH_REFLECTION_MAPPING,
  SCARAB_SLASH_FACINGS, SCARAB_BACKSLASH_FACINGS,
  BOARD_ROWS, BOARD_COLS
} from './types.js'
import { getPieceAt, isValidPosition, cloneState } from './state.js'

/**
 * Trace laser path and determine hits
 * @param {Object} state - Game state
 * @param {string} player - Player firing laser
 * @returns {Object} Laser result with path and hits
 */
export function traceLaser(state, player) {
  const sphinx = findSphinx(state, player)
  if (!sphinx) {
    return { path: [], hits: [], winner: null }
  }
  
  const path = []
  const hits = []
  let currentRow = sphinx.row
  let currentCol = sphinx.col
  let direction = sphinx.piece.facing
  
  // Convert facing to cardinal direction for movement
  const cardinalDirection = facingToCardinal(direction)
  if (!cardinalDirection) {
    return { path: [], hits: [], winner: null }
  }
  
  let step = 0
  const maxSteps = 100 // Prevent infinite loops
  
  while (step < maxSteps) {
    // Move in current direction
    const vector = CARDINAL_VECTORS[cardinalDirection]
    currentRow += vector.row
    currentCol += vector.col
    
    // Check if we've left the board
    if (!isValidPosition(currentRow, currentCol)) {
      break
    }
    
    path.push({ row: currentRow, col: currentCol, direction })
    
    const piece = getPieceAt(state, currentRow, currentCol)
    if (!piece) {
      // Empty square, continue
      continue
    }
    
    // Hit a piece - determine what happens
    const hitResult = processLaserHit(piece, cardinalDirection, player)
    
    if (hitResult.destroyed) {
      hits.push({
        row: currentRow,
        col: currentCol,
        piece,
        destroyed: true
      })
      
      // Check for pharaoh elimination (game over)
      if (piece.type === PHARAOH) {
        return {
          path,
          hits,
          winner: player === RED ? SILVER : RED // Opponent wins
        }
      }
      
      // Piece destroyed, laser stops
      break
    } else if (hitResult.reflected) {
      // Laser reflected, continue in new direction
      direction = hitResult.newDirection
      cardinalDirection = facingToCardinal(direction)
      if (!cardinalDirection) {
        break
      }
    } else {
      // Piece blocks laser (Anubis front, Sphinx)
      break
    }
    
    step++
  }
  
  return { path, hits, winner: null }
}

/**
 * Resolve laser firing and update game state
 * @param {Object} state - Game state
 * @param {string} player - Player firing laser
 * @returns {Object} New game state and laser results
 */
export function resolveLaser(state, player) {
  const laserResult = traceLaser(state, player)
  const newState = cloneState(state)
  
  // Remove destroyed pieces
  laserResult.hits.forEach(hit => {
    if (hit.destroyed) {
      newState.board[hit.row][hit.col] = null
    }
  })
  
  // Check for game over
  if (laserResult.winner) {
    newState.gameOver = true
    newState.winner = laserResult.winner
  }
  
  return {
    newState,
    laserResult
  }
}

/**
 * Find sphinx for a player
 * @param {Object} state - Game state
 * @param {string} player - Player color
 * @returns {Object|null} {row, col, piece} or null
 */
function findSphinx(state, player) {
  for (let row = 0; row < BOARD_ROWS; row++) {
    for (let col = 0; col < BOARD_COLS; col++) {
      const piece = getPieceAt(state, row, col)
      if (piece && piece.type === SPHINX && piece.player === player) {
        return { row, col, piece }
      }
    }
  }
  return null
}

/**
 * Convert facing direction to cardinal direction
 * @param {string} facing - Facing direction
 * @returns {string|null} Cardinal direction or null
 */
function facingToCardinal(facing) {
  const cardinalMap = {
    'N': 'N',
    'NE': 'E', // For laser purposes, treat NE as E
    'E': 'E',
    'SE': 'E',
    'S': 'S',
    'SW': 'W',
    'W': 'W',
    'NW': 'W'
  }
  return cardinalMap[facing] || null
}

/**
 * Process laser hit on a piece
 * @param {Object} piece - Piece being hit
 * @param {string} direction - Direction laser is coming from
 * @param {string} firingPlayer - Player who fired laser
 * @returns {Object} Hit result
 */
function processLaserHit(piece, direction, firingPlayer) {
  // Sphinx is immune to laser
  if (piece.type === SPHINX) {
    return { destroyed: false, reflected: false }
  }
  
  // Pharaoh is always destroyed
  if (piece.type === PHARAOH) {
    return { destroyed: true, reflected: false }
  }
  
  // Scarab always reflects
  if (piece.type === SCARAB) {
    const newDirection = getScarabReflection(piece.facing, direction)
    return { destroyed: false, reflected: true, newDirection }
  }
  
  // Pyramid reflection logic
  if (piece.type === PYRAMID) {
    const reflection = getPyramidReflection(piece.facing, direction)
    if (reflection) {
      return { destroyed: false, reflected: true, newDirection: reflection }
    } else {
      return { destroyed: true, reflected: false }
    }
  }
  
  // Anubis reflection logic
  if (piece.type === ANUBIS) {
    const reflection = getAnubisReflection(piece.facing, direction)
    if (reflection) {
      return { destroyed: false, reflected: true, newDirection: reflection }
    } else {
      return { destroyed: true, reflected: false }
    }
  }
  
  // Default: piece destroyed
  return { destroyed: true, reflected: false }
}

/**
 * Get scarab reflection direction
 * @param {string} scarabFacing - Scarab's facing direction
 * @param {string} laserDirection - Direction laser is coming from
 * @returns {string} New laser direction
 */
function getScarabReflection(scarabFacing, laserDirection) {
  if (SCARAB_SLASH_FACINGS.has(scarabFacing)) {
    return SLASH_REFLECTION_MAPPING[laserDirection]
  } else if (SCARAB_BACKSLASH_FACINGS.has(scarabFacing)) {
    return BACKSLASH_REFLECTION_MAPPING[laserDirection]
  }
  return laserDirection // No reflection
}

/**
 * Get pyramid reflection direction
 * @param {string} pyramidFacing - Pyramid's facing direction
 * @param {string} laserDirection - Direction laser is coming from
 * @returns {string|null} New laser direction or null if no reflection
 */
function getPyramidReflection(pyramidFacing, laserDirection) {
  // Pyramid mirrors are on the sides indicated by the facing direction
  // For example, SW facing means mirrors on S and W sides
  
  const mirrorSides = getMirrorSides(pyramidFacing)
  
  if (mirrorSides.includes(laserDirection)) {
    // Hit a mirror side, reflect
    if (mirrorSides.length === 2) {
      // Two mirror sides, determine reflection based on which side was hit
      const otherSide = mirrorSides.find(side => side !== laserDirection)
      return OPPOSITE_DIRECTIONS[otherSide]
    }
  }
  
  return null // No reflection, piece destroyed
}

/**
 * Get anubis reflection direction
 * @param {string} anubisFacing - Anubis's facing direction
 * @param {string} laserDirection - Direction laser is coming from
 * @returns {string|null} New laser direction or null if no reflection
 */
function getAnubisReflection(anubisFacing, laserDirection) {
  // Anubis has a shielded front that absorbs laser
  const frontDirection = anubisFacing
  
  if (laserDirection === frontDirection) {
    return null // Front absorbs laser, no reflection
  }
  
  // Sides and rear are vulnerable
  return null // Anubis destroyed
}

/**
 * Get mirror sides for a facing direction
 * @param {string} facing - Facing direction
 * @returns {Array} Array of mirror side directions
 */
function getMirrorSides(facing) {
  const mirrorMap = {
    'N': ['N'],
    'NE': ['N', 'E'],
    'E': ['E'],
    'SE': ['S', 'E'],
    'S': ['S'],
    'SW': ['S', 'W'],
    'W': ['W'],
    'NW': ['N', 'W']
  }
  return mirrorMap[facing] || []
}
