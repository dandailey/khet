import {
  ANUBIS, PHARAOH, PYRAMID, RED, SCARAB, SILVER, SPHINX,
  fromKFEN, fromPieces, toKFEN
} from '../../packages/khet-engine/src/index.ts'

const GAME_RED = 1
const GAME_SILVER = 2
const TYPES = { pharaoh: PHARAOH, sphinx: SPHINX, pyramid: PYRAMID, scarab: SCARAB, anubis: ANUBIS }
const NAMES = Object.fromEntries(Object.entries(TYPES).map(([name, type]) => [type, name]))
const CARDINAL = ['N', 'E', 'S', 'W']
const DIAGONAL = ['NE', 'SE', 'SW', 'NW']
const VECTORS = [[-1, 0], [0, 1], [1, 0], [0, -1]]

function engineColor(player) {
  if (player === GAME_RED) return RED
  if (player === GAME_SILVER) return SILVER
  throw new Error(`Invalid game player: ${player}`)
}

// These mappings are verified against the game's entry-face reflection/absorption,
// not the SVG angles. Scarab NE/SE = /; NW/SW = \.
function orientation(piece) {
  if (piece.type === 'pharaoh') return 0
  if (piece.type === 'scarab') {
    if (piece.facing === 'NE' || piece.facing === 'SE') return 0
    if (piece.facing === 'NW' || piece.facing === 'SW') return 1
  } else {
    const o = (piece.type === 'pyramid' ? DIAGONAL : CARDINAL).indexOf(piece.facing)
    if (o >= 0) return o
  }
  throw new Error(`Invalid ${piece.type} facing: ${piece.facing}`)
}

/** Canonical engine KFEN. Native UI states have no ply counter, so default to 0. */
export function gameStateToKFEN(gameState) {
  if (gameState.board.length !== 8 || gameState.board.some(row => row.length !== 10)) {
    throw new Error('Expected an 8 by 10 game board')
  }
  const pieces = []
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 10; col += 1) {
      const piece = gameState.board[row][col]
      if (piece) pieces.push({ row, col, type: TYPES[piece.type], color: engineColor(piece.player), o: orientation(piece) })
    }
  }
  const pos = fromPieces(pieces, engineColor(gameState.currentPlayer))
  pos.ply = gameState.ply ?? 0
  if (!Number.isSafeInteger(pos.ply) || pos.ply < 0) throw new Error('Invalid game ply')
  return toKFEN(pos)
}

/** Pieces, side and optional KFEN ply only; KFEN does not preserve UI or repetition state. */
export function kfenToBoard(kfen) {
  // Use the engine parser: '/' is both a rank delimiter and a scarab orientation.
  const pos = fromKFEN(kfen)
  const board = Array.from({ length: 8 }, () => Array(10).fill(null))
  for (const { row, col, type, color, o } of pos.toPieces()) {
    const facing = type === PHARAOH ? 'N' : type === SCARAB ? ['NE', 'NW'][o]
      : type === PYRAMID ? DIAGONAL[o] : CARDINAL[o]
    board[row][col] = { type: NAMES[type], player: color === RED ? GAME_RED : GAME_SILVER, facing }
  }
  return { board, currentPlayer: pos.side === RED ? GAME_RED : GAME_SILVER, ply: pos.ply }
}

function square(text) {
  return { row: 8 - Number(text[1]), col: text.charCodeAt(0) - 97 }
}

function squareText(point) {
  if (!point || !Number.isInteger(point.row) || !Number.isInteger(point.col) ||
      point.row < 0 || point.row > 7 || point.col < 0 || point.col > 9) throw new Error('Invalid game square')
  return String.fromCharCode(97 + point.col) + (8 - point.row)
}

function sourcePiece(from, gameState) {
  const piece = gameState.board[from.row][from.col]
  if (!piece || piece.player !== gameState.currentPlayer) throw new Error('Expected a piece of the side to move')
  return piece
}

function sphinxCanTurn(piece, from, direction) {
  const o = (orientation(piece) + (direction === 'cw' ? 1 : 3)) % 4
  const [dr, dc] = VECTORS[o]
  return from.row + dr >= 0 && from.row + dr < 8 && from.col + dc >= 0 && from.col + dc < 10
}

/** Translation only; move legality remains the engine's responsibility. */
export function engineMoveToGameAction(moveStr, gameState) {
  const match = /^([a-j][1-8])(?:([-x])([a-j][1-8])|([+-]))$/.exec(moveStr)
  if (!match) throw new Error(`Invalid engine move: ${moveStr}`)
  const from = square(match[1])
  const piece = sourcePiece(from, gameState)
  if (match[3]) return { kind: match[2] === 'x' ? 'swap' : 'move', from, to: square(match[3]) }
  if (piece.type === 'pharaoh') throw new Error('Pharaoh cannot rotate')
  let direction = match[4] === '+' ? 'cw' : 'ccw'
  // A sole Sphinx turn uses '+' in engine notation even when physically CCW.
  if (piece.type === 'sphinx' && direction === 'cw' && !sphinxCanTurn(piece, from, 'cw')) direction = 'ccw'
  return { kind: 'rotate', from, to: { ...from }, direction }
}

export function gameActionToEngineMove(action, gameState) {
  const from = squareText(action.from)
  const piece = sourcePiece(action.from, gameState)
  if (action.kind === 'move' || action.kind === 'swap') {
    return from + (action.kind === 'swap' ? 'x' : '-') + squareText(action.to)
  }
  if (action.kind !== 'rotate' || !['cw', 'ccw'].includes(action.direction)) throw new Error('Invalid game action')
  if (piece.type === 'pharaoh') throw new Error('Pharaoh cannot rotate')
  if (piece.type === 'scarab') return from + '+' // Both UI buttons toggle the same mirror.
  if (piece.type === 'sphinx') {
    if (!sphinxCanTurn(piece, action.from, action.direction)) throw new Error('Sphinx would face off board')
    if (!sphinxCanTurn(piece, action.from, 'cw')) return from + '+'
  }
  return from + (action.direction === 'cw' ? '+' : '-')
}
