// Khet AI - Easy Difficulty Policy

import { applyMove, generateLegalMoves } from '../rules.js'
import { resolveLaser } from '../laser.js'
import { getPrunedCandidates } from './tactics/candidates.js'
import { evaluate as evaluateState, DEFAULT_CONFIG } from './tactics/scoring.js'
import { detectVulnerablePieces, detectImmediateThreat } from './tactics/beam.js'

const WIN_SCORE = 1_000_000
const LOSS_SCORE = -WIN_SCORE
const DEFAULT_PRUNING = {
  maxCandidates: 12,
  includeBlocks: true,
  includeWins: true,
  forbidSelfZap: true,
  forbidOneMoveMate: true
}
const DEFAULT_SAFETY = {
  checkPharaoh: true,
  checkAnubis: true
}

const otherPlayer = (player) => (player === 'red' ? 'silver' : 'red')

function deepMerge(target, source) {
  const result = { ...target }
  if (!source) return result
  for (const [key, value] of Object.entries(source)) {
    result[key] = value && typeof value === 'object' && !Array.isArray(value)
      ? deepMerge(result[key] || {}, value)
      : value
  }
  return result
}

function ensureCandidateState(baseState, player, entry) {
  if (!entry.nextState || !entry.laser) {
    const result = resolveLaser(applyMove(baseState, entry.move), player)
    entry.nextState = result.newState
    entry.laser = result.laserResult
  }
  return entry
}

function evaluateLeaf(state, player, scoringConfig) {
  if (state.gameOver) {
    if (state.winner === player) return WIN_SCORE
    if (state.winner && state.winner !== player) return LOSS_SCORE
    return 0
  }
  return evaluateState(state, player, null, scoringConfig)
}

function scoreCandidate(state, player, candidateEntry, config, stats) {
  const scoringConfig = config.scoring
  const rootEntry = ensureCandidateState(state, player, { ...candidateEntry })
  const nextState = rootEntry.nextState
  stats.nodes += 1

  const captureDelta = rootEntry.laser?.hits?.reduce((total, hit) => {
    if (!hit.destroyed || !hit.piece) return total
    const pieceValue = scoringConfig.material?.[hit.piece.type] || 0
    if (hit.piece.player === player) {
      console.log(`Self-capture detected: ${hit.piece.type} worth ${pieceValue}`)
      return total - pieceValue * 10
    }
    console.log(`Opponent capture: ${hit.piece.type} worth ${pieceValue}`)
    return total + pieceValue * 10
  }, 0) || 0

  const immediateScore = evaluateLeaf(nextState, player, scoringConfig) + captureDelta * 10
  if (nextState.gameOver) {
    console.log('Winning move found!', candidateEntry.move)
    return immediateScore
  }

  const opponent = otherPlayer(player)
  const opponentCandidates = getPrunedCandidates(nextState, opponent, config)
  console.log(`Evaluating ${opponentCandidates.length} opponent reply candidates`)
  if (!opponentCandidates.length) {
    return immediateScore
  }

  let worst = WIN_SCORE
  for (const opp of opponentCandidates) {
    stats.nodes += 1
    const oppEntry = ensureCandidateState(nextState, opponent, { ...opp })
    const oppState = oppEntry.nextState
    const opponentDelta = oppEntry.laser?.hits?.reduce((total, hit) => {
      if (!hit.destroyed || !hit.piece) return total
      const pieceValue = scoringConfig.material?.[hit.piece.type] || 0
      if (hit.piece.player === opponent) {
        console.log(`Opponent captures our ${hit.piece.type} worth ${pieceValue}`)
        return total + pieceValue * 10
      }
      return total - pieceValue * 10
    }, 0) || 0
    const replyScore = evaluateLeaf(oppState, player, scoringConfig) - opponentDelta * 10
    console.log(`Reply score: ${replyScore}, worst so far: ${worst}`)
    if (replyScore < worst) {
      worst = replyScore
    }
    const needQuiescence = config.enableQuiescence && opponentDelta !== 0
    if (needQuiescence) {
      const followCandidates = getPrunedCandidates(oppState, player, {
        ...config,
        enableQuiescence: false
      })
      if (followCandidates.length) {
        let bestFollow = -WIN_SCORE
        for (const follow of followCandidates) {
          const followEntry = ensureCandidateState(oppState, player, { ...follow })
          const followState = followEntry.nextState
          const followScore = evaluateLeaf(followState, player, scoringConfig)
          if (followScore > bestFollow) bestFollow = followScore
        }
        if (bestFollow < worst) worst = bestFollow
      }
    }
    if (worst <= LOSS_SCORE && !needQuiescence) break
  }

  return worst
}

export async function chooseMove(state, player, options = {}) {
  const {
    timeMs = 120,
    rngSeed = Math.random(),
    randomTopN = 1,
    pruning = {},
    safety = {},
    scoring,
    quiescence = true,
    debug = false
  } = options

  const pruningConfig = { ...DEFAULT_PRUNING, ...pruning }
  const safetyConfig = { ...DEFAULT_SAFETY, ...safety }
  const scoringConfig = scoring ? deepMerge(DEFAULT_CONFIG, scoring) : DEFAULT_CONFIG
  const tacticsConfig = {
    pruning: pruningConfig,
    safety: safetyConfig,
    scoring: scoringConfig,
    enableQuiescence: quiescence,
    debug
  }

  const startTime = Date.now()
  const opponent = otherPlayer(player)
  
  // PHARAOH CHECK: If pharaoh can die next turn, ONLY consider moves that prevent it
  const pharaohThreat = detectImmediateThreat(state, player)
  if (pharaohThreat) {
    if (debug) {
      console.log(`[PHARAOH-THREAT] King in danger! ${pharaohThreat.killingMoves.length} killing moves detected`)
    }
    
    // Generate all legal moves and check which ones save the pharaoh
    const allMoves = generateLegalMoves(state, player)
    const pharaohSavingMoves = []
    
    for (const move of allMoves) {
      const afterMove = applyMove(state, move)
      const laserResult = resolveLaser(afterMove, player)
      const afterState = laserResult.newState
      
      // Check if pharaoh still threatened after this move
      const stillThreatened = detectImmediateThreat(afterState, player)
      if (!stillThreatened) {
        pharaohSavingMoves.push({
          move,
          nextState: afterState,
          laser: laserResult.laserResult
        })
        if (debug) {
          console.log(`[PHARAOH-SAVE] found move that saves king:`, move)
        }
      }
    }
    
    if (pharaohSavingMoves.length > 0) {
      // Use only pharaoh-saving moves
      const candidates = pharaohSavingMoves
      const stats = { nodes: 0 }
      const evaluated = candidates.map(candidate => {
        const score = scoreCandidate(state, player, candidate, tacticsConfig, stats)
        return { candidate, score }
      })
      
      evaluated.sort((a, b) => b.score - a.score)
      const chosenEntry = evaluated[0]
      const chosen = ensureCandidateState(state, player, { ...chosenEntry.candidate })
      
      if (debug) {
        console.log(`[PHARAOH-SAVE] chose best saving move with score ${chosenEntry.score}`)
      }
      
      return {
        move: chosen.move,
        newState: chosen.nextState,
        laserResult: chosen.laser,
        evaluation: chosenEntry.score,
        stats: {
          depth: 2,
          nodes: stats.nodes,
          candidatesExamined: candidates.length,
          bestScore: evaluated[0].score,
          worstScore: evaluated[evaluated.length - 1].score,
          thinkingTime: Date.now() - startTime,
          timeBudgetMs: timeMs
        }
      }
    } else {
      if (debug) {
        console.log(`[PHARAOH-THREAT] NO SAVING MOVES FOUND - pharaoh will die`)
      }
      // No saving moves - fall through to normal logic (probably lose, but try)
    }
  }
  
  // MUST-DEFEND CHECK: If we have immediate threats, filter to only defensive moves
  const vulnerablePieces = detectVulnerablePieces(state, player)
  const threatenedValue = vulnerablePieces.reduce((total, item) => {
    const value = scoringConfig.material[item.piece.type] || 0
    return total + value
  }, 0)
  
  if (threatenedValue > 0 && debug) {
    console.log(`[must-defend] ${threatenedValue} material threatened, checking defensive moves`)
  }
  
  let candidates
  if (threatenedValue > 0) {
    // Generate ALL legal moves and check which ones eliminate the threat
    const allMoves = generateLegalMoves(state, player)
    const defensiveMoves = []
    
    for (const move of allMoves) {
      const afterMove = applyMove(state, move)
      const laserResult = resolveLaser(afterMove, player)
      const afterState = laserResult.newState
      
      // Skip moves that cause instant game over for us
      if (afterState.gameOver && afterState.winner === opponent) {
        continue
      }
      
      // Check remaining threat after this move
      const stillVulnerable = detectVulnerablePieces(afterState, player)
      const remainingThreat = stillVulnerable.reduce((total, item) => {
        const value = scoringConfig.material[item.piece.type] || 0
        return total + value
      }, 0)
      
      if (remainingThreat < threatenedValue) {
        defensiveMoves.push({
          move,
          nextState: afterState,
          laser: laserResult.laserResult,
          threatReduction: threatenedValue - remainingThreat
        })
        if (debug) {
          console.log(`[must-defend] found defensive move`, move, `reduces threat by ${threatenedValue - remainingThreat}`)
        }
      }
    }
    
    // If we found moves that reduce threat, use only those
    if (defensiveMoves.length > 0) {
      // Sort by threat reduction (highest first)
      defensiveMoves.sort((a, b) => b.threatReduction - a.threatReduction)
      candidates = defensiveMoves.slice(0, pruningConfig.maxCandidates)
      if (debug) {
        console.log(`[must-defend] using ${candidates.length} defensive candidates`)
      }
    } else {
      // No defensive moves found, fall back to normal pruning
      candidates = getPrunedCandidates(state, player, tacticsConfig)
    }
  } else {
    // No immediate threats, use normal pruning
    candidates = getPrunedCandidates(state, player, tacticsConfig)
  }
  
  if (!candidates.length) {
    return null
  }

  const stats = { nodes: 0 }
  const evaluated = candidates.map(candidate => {
    const score = scoreCandidate(state, player, candidate, tacticsConfig, stats)
    if (options.debug) {
      console.log('[policy_easy] candidate', candidate.move, 'score', score)
    }
    return { candidate, score }
  })

  evaluated.sort((a, b) => b.score - a.score)

  // DAMAGE CONTROL: If all moves are bad, pick least bad
  // Check if best move is catastrophically negative
  const bestScore = evaluated[0].score
  const allBad = bestScore < -1000
  
  if (allBad && debug) {
    console.log(`[damage-control] All moves are bad (best: ${bestScore}). Picking least awful.`)
  }
  
  // HARD BAN: Filter out moves that expose major material to unavoidable capture
  // Only apply if we have safe alternatives AND we're not in damage control
  const safeThreshold = allBad ? -Infinity : -500
  const safeMoves = evaluated.filter(e => e.score > safeThreshold)
  
  const finalCandidates = safeMoves.length > 0 ? safeMoves : evaluated
  if (debug && !allBad && safeMoves.length < evaluated.length) {
    console.log(`[hard-ban] filtered ${evaluated.length - safeMoves.length} dangerous moves`)
  }

  const band = Math.max(1, Math.min(randomTopN, finalCandidates.length))
  const index = band === 1 ? 0 : Math.floor(rngSeed * band)
  const chosenEntry = finalCandidates[index]
  const chosen = ensureCandidateState(state, player, { ...chosenEntry.candidate })

  const thinkingTime = Date.now() - startTime

  return {
    move: chosen.move,
    newState: chosen.nextState,
    laserResult: chosen.laser,
    evaluation: chosenEntry.score,
    stats: {
      depth: 2,
      nodes: stats.nodes,
      candidatesExamined: candidates.length,
      bestScore: finalCandidates[0].score,
      worstScore: finalCandidates[finalCandidates.length - 1].score,
      thinkingTime,
      timeBudgetMs: timeMs
    }
  }
}

export function shouldFireLaser() {
  return true
}
