// Board-only action application: staging must never trace or fire the laser.
export function applyBoardAction(board, action) {
  const next = board.map(row => row.map(piece => piece ? { ...piece } : null))
  const { from, to, kind, direction } = action
  const piece = next[from.row][from.col]
  if (kind !== 'rotate') {
    next[from.row][from.col] = kind === 'swap' ? next[to.row][to.col] : null
    next[to.row][to.col] = piece
  } else if (piece.type === 'sphinx') {
    if (from.row === 0 && from.col === 0) piece.facing = piece.facing === 'E' ? 'S' : 'E'
    else if (from.row === 7 && from.col === 9) piece.facing = piece.facing === 'W' ? 'N' : 'W'
  } else if (piece.type === 'scarab') {
    piece.facing = { NE: 'SW', SW: 'NE', NW: 'SE', SE: 'NW' }[piece.facing]
  } else {
    const facings = piece.type === 'pyramid' ? ['NE', 'SE', 'SW', 'NW'] : ['N', 'E', 'S', 'W']
    piece.facing = facings[(facings.indexOf(piece.facing) + (direction === 'cw' ? 1 : 3)) % 4]
  }
  return next
}

export function actionFromTurn(turn, board) {
  if (!turn?.from || !board[turn.from.row]?.[turn.from.col]) return null
  return turn.rotation
    ? { kind: 'rotate', from: turn.from, to: turn.from, direction: turn.direction === 'right' ? 'cw' : 'ccw' }
    : turn.to ? { kind: turn.swap ? 'swap' : 'move', from: turn.from, to: turn.to } : null
}
