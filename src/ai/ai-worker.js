import { bestMove, fromKFEN } from '../../packages/khet-engine/src/index.ts'

self.onmessage = ({ data: { kfen, level, seed } }) => {
  try {
    const { move, depth, score } = bestMove(fromKFEN(kfen), { level, seed })
    self.postMessage({ move, depth, score })
  } catch (error) {
    self.postMessage({ error: error.message })
  }
}
