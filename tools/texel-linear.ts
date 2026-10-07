// Texel tuning for the linear evaluation: score = features . weights.
// Features are computed once per position; the weights are then fitted by Adam on the mean squared error of
// sigmoid(K * score) against the game result (side-to-move perspective), with a held-out validation split.
//
// node tools/texel-linear.ts --data FILE [--out params.json] [--epochs 300] [--lr 0.5] [--l2 0.0001]
//   [--l2-pst 0.002] [--val 0.1] [--fix pyramid,hangingPharaoh] [--max N]
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { DEFAULT_PARAMS, PARAM_NAMES, evaluationFeatures, fromKFEN } from '../packages/khet-engine/src/index.ts';
import { args, fail, isMain, numberArg } from './lib/cli.ts';

const P = PARAM_NAMES.length;

interface Data { x: Float32Array; y: Float32Array; n: number }

async function load(path: string, max: number): Promise<Data> {
  const rows: Float32Array[] = [], ys: number[] = [];
  const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of lines) {
    const tab = line.lastIndexOf('\t');
    if (tab < 0) continue;
    const pos = fromKFEN(line.slice(0, tab));
    rows.push(Float32Array.from(evaluationFeatures(pos)));
    ys.push(Number(line.slice(tab + 1)));
    if (rows.length >= max) break;
  }
  const x = new Float32Array(rows.length * P);
  rows.forEach((row, i) => x.set(row, i * P));
  return { x, y: Float32Array.from(ys), n: rows.length };
}

function scores(d: Data, w: Float64Array, out: Float64Array): void {
  for (let i = 0; i < d.n; i++) {
    let s = 0;
    const base = i * P;
    for (let j = 0; j < P; j++) s += d.x[base + j] * w[j];
    out[i] = s;
  }
}

function mse(d: Data, idx: Int32Array, s: Float64Array, K: number): number {
  let e = 0;
  for (const i of idx) { const p = 1 / (1 + Math.exp(-K * s[i])); e += (p - d.y[i]) ** 2; }
  return e / idx.length;
}

export async function main(): Promise<void> {
  const flags = args();
  if (!flags.data) throw new Error('--data required');
  const epochs = numberArg(flags.epochs, 300, 'epochs'), lr = numberArg(flags.lr, 0.5, 'lr', 0);
  const l2 = numberArg(flags.l2, 0.0001, 'l2', 0), l2pst = numberArg(flags['l2-pst'], 0.002, 'l2-pst', 0);
  const valFrac = numberArg(flags.val, 0.1, 'val', 0);
  const fixed = new Set((flags.fix ?? 'pyramid,hangingPharaoh').split(',').filter(Boolean));
  const d = await load(flags.data, numberArg(flags.max, 1e9, 'max'));
  const w0 = Float64Array.from(DEFAULT_PARAMS.values), w = w0.slice();
  const s = new Float64Array(d.n);
  // Deterministic split: every k-th position is validation.
  const k = valFrac > 0 ? Math.round(1 / valFrac) : 0;
  const train: number[] = [], val: number[] = [];
  for (let i = 0; i < d.n; i++) (k && i % k === 0 ? val : train).push(i);
  const tr = Int32Array.from(train), va = Int32Array.from(val);
  // Fit K on the default weights (golden-section search on training MSE).
  scores(d, w, s);
  let lo = 1e-4, hi = 0.05;
  for (let it = 0; it < 60; it++) {
    const a = hi - (hi - lo) / 1.618, b = lo + (hi - lo) / 1.618;
    if (mse(d, tr, s, a) < mse(d, tr, s, b)) hi = b; else lo = a;
  }
  const K = (lo + hi) / 2;
  const start = { train: mse(d, tr, s, K), val: va.length ? mse(d, va, s, K) : NaN };
  console.error(`positions ${d.n} (train ${tr.length}, val ${va.length}); K ${K.toFixed(6)}; start MSE train ${start.train.toFixed(6)} val ${start.val.toFixed(6)}`);
  // Adam on the weights (fixed weights keep their defaults; PST weights get stronger L2 toward 0).
  const m = new Float64Array(P), v = new Float64Array(P), g = new Float64Array(P);
  const isPst = PARAM_NAMES.map(name => name.startsWith('pst'));
  const free = PARAM_NAMES.map(name => !fixed.has(name));
  let best = { val: Infinity, w: w.slice(), epoch: 0 };
  for (let epoch = 1; epoch <= epochs; epoch++) {
    scores(d, w, s);
    g.fill(0);
    for (const i of tr) {
      const p = 1 / (1 + Math.exp(-K * s[i]));
      const coef = 2 * (p - d.y[i]) * p * (1 - p) * K / tr.length;
      const base = i * P;
      for (let j = 0; j < P; j++) g[j] += coef * d.x[base + j];
    }
    for (let j = 0; j < P; j++) {
      if (!free[j]) continue;
      g[j] += isPst[j] ? 2 * l2pst * w[j] * 1e-4 : 2 * l2 * (w[j] - w0[j]) * 1e-4;
      m[j] = 0.9 * m[j] + 0.1 * g[j];
      v[j] = 0.999 * v[j] + 0.001 * g[j] * g[j];
      const mh = m[j] / (1 - 0.9 ** epoch), vh = v[j] / (1 - 0.999 ** epoch);
      w[j] -= lr * mh / (Math.sqrt(vh) + 1e-12);
    }
    if (epoch % 10 === 0 || epoch === epochs) {
      scores(d, w, s);
      const t = mse(d, tr, s, K), vv = va.length ? mse(d, va, s, K) : t;
      if (vv < best.val) best = { val: vv, w: w.slice(), epoch };
      console.error(`epoch ${epoch}: train ${t.toFixed(6)} val ${vv.toFixed(6)}`);
    }
  }
  const named: Record<string, number> = {};
  PARAM_NAMES.forEach((name, j) => { named[name] = Math.round(best.w[j] * 100) / 100; });
  const report = { K, positions: d.n, start, bestEpoch: best.epoch, bestVal: best.val, params: named };
  if (flags.out) writeFileSync(flags.out, JSON.stringify(report, null, 1) + '\n');
  const scalars = PARAM_NAMES.filter(name => !name.startsWith('pst')).map(name => `${name}=${named[name]}`);
  console.log(`best epoch ${best.epoch} val MSE ${best.val.toFixed(6)} (start ${start.val.toFixed(6)})\n${scalars.join(' ')}`);
}
if (isMain(import.meta.url)) main().catch(fail);
