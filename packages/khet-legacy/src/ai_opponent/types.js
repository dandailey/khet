// Khet Game Types and Constants

// Player colors
export const RED = 'red'
export const SILVER = 'silver'

// Piece types
export const PHARAOH = 'pharaoh'
export const SPHINX = 'sphinx'
export const PYRAMID = 'pyramid'
export const ANUBIS = 'anubis'
export const SCARAB = 'scarab'

// Direction helpers (clockwise starting at north)
export const DIRECTIONS = {
  N: 0,
  NE: 45,
  E: 90,
  SE: 135,
  S: 180,
  SW: 225,
  W: 270,
  NW: 315
}

export const CARDINAL_VECTORS = {
  N: { row: -1, col: 0 },
  E: { row: 0, col: 1 },
  S: { row: 1, col: 0 },
  W: { row: 0, col: -1 }
}

export const OPPOSITE_DIRECTIONS = {
  N: "S",
  E: "W",
  S: "N",
  W: "E"
}

// Scarab mirror orientations
export const SCARAB_SLASH_FACINGS = new Set(["NE", "SE"])
export const SCARAB_BACKSLASH_FACINGS = new Set(["NW", "SW"])

// Mirror reflection mappings
export const SLASH_REFLECTION_MAPPING = {
  N: "E",
  E: "N",
  S: "W",
  W: "S"
}

export const BACKSLASH_REFLECTION_MAPPING = {
  N: "W",
  W: "N",
  S: "E",
  E: "S"
}

// Board dimensions
export const BOARD_ROWS = 8
export const BOARD_COLS = 10

// Reserved squares (Khet 2.0 rules)
export const RESERVED_RED = new Set([
  "0-0", "0-1", "0-2", "0-3", "0-4", "0-5", "0-6", "0-7", "0-8", "0-9",
  "1-0", "1-9",
  "2-0", "2-9",
  "3-0", "3-9",
  "4-0", "4-9",
  "5-0", "5-9",
  "6-0", "6-9",
  "7-0", "7-1", "7-2", "7-3", "7-4", "7-5", "7-6", "7-7", "7-8", "7-9"
])

export const RESERVED_SILVER = new Set([
  "0-0", "0-1", "0-2", "0-3", "0-4", "0-5", "0-6", "0-7", "0-8", "0-9",
  "1-0", "1-9",
  "2-0", "2-9",
  "3-0", "3-9",
  "4-0", "4-9",
  "5-0", "5-9",
  "6-0", "6-9",
  "7-0", "7-1", "7-2", "7-3", "7-4", "7-5", "7-6", "7-7", "7-8", "7-9"
])

// Game modes
export const GAME_MODES = {
  PVP: 'pvp',
  PVC_EASY: 'pvc_easy',
  PVC_MEDIUM: 'pvc_medium',
  PVC_HARD: 'pvc_hard'
}

// Move types
export const MOVE_TYPES = {
  MOVE: 'move',
  ROTATE: 'rotate',
  SWAP: 'swap'
}
