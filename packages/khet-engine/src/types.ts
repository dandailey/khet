export const SILVER = 0, RED = 1;
export const N = 0, E = 1, S = 2, W = 3;
export const PHARAOH = 1, SPHINX = 2, PYRAMID = 3, SCARAB = 4, ANUBIS = 5;
export const STEP = 0, SWAP = 1, ROT_CW = 2, ROT_CCW = 3;
export const BOARD_SIZE = 80, MAX_MOVES = 800;
export type Color = 0 | 1;
export type Result = Color | 'draw' | null;
export interface Piece { type: number; color: Color; o: number }
export interface PlacedPiece extends Piece { row: number; col: number }
export interface LaserResult { path: number[]; hit: number; hitType: number | null }
export interface SearchOptions {
  level?: number; timeMs?: number; depth?: number; nodes?: number; seed?: number;
  params?: import('./eval.ts').EvalParams | Record<string, number>;
  tt?: boolean; ttSize?: number;
  nullMove?: boolean; lmr?: boolean; qsearch?: boolean; threatExtension?: boolean;
  qDepth?: number;
  /** Standard deviation of fixed seeded root-only score noise; default zero. */
  rootNoise?: number;
  /** Score every root move with a full window in each completed iteration. */
  rootScores?: boolean;
  /** Expensive one-move victim evaluation; default on, for self-play ablation. */
  hangingPieces?: boolean;
  /** Shared flag allows stop from another worker while synchronous search runs. */
  stop?: Int32Array;
  onIteration?: (result: SearchResult) => void;
}
export interface RootScore { move: string; score: number }
export interface SearchResult { move: string; score: number; depth: number; nodes: number; pv: string[]; timeMs: number; rootScores?: RootScore[] }
export function opposite(d: number): number { return (d + 2) & 3; }
export function encodePiece(type: number, color: Color, o: number): number {
  return type | (color << 3) | (o << 4);
}
export function pieceType(p: number): number { return p & 7; }
export function pieceColor(p: number): Color { return ((p >> 3) & 1) as Color; }
export function orientation(p: number): number { return p >> 4; }
export function encodeMove(from: number, to: number, kind: number): number {
  return from | (to << 7) | (kind << 14);
}
