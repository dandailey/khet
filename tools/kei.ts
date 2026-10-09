import { createInterface } from 'node:readline';
import { Worker } from 'node:worker_threads';
import { KEIController } from '../packages/khet-engine/src/kei.ts';
export { KEISession } from '../packages/khet-engine/src/kei.ts';

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const controller = new KEIController(line => process.stdout.write(line + '\n'), (request, output, failure) => {
    const worker = new Worker(new URL('../packages/khet-engine/src/worker.ts', import.meta.url), { workerData: { internalSearch: request } });
    worker.on('message', output); worker.on('error', failure);
    return { terminate: () => { void worker.terminate(); } };
  });
  const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
  input.on('line', line => {
    controller.handleLine(line);
    if (controller.session.quit) { input.close(); process.stdin.pause(); }
  });
}
