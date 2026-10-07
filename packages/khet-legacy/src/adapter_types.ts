export type Color = 'silver' | 'red'
export type PieceType = 'pharaoh' | 'sphinx' | 'pyramid' | 'scarab' | 'anubis'
export type Facing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW'
export type Player = Color | 1 | 2

export interface LegacyPiece<P extends Player = Player> {
  type: PieceType
  player: P
  facing: Facing
}

// State stays in its original encoding. Never rebuild it from legacyToPieces:
// invalid AI facings and distinct but optically equivalent scarab facings matter.
export interface LState<P extends Player = Player> {
  currentPlayer: P
  board: (LegacyPiece<P> | null)[][]
  gameOver: boolean
  winner: P | null
  gameMode?: string
  selectedPiece?: LegacyPiece<P> | null
  selectedSquare?: { row: number; col: number } | null
  actionTaken?: boolean
}

export interface SpecPiece {
  type: PieceType
  color: Color
  o: number
  row: number
  col: number
}

export interface ApplyResult<S> {
  state: S
  laser: { path: number[]; destroyed: number }
}

export interface LegacyAdapter<S extends LState> {
  legacyNewGame(): S
  legacyLegalMoves(state: S): string[]
  legacyApply(state: S, move: string): ApplyResult<S>
  legacyToPieces(state: S): SpecPiece[]
}

export function squareText(row: number, col: number): string {
  return `${String.fromCharCode(97 + col)}${8 - row}`
}

export function orientation(piece: LegacyPiece): number {
  switch (piece.type) {
    case 'pharaoh': return 0
    case 'pyramid': return ['NE', 'SE', 'SW', 'NW'].indexOf(piece.facing)
    case 'scarab': return piece.facing === 'NE' || piece.facing === 'SE' ? 0 : 1
    default: return ['N', 'E', 'S', 'W'].indexOf(piece.facing)
  }
}

export function toPieces(state: LState): SpecPiece[] {
  const pieces: SpecPiece[] = []
  state.board.forEach((rank, row) => rank.forEach((piece, col) => {
    if (piece) pieces.push({
      type: piece.type,
      color: piece.player === 'red' || piece.player === 1 ? 'red' : 'silver',
      o: orientation(piece), row, col,
    })
  }))
  return pieces
}
