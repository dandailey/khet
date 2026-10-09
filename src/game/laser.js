// Pure laser computation extracted from the live game; segment shape and termination are unchanged.

export const CARDINAL_VECTORS = {
  N: { row: -1, col: 0 },
  E: { row: 0, col: 1 },
  S: { row: 1, col: 0 },
  W: { row: 0, col: -1 }
}

const OPPOSITE_DIRECTIONS = {
  N: "S",
  E: "W",
  S: "N",
  W: "E"
}

const SCARAB_SLASH_FACINGS = new Set(["NE", "SE"])

const SLASH_REFLECTION_MAPPING = {
  N: "E",
  E: "N",
  S: "W",
  W: "S"
}

const BACKSLASH_REFLECTION_MAPPING = {
  N: "W",
  W: "N",
  S: "E",
  E: "S"
}

// Pyramids: facing direction shows where mirrors point (the arrow direction)
// SW (↙) = mirrors on S and W sides → reflects from S/W, vulnerable from N/E
// NE (↗) = mirrors on N and E sides → reflects from N/E, vulnerable from S/W
const PYRAMID_MIRROR_ENTRIES = {
  NE: new Set(["N", "E"]),  // Reflects from N/E (mirrored), vulnerable from S/W
  SW: new Set(["S", "W"]),  // Reflects from S/W (mirrored), vulnerable from N/E
  NW: new Set(["N", "W"]),  // Reflects from N/W (mirrored), vulnerable from S/E
  SE: new Set(["S", "E"])   // Reflects from S/E (mirrored), vulnerable from N/W
}

const MAX_LASER_STEPS = 100
const BOARD_ROWS = 8
const BOARD_COLS = 10

export function computeLaserPath(gameState, color = gameState.currentPlayer) {
  const sphinxInfo = findSphinx(gameState, color)
  if (!sphinxInfo) return []

  let { row: currentRow, col: currentCol, facing } = sphinxInfo
  let direction = facing
  if (!CARDINAL_VECTORS[direction]) return []

  const path = []
  const visited = new Set()

  for (let step = 0; step < MAX_LASER_STEPS; step += 1) {
    const stateKey = `${currentRow}-${currentCol}-${direction}`
    if (visited.has(stateKey)) break
    visited.add(stateKey)

    const vector = CARDINAL_VECTORS[direction]
    if (!vector) break

    const nextRow = currentRow + vector.row
    const nextCol = currentCol + vector.col

    const segment = {
      startRow: currentRow,
      startCol: currentCol,
      endRow: nextRow,
      endCol: nextCol,
      direction
    }

    if (nextRow < 0 || nextRow >= BOARD_ROWS || nextCol < 0 || nextCol >= BOARD_COLS) {
      segment.outOfBounds = true
      path.push(segment)
      break
    }

    const targetPiece = gameState.board[nextRow][nextCol]
    segment.targetPiece = targetPiece
    path.push(segment)

    if (!targetPiece) {
      currentRow = nextRow
      currentCol = nextCol
      continue
    }

    // Pass the direction the laser is coming FROM (opposite of travel direction)
    const entryDirection = OPPOSITE_DIRECTIONS[direction]
    const interaction = resolveLaserInteraction(targetPiece, entryDirection)

    if (interaction.type === 'reflect') {
      direction = interaction.newDirection
      currentRow = nextRow
      currentCol = nextCol
      segment.reflected = true
      continue
    }

    if (interaction.type === 'absorb') {
      segment.absorbed = true
      segment.hitPiece = targetPiece
      segment.hitRow = nextRow
      segment.hitCol = nextCol
      break
    }

    if (interaction.type === 'destroy') {
      segment.hit = true
      segment.hitPiece = targetPiece
      segment.hitRow = nextRow
      segment.hitCol = nextCol
      segment.destroyed = true
      break
    }
  }

  return path
}

export function resolveLaserInteraction(piece, direction) {
  if (piece.type === 'scarab') {
    const isSlash = SCARAB_SLASH_FACINGS.has(piece.facing)
    const mapping = isSlash ? SLASH_REFLECTION_MAPPING : BACKSLASH_REFLECTION_MAPPING
    const newDirection = mapping[direction]
    if (!newDirection) return { type: 'absorb' }
    return { type: 'reflect', newDirection }
  }

  if (piece.type === 'pyramid') {
    const entries = PYRAMID_MIRROR_ENTRIES[piece.facing]
    const usesSlash = piece.facing === 'NE' || piece.facing === 'SW'
    const mapping = usesSlash ? SLASH_REFLECTION_MAPPING : BACKSLASH_REFLECTION_MAPPING
    
    if (entries && entries.has(direction)) {
      const newDirection = mapping[direction]
      if (!newDirection) return { type: 'absorb' }
      return { type: 'reflect', newDirection }
    }

    return { type: 'destroy' }
  }

  if (piece.type === 'anubis') {
    // Anubis shielded side is the same as its facing direction (the long side of trapezoid)
    const shieldedDirection = piece.facing
    if (direction === shieldedDirection) {
      return { type: 'absorb' }
    }

    return { type: 'destroy' }
  }

  if (piece.type === 'sphinx') {
    return { type: 'absorb' }
  }

  // Pharaohs and any other pieces are destroyed when hit
  return { type: 'destroy' }
}

export function findSphinx(gameState, color = gameState.currentPlayer) {
  for (let row = 0; row < BOARD_ROWS; row += 1) {
    for (let col = 0; col < BOARD_COLS; col += 1) {
      const piece = gameState.board[row][col]
      if (piece && piece.type === 'sphinx' && piece.player === color) {
        return { row, col, facing: piece.facing }
      }
    }
  }

  return null
}

