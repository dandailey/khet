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

/** Initial targets; calibrate these values with self-play. */
export const LEVELS: LevelDefinition[] = [
  { level: 1, name: 'Novice', limits: { depth: 1 }, noise: 150 },
  { level: 2, name: 'Casual', limits: { depth: 2 }, noise: 80 },
  { level: 3, name: 'Club', limits: { timeMs: 250 }, noise: 40 },
  { level: 4, name: 'Expert', limits: { timeMs: 800 }, noise: 0 },
  { level: 5, name: 'Master', limits: { timeMs: 2500 }, noise: 0 },
];

export function levelOptions(level: number): LevelDefinition['limits'] & Pick<LevelDefinition, 'noise' | 'temperature' | 'blunderDepthCap'> {
  const definition = LEVELS.find(entry => entry.level === level);
  if (!Number.isInteger(level) || !definition) throw new Error('Level must be between 1 and 5');
  return { ...definition.limits, noise: definition.noise ?? 0,
    ...(definition.temperature === undefined ? {} : { temperature: definition.temperature }),
    ...(definition.blunderDepthCap === undefined ? {} : { blunderDepthCap: definition.blunderDepthCap }) };
}
