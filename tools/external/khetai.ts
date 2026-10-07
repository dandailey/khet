import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Position, SearchResult } from '../lib/engine.ts';
import { ANUBIS, PHARAOH, PYRAMID, SCARAB, SPHINX } from '../../packages/khet-engine/src/types.ts';

export interface KhetaiOptions { depth: number; timeMs: number }
export interface KhetaiRawMove { start: number; end: number; rotation: number; depth: number }
export const khetaiIndex = (sq: number): number => 13 + Math.floor(sq / 10) * 12 + sq % 10;
export function engineIndex(index: number): number {
  const row = Math.floor(index / 12) - 1, col = index % 12 - 1;
  if (!Number.isInteger(index) || row < 0 || row >= 8 || col < 0 || col >= 10) throw new Error(`Invalid khetai square: ${index}`);
  return row * 10 + col;
}
const letters: Record<number, string> = { [ANUBIS]: 'a', [PYRAMID]: 'p', [SCARAB]: 's', [PHARAOH]: 'x', [SPHINX]: 'l' };
export function boardTokens(pos: Position, padded = true): string[] {
  const board = Array<string>(padded ? 120 : 80).fill('--');
  for (const p of pos.toPieces()) {
    const letter = letters[p.type];
    if (!letter) throw new Error(`Unsupported piece type: ${p.type}`);
    const sq = p.row * 10 + p.col;
    board[padded ? khetaiIndex(sq) : sq] = (p.color === 0 ? letter : letter.toUpperCase()) + p.o;
  }
  return board;
}
const squareText = (sq: number): string => String.fromCharCode(97 + sq % 10) + (8 - Math.floor(sq / 10));
export function ourMove(pos: Position, raw: KhetaiRawMove): string {
  const from = engineIndex(raw.start), to = engineIndex(raw.end);
  if (![0, 1, -1].includes(raw.rotation)) throw new Error('Invalid khetai rotation');
  const pieces = pos.toPieces(), piece = pieces.find(p => p.row * 10 + p.col === from);
  if (raw.rotation) {
    if (from !== to) throw new Error('khetai rotation changes square');
    // Scarab orientations repeat modulo two; our corner Sphinx toggle is always '+'.
    const canonical = piece?.type === SCARAB || piece?.type === SPHINX;
    return squareText(from) + (canonical || raw.rotation === 1 ? '+' : '-');
  }
  const occupied = pieces.some(p => p.row * 10 + p.col === to);
  return squareText(from) + (occupied ? 'x' : '-') + squareText(to);
}

export class KhetaiClient {
  private readonly shared = new SharedArrayBuffer(65536);
  private readonly status = new Int32Array(this.shared, 0, 2);
  private readonly bytes = new Uint8Array(this.shared, 8);
  private readonly worker: Worker;
  private closed = false;
  constructor(binary = fileURLToPath(new URL('../../external/bridge/khetai_cli', import.meta.url))) {
    this.worker = new Worker(new URL('./khetai-worker.ts', import.meta.url), {
      workerData: { shared: this.shared, binary },
      execArgv: process.execArgv.filter(arg => !arg.startsWith('--input-type')),
    });
    this.worker.on('error', () => {}); // Synchronous callers receive a bounded timeout if the IO worker fails.
    this.worker.unref();
  }
  request(line: string, timeoutMs = 10000): string {
    if (this.closed) throw new Error('khetai client is closed');
    if (/[\r\n]/.test(line)) throw new Error('Protocol requests must be one line');
    Atomics.store(this.status, 0, 0);
    this.worker.postMessage(line);
    const wait = Atomics.wait(this.status, 0, 0, timeoutMs);
    if (wait === 'timed-out') { this.worker.postMessage('close'); this.closed = true; throw new Error('khetai CLI timed out'); }
    const response = new TextDecoder().decode(this.bytes.subarray(0, Atomics.load(this.status, 1)));
    if (Atomics.load(this.status, 0) === 2) throw new Error(response);
    return response;
  }
  rawMove(pos: Position, options: KhetaiOptions): KhetaiRawMove {
    if (!Number.isInteger(options.depth) || options.depth < 1 || options.depth > 25 ||
        !Number.isSafeInteger(options.timeMs) || options.timeMs < 1 || options.timeMs > 2147483647) throw new Error('khetai requires depth 1..25 and timeMs 1..2147483647');
    const line = this.request(`go ${pos.side} ${options.depth} ${options.timeMs} ${boardTokens(pos).join(' ')}`, options.timeMs + 10000);
    const match = /^move (\d+) (\d+) (-?\d+) depth (\d+)$/.exec(line);
    if (!match) throw new Error(`Invalid khetai response: ${line}`);
    return { start: +match[1], end: +match[2], rotation: +match[3], depth: +match[4] };
  }
  moveResult(pos: Position, options: KhetaiOptions): SearchResult {
    const raw = this.rawMove(pos, options), move = ourMove(pos, raw);
    return { move, depth: raw.depth, nodes: 0, score: 0, pv: [move] };
  }
  close(): void {
    if (this.closed) return;
    try { this.request('close'); } finally { this.closed = true; }
  }
}
let client: KhetaiClient | undefined;
export function khetaiMoveResult(pos: Position, options: KhetaiOptions): SearchResult {
  try { return (client ??= new KhetaiClient()).moveResult(pos, options); }
  catch (error) { client = undefined; throw error; } // a timed-out client is closed; the next call starts a fresh CLI
}
export function khetaiMove(pos: Position, options: KhetaiOptions): string { return khetaiMoveResult(pos, options).move; }
export function closeKhetai(): void { client?.close(); client = undefined; }
