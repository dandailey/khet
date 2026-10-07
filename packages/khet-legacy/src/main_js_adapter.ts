import {
  createInitialState, withGameState, showMoveOptions, rotationDirections,
  movePiece, rotatePiece, fireLaser,
} from './main_js/rules.js'
import { squareText, toPieces } from './adapter_types.ts'
import type { LState as State, ApplyResult, SpecPiece } from './adapter_types.ts'

export type LState = State<1 | 2>

interface NativeMove {
  text: string
  row: number
  col: number
  to?: { row: number; col: number }
  direction?: string
}

interface NativeSegment {
  endRow: number
  endCol: number
  outOfBounds?: boolean
  destroyed?: boolean
  hitRow?: number
  hitCol?: number
}

function moves(state: LState): NativeMove[] {
  // From handleSquareClick: game-over gate and selecting only the mover's pieces.
  if (state.gameOver) return []
  return withGameState(state, () => {
    const result: NativeMove[] = []
    state.board.forEach((rank, row) => rank.forEach((piece, col) => {
      if (!piece || piece.player !== state.currentPlayer) return
      const from = squareText(row, col)
      for (const to of showMoveOptions(row, col, piece)) {
        const separator = state.board[to.row][to.col] ? 'x' : '-'
        result.push({ text: `${from}${separator}${squareText(to.row, to.col)}`, row, col, to })
      }
      for (const direction of rotationDirections(row, col, piece)) {
        // Scarab buttons are equivalent; Sphinx uses '+' even for its left turn.
        const suffix = piece.type === 'scarab' || piece.type === 'sphinx' || direction === 'right' ? '+' : '-'
        const text = `${from}${suffix}`
        if (!result.some(move => move.text === text)) result.push({ text, row, col, direction })
      }
    }))
    return result
  })
}

export function legacyNewGame(): LState {
  return createInitialState() as LState
}

export function legacyLegalMoves(state: LState): string[] {
  return moves(state).map(move => move.text).sort()
}

export function legacyApply(state: LState, text: string): ApplyResult<LState> {
  const move = moves(state).find(candidate => candidate.text === text)
  if (!move) throw new Error(`Illegal legacy move: ${text}`)
  const next = structuredClone(state)
  return withGameState(next, () => {
    if (move.to) movePiece(move.row, move.col, move.to.row, move.to.col)
    else rotatePiece(move.row, move.col, move.direction!)
    // The original move/rotate timer and laser completion callback run synchronously.
    const segments = fireLaser() as NativeSegment[]
    const hit = segments.find(segment => segment.destroyed)
    return {
      state: next,
      laser: {
        path: segments.filter(segment => !segment.outOfBounds).map(segment => segment.endRow * 10 + segment.endCol),
        destroyed: hit ? hit.hitRow! * 10 + hit.hitCol! : -1,
      },
    }
  })
}

export function legacyToPieces(state: LState): SpecPiece[] {
  return toPieces(state)
}
