// Khet Tactics - Barrel export
export {
  getBeamInfluence,
  isInBeamInfluence,
  detectImmediateThreat,
  detectVulnerablePieces,
  detectCaptureOpportunities,
  moveAffectsBeam
} from './beam.js'

export {
  checkSelfZap,
  checkPharaohExposure,
  checkAnubisPositioning,
  checkAnubisFacing,
  checkMoveSafety
} from './safety.js'

export {
  DEFAULT_CONFIG,
  evaluateMaterial,
  evaluateKingSafety,
  evaluateBeamPressure,
  evaluate
} from './scoring.js'

export {
  getPrunedCandidates
} from './candidates.js'
