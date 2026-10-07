import { KEIController, runSearchRequest } from './kei.ts';
import type { SearchRequest } from './kei.ts';

// Browser globals here belong exclusively to the Worker scope; no DOM access.
if (typeof globalThis.postMessage === 'function' && typeof globalThis.addEventListener === 'function') {
  const send = (line: string) => globalThis.postMessage(line);
  const controller = new KEIController(send, (request, output, failure) => {
    const worker = new Worker(import.meta.url, { type: 'module' });
    worker.onmessage = event => { if (typeof event.data === 'string') output(event.data); };
    worker.onerror = event => failure(event.message);
    worker.postMessage({ internalSearch: request });
    return { terminate: () => worker.terminate() };
  });
  globalThis.addEventListener('message', (event: MessageEvent<string | { internalSearch: SearchRequest }>) => {
    if (typeof event.data === 'string') {
      controller.handleLine(event.data);
      if (controller.session.quit) globalThis.close();
    } else if (event.data?.internalSearch) {
      runSearchRequest(event.data.internalSearch, send); globalThis.close();
    }
  });
} else {
  const nodeWorkers = 'node:worker_threads';
  const { parentPort, workerData, Worker } = await import(nodeWorkers) as typeof import('node:worker_threads');
  if (parentPort) {
    const send = (line: string) => parentPort.postMessage(line);
    if (workerData?.internalSearch) {
      runSearchRequest(workerData.internalSearch as SearchRequest, send); parentPort.close();
    } else {
      const controller = new KEIController(send, (request, output, failure) => {
        const worker = new Worker(new URL('./worker.ts', import.meta.url), { workerData: { internalSearch: request } });
        worker.on('message', output); worker.on('error', failure);
        return { terminate: () => { void worker.terminate(); } };
      });
      parentPort.on('message', (line: unknown) => {
        if (typeof line !== 'string') return;
        controller.handleLine(line);
        if (controller.session.quit) parentPort.close();
      });
    }
  }
}
