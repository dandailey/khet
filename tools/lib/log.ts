import { open, readFile, truncate } from 'node:fs/promises';
import { writeSync, fsyncSync } from 'node:fs';

export async function readLog<T>(path: string): Promise<T[]> {
  let text: string;
  try { text = await readFile(path, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  // A crash can interrupt the last write. Only a trailing incomplete line is discarded.
  if (text && !text.endsWith('\n')) {
    const end = text.lastIndexOf('\n') + 1;
    await truncate(path, Buffer.byteLength(text.slice(0, end)));
    text = text.slice(0, end);
  }
  return text.split('\n').filter(Boolean).map((line, i) => {
    try { return JSON.parse(line) as T; } catch { throw new Error(`Corrupt log at line ${i + 1}`); }
  });
}
export async function jsonLogger(path: string, durable = false) {
  const file = await open(path, 'a');
  return {
    write(value: unknown) { writeSync(file.fd, JSON.stringify(value) + '\n'); if (durable) fsyncSync(file.fd); },
    close() { return file.close(); },
  };
}
