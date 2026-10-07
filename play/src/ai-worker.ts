import { createKEIEngine } from './worker-logic.ts';

const handle = createKEIEngine(line => globalThis.postMessage(line));
globalThis.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (typeof event.data === 'string') handle(event.data);
});
