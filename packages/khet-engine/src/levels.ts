import type { SearchOptions } from './types.ts';

export interface LevelDefinition {
  level: number;
  name: string;
  limits: Pick<SearchOptions, 'depth' | 'nodes' | 'timeMs'>;
  temperature: number;
  blunderDepthCap?: number;
}

/** Initial targets; calibrate these values with self-play. */
export const LEVELS: LevelDefinition[] = [
  { level: 1, name: 'Novice', limits: { depth: 1 }, temperature: 120 },
  { level: 2, name: 'Casual', limits: { depth: 2 }, temperature: 60 },
  { level: 3, name: 'Club', limits: { timeMs: 300, depth: 4 }, temperature: 20 },
  { level: 4, name: 'Expert', limits: { timeMs: 1000 }, temperature: 0 },
  { level: 5, name: 'Master', limits: { timeMs: 3000 }, temperature: 0 },
];

export function levelOptions(level: number): LevelDefinition['limits'] & Pick<LevelDefinition, 'temperature' | 'blunderDepthCap'> {
  const definition = LEVELS.find(entry => entry.level === level);
  if (!Number.isInteger(level) || !definition) throw new Error('Level must be between 1 and 5');
  return { ...definition.limits, temperature: definition.temperature,
    ...(definition.blunderDepthCap === undefined ? {} : { blunderDepthCap: definition.blunderDepthCap }) };
}
