import { parentPort } from 'node:worker_threads';
import { playGame } from './game.ts';
import type { GameTask } from './game.ts';

if (!parentPort) throw new Error('match-worker must run in a worker thread');
parentPort.on('message', async (tasks: [GameTask, GameTask]) => {
  try {
    for (const task of tasks) parentPort!.postMessage({ kind: 'game', game: await playGame(task) });
    parentPort!.postMessage({ kind: 'pair', pair: tasks[0].pair });
  } catch (error) {
    parentPort!.postMessage({ kind: 'failure', message: error instanceof Error ? error.stack : String(error) });
  }
});
