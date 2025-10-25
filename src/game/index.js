// Khet Game Engine - Main Export

// Types and constants
export * from './types.js'

// State management
export * from './state.js'

// Game rules and move generation
export * from './rules.js'

// Laser mechanics
export * from './laser.js'

// Evaluation heuristics
export * from './eval.js'

// AI policies
export { chooseMove as chooseMoveEasy, shouldFireLaser as shouldFireLaserEasy } from './ai/policy_easy.js'
export { chooseMove as chooseMoveMedium, shouldFireLaser as shouldFireLaserMedium } from './ai/policy_medium.js'
export { chooseMove as chooseMoveHard, shouldFireLaser as shouldFireLaserHard } from './ai/policy_hard.js'
