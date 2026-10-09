export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let x = Math.imul(state ^ (state >>> 15), state | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedFor(seed: number, ...ids: number[]): number {
  let x = seed >>> 0;
  for (const id of ids) x = Math.imul(x ^ id, 0x45d9f3b) >>> 0;
  return x;
}
