import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { parentPort, workerData } from 'node:worker_threads';

// This worker owns asynchronous pipe IO, allowing the public adapter to return a string synchronously.
const shared = workerData.shared as SharedArrayBuffer;
const status = new Int32Array(shared, 0, 2);
const bytes = new Uint8Array(shared, 8);
const child = spawn(workerData.binary as string, [], { stdio: ['pipe', 'pipe', 'pipe'] });
let pending = false, fatal = '', stderr = '';
function respond(text: string, error = false): void {
  const encoded = new TextEncoder().encode(text);
  if (encoded.length > bytes.length) { respond('CLI response exceeds mailbox size', true); return; }
  bytes.set(encoded); Atomics.store(status, 1, encoded.length);
  pending = false;
  Atomics.store(status, 0, error ? 2 : 1); Atomics.notify(status, 0);
}
function fail(message: string): void {
  fatal = message;
  if (pending) respond(message, true);
}
child.on('error', error => fail(`Cannot start khetai CLI: ${error.message}. Run bash tools/external/build-khetai.sh`));
child.on('exit', (code, signal) => fail(`khetai CLI exited (${code ?? signal}): ${stderr}`));
child.stdin.on('error', error => fail(`khetai stdin: ${error.message}`));
child.stderr.on('data', data => { stderr = (stderr + String(data)).slice(-4096); });
createInterface({ input: child.stdout }).on('line', line => {
  if (!pending) { fail('Unexpected unsolicited CLI response'); return; }
  respond(line, line.startsWith('error '));
});
parentPort!.on('message', (request: string) => {
  if (request === 'close') {
    child.stdin.end(); child.kill(); respond('closed'); parentPort!.close(); return;
  }
  pending = true;
  if (fatal) { respond(fatal, true); return; }
  child.stdin.write(request + '\n');
});
