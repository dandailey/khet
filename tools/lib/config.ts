import type { Params, SearchOptions } from './engine.ts';
import { integer, jsonFile } from './cli.ts';

export interface PlayerConfig {
  label: string;
  player?: 'engine' | 'random' | 'greedy';
  nodes?: number; depth?: number; timeMs?: number;
  params?: Params;
  toggles?: Record<string, boolean | number>;
  options?: SearchOptions;
}

export function searchOptions(config: PlayerConfig): SearchOptions {
  const { nodes, depth, timeMs, params, toggles, options } = config;
  return { ...toggles, ...options,
    ...(nodes === undefined ? {} : { nodes }), ...(depth === undefined ? {} : { depth }),
    ...(timeMs === undefined ? {} : { timeMs }), ...(params === undefined ? {} : { params }) };
}

export function validateConfig(config: PlayerConfig): PlayerConfig {
  if (!config || typeof config.label !== 'string' || !config.label.trim()) throw new Error('Config requires a nonempty label');
  if (config.player !== undefined && !['engine', 'random', 'greedy'].includes(config.player)) throw new Error('Unknown player type');
  const opts = searchOptions(config);
  if (opts.level !== undefined && (!Number.isInteger(opts.level) || opts.level < 1 || opts.level > 5)) throw new Error('Level must be between 1 and 5');
  if (opts.level === undefined && ![opts.nodes, opts.depth, opts.timeMs].some(v => v !== undefined)) throw new Error(`${config.label}: specify nodes, depth or timeMs`);
  for (const limit of ['nodes', 'depth', 'timeMs'] as const) if (opts[limit] !== undefined) integer(opts[limit]!, limit);
  if (opts.params && (typeof opts.params !== 'object' || Object.values(opts.params).some(v => typeof v !== 'number' || !Number.isFinite(v)))) throw new Error('Params must be finite numbers keyed by name');
  return config;
}
export async function readConfig(path: string): Promise<PlayerConfig> { return validateConfig(await jsonFile<PlayerConfig>(path)); }
