import type { SearchOptions } from './types.ts';

export interface LevelDefinition {
  level: number;
  name: string;
  limits: Pick<SearchOptions, 'depth' | 'nodes' | 'timeMs'>;
  noise?: number;
  /** Legacy full-window softmax sampling, used only when explicitly configured. */
  temperature?: number;
  blunderDepthCap?: number;
}

/** Ten levels, intended to be about 200 Elo apart; values are calibrated by self-play (docs/TUNING_LOG.md). */
export const LEVELS: LevelDefinition[] = [
  { level: 1, name: 'Novice', limits: { depth: 1 }, noise: 250 },
  { level: 2, name: 'Beginner', limits: { depth: 1 }, noise: 120 },
  { level: 3, name: 'Casual', limits: { depth: 1 }, noise: 80 },
  { level: 4, name: 'Apprentice', limits: { depth: 2 }, noise: 60 },
  { level: 5, name: 'Club', limits: { depth: 2 }, noise: 10 },
  { level: 6, name: 'Strong', limits: { depth: 3, timeMs: 400 }, noise: 20 },
  { level: 7, name: 'Expert', limits: { timeMs: 250 }, noise: 15 },
  { level: 8, name: 'Master', limits: { timeMs: 500 }, noise: 0 },
  { level: 9, name: 'Grandmaster', limits: { timeMs: 1500 }, noise: 0 },
  { level: 10, name: 'Pharaoh', limits: { timeMs: 5000 }, noise: 0 },
];
export const MAX_LEVEL = LEVELS.length;

export function levelOptions(level: number): LevelDefinition['limits'] & Pick<LevelDefinition, 'noise' | 'temperature' | 'blunderDepthCap'> {
  const definition = LEVELS.find(entry => entry.level === level);
  if (!Number.isInteger(level) || !definition) throw new Error(`Level must be between 1 and ${MAX_LEVEL}`);
  return { ...definition.limits, noise: definition.noise ?? 0,
    ...(definition.temperature === undefined ? {} : { temperature: definition.temperature }),
    ...(definition.blunderDepthCap === undefined ? {} : { blunderDepthCap: definition.blunderDepthCap }) };
}
