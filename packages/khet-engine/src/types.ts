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
export interface SearchOptions { level?: number; timeMs?: number; depth?: number; seed?: number }
export interface SearchResult { move: string; score: number; depth: number; nodes: number; pv: string[] }
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
