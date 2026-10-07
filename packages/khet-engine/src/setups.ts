import { ANUBIS, PHARAOH, PYRAMID, RED, SCARAB, SILVER, SPHINX } from './types.ts';
import type { PlacedPiece } from './types.ts';
// Literal contract coordinates, including both colors rather than inferred symmetry.
export const SETUPS: { classic: readonly PlacedPiece[] } = {
  classic: [
    {row:0,col:0,type:SPHINX,color:RED,o:2},
    {row:0,col:4,type:ANUBIS,color:RED,o:2},
    {row:0,col:5,type:PHARAOH,color:RED,o:0},
    {row:0,col:6,type:ANUBIS,color:RED,o:2},
    {row:0,col:7,type:PYRAMID,color:RED,o:1},
    {row:1,col:2,type:PYRAMID,color:RED,o:2},
    {row:2,col:3,type:PYRAMID,color:SILVER,o:3},
    {row:3,col:0,type:PYRAMID,color:RED,o:0},
    {row:3,col:2,type:PYRAMID,color:SILVER,o:2},
    {row:3,col:4,type:SCARAB,color:RED,o:1},
    {row:3,col:5,type:SCARAB,color:RED,o:0},
    {row:3,col:7,type:PYRAMID,color:RED,o:1},
    {row:3,col:9,type:PYRAMID,color:SILVER,o:3},
    {row:4,col:0,type:PYRAMID,color:RED,o:1},
    {row:4,col:2,type:PYRAMID,color:SILVER,o:3},
    {row:4,col:4,type:SCARAB,color:SILVER,o:0},
    {row:4,col:5,type:SCARAB,color:SILVER,o:1},
    {row:4,col:7,type:PYRAMID,color:RED,o:0},
    {row:4,col:9,type:PYRAMID,color:SILVER,o:2},
    {row:5,col:6,type:PYRAMID,color:RED,o:1},
    {row:6,col:7,type:PYRAMID,color:SILVER,o:0},
    {row:7,col:2,type:PYRAMID,color:SILVER,o:3},
    {row:7,col:3,type:ANUBIS,color:SILVER,o:0},
    {row:7,col:4,type:PHARAOH,color:SILVER,o:0},
    {row:7,col:5,type:ANUBIS,color:SILVER,o:0},
    {row:7,col:9,type:SPHINX,color:SILVER,o:0},
  ],
};
