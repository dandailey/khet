import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function args(argv = process.argv.slice(2)): Record<string, string> {
  const result: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (!flag.startsWith('--')) throw new Error(`Expected a --flag, got ${flag}`);
    const key = flag.slice(2);
    if (key in result) throw new Error(`Duplicate flag ${flag}`);
    result[key] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  }
  return result;
}

export function numberArg(value: string | undefined, fallback: number, name: string, min = 1): number {
  const n = value === undefined ? fallback : Number(value);
  if (!Number.isFinite(n) || n < min) throw new Error(`${name} must be finite and >= ${min}`);
  return n;
}

export function integer(value: number, name: string, min = 1): number {
  if (!Number.isSafeInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
  return value;
}

export async function jsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export function isMain(url: string): boolean {
  return !!process.argv[1] && pathToFileURL(process.argv[1]).href === url;
}

export function fail(error: unknown): void {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
