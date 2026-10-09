// State encoding/decoding for stateless multiplayer
// Encodes game state into compact binary format for URL hash sharing

const RED = 1
const SILVER = 2
const SETUP_NAMES = ['classic', 'imhotep', 'dynasty']

// Encoding lookup: piece {type, player, facing, position} -> 5-bit value (1-26)
function encodePiece(piece, row, col) {
  const { type, player, facing } = piece

  if (type === 'sphinx') {
    // Sphinx: position-dependent facings
    if (row === 0 && col === 0) {
      // Red sphinx at (0,0): E=1, S=2
      if (player === RED) {
        return facing === 'E' ? 1 : 2
      }
    } else if (row === 7 && col === 9) {
      // Silver sphinx at (7,9): W=3, N=4
      if (player === SILVER) {
        return facing === 'W' ? 3 : 4
      }
    }
    throw new Error(`Invalid sphinx position or facing: ${row},${col},${facing}`)
  }

  if (type === 'pharaoh') {
    // Pharaoh: no facing, just player
    return player === RED ? 5 : 6
  }

  if (type === 'pyramid') {
    // Pyramid: 4 facings per player
    const facingMap = { NE: 0, SE: 1, SW: 2, NW: 3 }
    const base = player === RED ? 7 : 11
    return base + facingMap[facing]
  }

  if (type === 'anubis') {
    // Anubis: 4 cardinal facings per player
    const facingMap = { N: 0, E: 1, S: 2, W: 3 }
    const base = player === RED ? 15 : 19
    return base + facingMap[facing]
  }

  if (type === 'scarab') {
    // Scarab: encode all 4 facings (NE, SE, SW, NW)
    // Red: NE=23, SE=24, SW=25, NW=26
    // Silver: NE=27, SE=28, SW=29, NW=30
    const facingMap = { NE: 0, SE: 1, SW: 2, NW: 3 }
    if (!(facing in facingMap)) {
      throw new Error(`Invalid scarab facing: ${facing}`)
    }
    const base = player === RED ? 23 : 27
    const encoded = base + facingMap[facing]
    if (typeof window !== 'undefined' && window.DEV_MODE) {
      console.log(`[DEV] Encoding scarab: player=${player}, facing=${facing}, value=${encoded}`)
    }
    return encoded
  }

  throw new Error(`Unknown piece type: ${type}`)
}

// Decoding lookup: 5-bit value -> {type, player, facing}
function decodePiece(value, row, col) {
  if (value < 1 || value > 30) {
    throw new Error(`Invalid piece value: ${value}`)
  }

  // Sphinx (1-4)
  if (value <= 4) {
    if (value === 1) return { type: 'sphinx', player: RED, facing: 'E' }
    if (value === 2) return { type: 'sphinx', player: RED, facing: 'S' }
    if (value === 3) return { type: 'sphinx', player: SILVER, facing: 'W' }
    if (value === 4) return { type: 'sphinx', player: SILVER, facing: 'N' }
  }

  // Pharaoh (5-6)
  if (value === 5) return { type: 'pharaoh', player: RED, facing: 'N' }
  if (value === 6) return { type: 'pharaoh', player: SILVER, facing: 'N' }

  // Pyramid (7-14)
  if (value >= 7 && value <= 14) {
    const facingMap = ['NE', 'SE', 'SW', 'NW']
    const player = value <= 10 ? RED : SILVER
    const facingIndex = (value - (player === RED ? 7 : 11)) % 4
    return { type: 'pyramid', player, facing: facingMap[facingIndex] }
  }

  // Anubis (15-22)
  if (value >= 15 && value <= 22) {
    const facingMap = ['N', 'E', 'S', 'W']
    const player = value <= 18 ? RED : SILVER
    const facingIndex = (value - (player === RED ? 15 : 19)) % 4
    return { type: 'anubis', player, facing: facingMap[facingIndex] }
  }

  // Scarab (23-30)
  if (value >= 23 && value <= 30) {
    const player = value <= 26 ? RED : SILVER
    const facingMap = ['NE', 'SE', 'SW', 'NW']
    const base = player === RED ? 23 : 27
    const facingIndex = value - base
    if (facingIndex < 0 || facingIndex >= 4) {
      throw new Error(`Invalid scarab facing index: ${facingIndex} for value ${value}`)
    }
    const decoded = { type: 'scarab', player, facing: facingMap[facingIndex] }
    if (typeof window !== 'undefined' && window.DEV_MODE) {
      console.log(`[DEV] Decoding scarab: value=${value}, player=${player}, facing=${decoded.facing}`)
    }
    return decoded
  }

  throw new Error(`Unhandled piece value: ${value}`)
}

// Encode game state to binary, then base64url
export function encodeState(gameState) {
  // Collect all pieces with positions
  const pieces = []
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const piece = gameState.board[row][col]
      if (piece) {
        pieces.push({ piece, row, col })
      }
    }
  }

  const pieceCount = pieces.length
  if (pieceCount > 63) {
    throw new Error(`Too many pieces: ${pieceCount} (max 63)`)
  }

  // Build binary data
  const bytes = []
  let bitBuffer = 0
  let bitCount = 0

  // Helper to write bits
  function writeBits(value, numBits) {
    bitBuffer = (bitBuffer << numBits) | value
    bitCount += numBits
    while (bitCount >= 8) {
      bytes.push((bitBuffer >> (bitCount - 8)) & 0xff)
      bitCount -= 8
      bitBuffer = bitBuffer & ((1 << bitCount) - 1)
    }
  }

  // Header: version (4) + currentPlayer (1) + gameOver (1) + winner (2) + pieceCount (6) = 14 bits
  const version = gameState.setup || gameState.computer ? 2 : 1
  const currentPlayerBit = gameState.currentPlayer === RED ? 1 : 0
  const gameOverBit = gameState.gameOver ? 1 : 0
  const winnerBits = gameState.winner === RED ? 1 : gameState.winner === SILVER ? 2 : 0

  writeBits(version, 4)
  writeBits(currentPlayerBit, 1)
  writeBits(gameOverBit, 1)
  writeBits(winnerBits, 2)
  writeBits(pieceCount, 6)

  // Each piece: position (7 bits) + type+player+facing (5 bits) = 12 bits
  for (const { piece, row, col } of pieces) {
    const pieceValue = encodePiece(piece, row, col)
    writeBits(row, 3)
    writeBits(col, 4)
    writeBits(pieceValue, 5)
  }

  // Version 2 preserves local new-game choices and the KFEN ply across reloads.
  if (version === 2) {
    const setup = SETUP_NAMES.indexOf(gameState.setup || 'classic')
    const computer = gameState.computer
    const ply = gameState.ply ?? 0
    if (setup < 0 || !Number.isSafeInteger(ply) || ply < 0 || ply > 0xffffffff) {
      throw new Error('Invalid game options')
    }
    if (computer && (![RED, SILVER].includes(computer.humanSide) ||
        !Number.isInteger(computer.level) || computer.level < 1 || computer.level > 10)) {
      throw new Error('Invalid computer options')
    }
    writeBits(setup, 2)
    writeBits(computer ? 1 : 0, 1)
    writeBits(computer?.humanSide === RED ? 1 : 0, 1)
    writeBits(computer?.level || 1, 4)
    // Write bytes separately: the bit buffer never needs more than 15 bits.
    for (const shift of [24, 16, 8, 0]) writeBits((ply >>> shift) & 0xff, 8)
  }

  // Flush remaining bits
  if (bitCount > 0) {
    bytes.push(bitBuffer << (8 - bitCount))
  }

  // Convert to base64url (URL-safe base64)
  const base64 = btoa(String.fromCharCode(...bytes))
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

/**
 * Encode full state for GameSync (includes sync metadata)
 * Format: JSON with board state encoded as base64url
 */
export function encodeFullState(gameState) {
  const boardEncoded = encodeState({ ...gameState, computer: null })
  
  const fullState = {
    v: 2, // Version 2 = full state with sync
    board: boardEncoded,
    sync: gameState.sync || {
      redId: null,
      silverId: null,
      lastTurnId: 0,
      turnHistory: []
    }
  }
  
  return JSON.stringify(fullState)
}

/**
 * Decode full state from GameSync
 */
export function decodeFullState(encoded) {
  try {
    // Try to parse as JSON first (new format)
    const parsed = JSON.parse(encoded)
    
    if (parsed.v === 2 && parsed.board) {
      // Version 2: full state with sync
      const boardState = decodeState(parsed.board)
      boardState.computer = null // Online sessions are always human vs human.
      boardState.sync = parsed.sync || {
        redId: null,
        silverId: null,
        lastTurnId: 0,
        turnHistory: []
      }
      return boardState
    }
    
    // Unknown JSON format
    throw new Error('Unknown state format')
  } catch (jsonError) {
    // Not JSON, try legacy binary format
    const boardState = decodeState(encoded)
    boardState.computer = null
    boardState.sync = {
      redId: null,
      silverId: null,
      lastTurnId: 0,
      turnHistory: []
    }
    return boardState
  }
}

// Decode base64url string to game state
export function decodeState(encoded) {
  try {
    // Convert base64url to base64
    let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
    // Add padding if needed
    while (base64.length % 4) {
      base64 += '='
    }

    // Decode to bytes
    const binaryString = atob(base64)
    const bytes = Array.from(binaryString, char => char.charCodeAt(0))

    let bitOffset = 0

    // Helper to read bits
    function readBits(numBits) {
      let value = 0
      for (let i = 0; i < numBits; i += 1) {
        const byteIndex = Math.floor(bitOffset / 8)
        const bitIndex = 7 - (bitOffset % 8)
        if (byteIndex >= bytes.length) {
          throw new Error('Unexpected end of data')
        }
        const bit = (bytes[byteIndex] >> bitIndex) & 1
        value = (value << 1) | bit
        bitOffset += 1
      }
      return value
    }

    // Read header
    const version = readBits(4)
    if (version !== 1 && version !== 2) {
      throw new Error(`Unsupported version: ${version}`)
    }

    const currentPlayerBit = readBits(1)
    const gameOverBit = readBits(1)
    const winnerBits = readBits(2)
    const pieceCount = readBits(6)

    if (pieceCount > 63) {
      throw new Error(`Invalid piece count: ${pieceCount}`)
    }

    // Initialize board
    const board = Array(8)
      .fill(null)
      .map(() => Array(10).fill(null))

    // Read pieces
    for (let i = 0; i < pieceCount; i += 1) {
      const row = readBits(3)
      const col = readBits(4)
      const pieceValue = readBits(5)

      if (row >= 8 || col >= 10) {
        throw new Error(`Invalid position: ${row},${col}`)
      }

      const piece = decodePiece(pieceValue, row, col)
      board[row][col] = piece
    }

    const options = {}
    if (version === 2) {
      const setup = SETUP_NAMES[readBits(2)]
      const hasComputer = readBits(1)
      const humanSide = readBits(1) ? RED : SILVER
      const level = readBits(4)
      let ply = 0
      for (let i = 0; i < 4; i += 1) ply = ply * 256 + readBits(8)
      if (!setup || level < 1 || level > 10) throw new Error('Invalid game options')
      Object.assign(options, { setup, computer: hasComputer ? { humanSide, level } : null, ply })
    }

    // Build game state
    const currentPlayer = currentPlayerBit === 1 ? RED : SILVER
    const gameOver = gameOverBit === 1
    const winner = winnerBits === 1 ? RED : winnerBits === 2 ? SILVER : null

    return {
      ...options,
      currentPlayer,
      board,
      gameOver,
      winner,
      selectedPiece: null,
      selectedSquare: null,
      actionTaken: false
    }
  } catch (error) {
    throw new Error(`Failed to decode state: ${error.message}`)
  }
}
