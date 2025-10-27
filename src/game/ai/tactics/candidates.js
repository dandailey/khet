// Khet Tactics - Candidate Move Pruning
// Beam-centric candidate selection to reduce branching factor

import { generateLegalMoves, applyMove } from '../../rules.js'
import { resolveLaser } from '../../laser.js'
import { moveAffectsBeam, detectImmediateThreat, detectVulnerablePieces, detectCaptureOpportunities } from './beam.js'
import { checkMoveSafety } from './safety.js'
import { evaluate as evaluateState, DEFAULT_CONFIG } from './scoring.js'

/**
 * Get pruned candidates for search
 * @param {Object} state - Game state
 * @param {string} player - Current player
 * @param {Object} config - Pruning configuration
 * @returns {Array} Pruned move candidates
 */
export function getPrunedCandidates(state, player, options = {}) {
  const {
    pruning = {},
    safety = {},
    scoring = DEFAULT_CONFIG,
    enableQuiescence,
    debug = false
  } = options

  const {
    maxCandidates = 12,
    includeBlocks = true,
    includeWins = true,
    forbidSelfZap = true,
    forbidOneMoveMate = true
  } = pruning

  const safetyConfig = {
    forbidSelfZap,
    forbidOneMoveMate,
    checkPharaoh: safety.checkPharaoh !== false,
    checkAnubis: safety.checkAnubis !== false
  }
  
  // Get all legal moves
  const legalMoves = generateLegalMoves(state, player)
  const opponent = player === 'red' ? 'silver' : 'red'
  
  // Pre-compute tactical information
  const threat = detectImmediateThreat(state, player)
  const vulnerablePieces = detectVulnerablePieces(state, player)
  const threatenedPieceMap = new Map()
  vulnerablePieces.forEach(item => {
    const key = `${item.row},${item.col}`
    const current = threatenedPieceMap.get(key) || { value: 0, count: 0 }
    const pieceValue = scoring.material[item.piece.type] || 0
    threatenedPieceMap.set(key, {
      value: current.value + pieceValue,
      count: current.count + 1
    })
  })
  const initialThreatValue = vulnerablePieces.reduce((total, item) => {
    const value = scoring.material[item.piece.type] || 0
    return total + value
  }, 0)
  const captureOpportunities = detectCaptureOpportunities(state, player, legalMoves)
  
  // Build map of capture moves for quick lookup
  const captureMoveKeys = new Set(
    captureOpportunities.map(c => `${c.move.type}-${c.move.from.row}-${c.move.from.col}-${c.move.to?.row}-${c.move.to?.col}`)
  )
  
  // Categorize moves
  const wins = []
  const blocks = []
  const captures = []
  const defenses = [] // Moves that save vulnerable pieces
  const beamAffecting = []
  const neutral = []
  const unsafe = []
  if (debug) {
    console.log('[candidates] evaluating', legalMoves.length, 'legal moves for', player)
  }
  
  for (const move of legalMoves) {
    const moveDebug = debug ? { move, tags: [] } : null
    // Safety filter – always validate rotations/moves to avoid self-zaps
    const safetyResult = checkMoveSafety(state, move, player, safetyConfig)
    if (!safetyResult.isValid) continue
    
    const postMove = resolveLaser(applyMove(state, move), player)
    const moveData = {
      move,
      nextState: postMove.newState,
      laser: postMove.laserResult
    }

    // Calculate capture value (material removed from opponent)
    const captureValue = (moveData.laser?.hits || []).reduce((total, hit) => {
      if (hit.destroyed && hit.piece && hit.piece.player !== player) {
        const value = scoring.material[hit.piece.type] || 0
        return total + value
      }
      return total
    }, 0)
    moveData.captureValue = captureValue

    // Winning moves (highest priority)
    if (includeWins && moveData.nextState.gameOver && moveData.nextState.winner === player) {
      wins.push(moveData)
      continue
    }

    // Blocking moves (urgent if under threat)
    if (includeBlocks && threat) {
      const threatAfter = detectImmediateThreat(moveData.nextState, player)
      if (!threatAfter) {
        blocks.push(moveData)
        continue
      }
    }

    // Capture moves (check against pre-computed list)
    const moveKey = `${move.type}-${move.from.row}-${move.from.col}-${move.to?.row}-${move.to?.col}`
    if (captureMoveKeys.has(moveKey) || captureValue > 0) {
      moveDebug && moveDebug.tags.push(`capture(${captureValue})`)
      captures.push(moveData)
      continue
    }

    // Defense moves (protect vulnerable pieces)
    if (vulnerablePieces.length > 0) {
      const vulnerableAfter = detectVulnerablePieces(moveData.nextState, player)
      const savedValue = Math.max(0, initialThreatValue - vulnerableAfter.reduce((total, item) => {
        const value = scoring.material[item.piece.type] || 0
        return total + value
      }, 0))

      if (savedValue > 0) {
        moveData.defenseValue = savedValue
        const key = `${move.to?.row ?? move.from.row},${move.to?.col ?? move.from.col}`
        const threatenedInfo = threatenedPieceMap.get(key)
        if (threatenedInfo && threatenedInfo.value > 0) {
          moveData.mustBlockPriority = threatenedInfo.value
        }
        moveDebug && moveDebug.tags.push(`defense(${savedValue})`)
        defenses.push(moveData)
        continue
      }
    }

    // Beam-affecting moves
    if (moveAffectsBeam(state, move, player)) {
      beamAffecting.push(moveData)
      continue
    }

    // Track moves that leave the opponent with equal or more capture value
    const opponentReplyCaptures = detectCaptureOpportunities(moveData.nextState, opponent, null)
    const opponentThreatValue = opponentReplyCaptures.reduce((total, cap) => {
      const value = (cap.capturedPiece && scoring.material[cap.capturedPiece.type]) || 0
      return total + value
    }, 0)

    if (opponentThreatValue > captureValue) {
      moveData.riskValue = opponentThreatValue - captureValue
      moveDebug && moveDebug.tags.push(`risk(${moveData.riskValue})`)
      unsafe.push(moveData)
      continue
    }

    moveDebug && moveDebug.tags.push('neutral')
    neutral.push(moveData)
    if (moveDebug) {
      const debugInfo = {
        tags: moveDebug.tags,
        captureValue: moveData.captureValue,
        defenseValue: moveData.defenseValue,
        riskValue: moveData.riskValue
      }
      console.log('[candidates] move', move, debugInfo)
    }
  }
  
  // Sort tactical categories by effectiveness
  captures.sort((a, b) => (b.captureValue || 0) - (a.captureValue || 0))
  const mustBlocks = defenses.filter(item => item.mustBlockPriority)
  const regularDefenses = defenses.filter(item => !item.mustBlockPriority)
  mustBlocks.sort((a, b) => (b.mustBlockPriority || 0) - (a.mustBlockPriority || 0))
  regularDefenses.sort((a, b) => (b.defenseValue || 0) - (a.defenseValue || 0))
  const defenseLimit = Math.max(2, Math.floor(maxCandidates / 3))
  unsafe.sort((a, b) => (a.riskValue || 0) - (b.riskValue || 0))

  let prioritized
  if (mustBlocks.length > 0) {
    prioritized = [
      ...wins,
      ...blocks,
      ...captures,
      ...mustBlocks,
      ...beamAffecting,
      ...regularDefenses,
      ...neutral,
      ...unsafe
    ]
  } else {
    prioritized = [
      ...wins,
      ...blocks,
      ...captures,
      ...regularDefenses.slice(0, defenseLimit),
      ...beamAffecting,
      ...neutral,
      ...unsafe
    ]
  }
  
  // Always include all wins and blocks
  const critical = [...wins, ...blocks]
  const remaining = prioritized.slice(critical.length)
  
  // Score remaining moves and take top K
  const scored = remaining.slice(0, Math.min(50, remaining.length)).map(item => {
    const score = evaluateState(item.nextState, player, item.move, scoring)
    return {
      move: item.move,
      nextState: item.nextState,
      laser: item.laser,
      score
    }
  })
  
  scored.sort((a, b) => b.score - a.score)
  
  // Combine critical moves with top-scored moves
  const finalCandidates = [
    ...critical.map(item => ({
      move: item.move,
      nextState: item.nextState,
      laser: item.laser,
      score: 999999 // Critical moves get max score
    })),
    ...scored.slice(0, Math.max(1, maxCandidates - critical.length))
  ]
  
  return finalCandidates
}
