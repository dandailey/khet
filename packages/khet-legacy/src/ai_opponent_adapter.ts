import { createInitialState } from './ai_opponent/state.js'
import { generateLegalMoves, applyMove, switchPlayer } from './ai_opponent/rules.js'
import { resolveLaser } from './ai_opponent/laser.js'
import { squareText, toPieces } from './adapter_types.ts'
import type { LState as State, Color, Facing, LegacyPiece, ApplyResult, SpecPiece } from './adapter_types.ts'

export type LState = State<Color>

interface NativeMove {
  type: 'move' | 'swap' | 'rotate'
  from: { row: number; col: number }
  to: { row: number; col: number }
  piece: LegacyPiece<Color>
  targetPiece?: LegacyPiece<Color>
  newFacing?: Facing
}

interface NativeLaserResult {
  newState: LState
  laserResult: {
    path: { row: number; col: number }[]
    hits: { row: number; col: number; destroyed: boolean }[]
    winner: Color | null
  }
}

function moveText(move: NativeMove): string {
  const from = squareText(move.from.row, move.from.col)
  if (move.type !== 'rotate') {
    return `${from}${move.type === 'swap' ? 'x' : '-'}${squareText(move.to.row, move.to.col)}`
  }
  if (move.piece.type === 'sphinx') {
    const toggle: Record<string, Facing> = move.piece.player === 'silver'
      ? { N: 'W', W: 'N' } : { S: 'E', E: 'S' }
    return toggle[move.piece.facing] === move.newFacing ? `${from}+` : `${from}+@${move.newFacing}`
  }
  if (move.piece.type === 'scarab') {
    // The same exact native toggle as main.js, not a normalization of AI moves.
    const toggle: Record<string, Facing> = { NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' }
    if (toggle[move.piece.facing] === move.newFacing) return `${from}+`
  } else {
    const facings: Facing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']
    const delta = (facings.indexOf(move.newFacing!) - facings.indexOf(move.piece.facing) + 8) % 8
    if (delta === 2) return `${from}+`
    if (delta === 6) return `${from}-`
  }
  // Spec 4.4 cannot encode the other legacy rotations. Retain every native
  // action with an explicit absolute-facing extension rather than drop bugs.
  return `${from}+@${move.newFacing}`
}

function moves(state: LState): NativeMove[] {
  return generateLegalMoves(state, state.currentPlayer) as NativeMove[]
}

export function legacyNewGame(): LState {
  return createInitialState() as LState
}

export function legacyLegalMoves(state: LState): string[] {
  return moves(state).map(moveText).sort()
}

export function legacyApply(state: LState, text: string): ApplyResult<LState> {
  const move = moves(state).find(candidate => moveText(candidate) === text)
  if (!move) throw new Error(`Illegal legacy move: ${text}`)
  const acted = applyMove(state, move)
  const resolved = resolveLaser(acted, state.currentPlayer) as NativeLaserResult
  const next = resolved.newState
  const hit = resolved.laserResult.hits.find(hit => hit.destroyed)
  return {
    state: next.gameOver ? next : switchPlayer(next) as LState,
    laser: {
      // Both adapters report visited in-board squares after the first step.
      path: resolved.laserResult.path.map(sq => sq.row * 10 + sq.col),
      destroyed: hit ? hit.row * 10 + hit.col : -1,
    },
  }
}

export function legacyToPieces(state: LState): SpecPiece[] {
  return toPieces(state)
}
