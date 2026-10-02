// The fly's only trained parameters: a softmax over the 5 actions from normalised
// descending-neuron rates (or, for the no-brain control, from the raw features).
// Port of Readout in flypoker/agent.py. Snapshot files come from tools/export_snapshots.py.

import { N_ACTIONS } from "./poker";

export const Z_CLIP = 5; // normalised inputs are clipped: rare-firing neurons make heavy tails

export interface Readout {
  dim: number;
  W: Float32Array; // dim x N_ACTIONS, row-major
  b: Float32Array;
  mu: Float32Array;
  sd: Float32Array;
}

/** A .f32 snapshot: W (dim x 5), b (5), mu (dim), sd (dim), little-endian float32. */
export function parseReadout(buf: ArrayBuffer): Readout {
  const all = new Float32Array(buf.slice(0));
  const dim = (all.length - N_ACTIONS) / (N_ACTIONS + 2);
  if (!Number.isInteger(dim)) throw new Error("not a readout snapshot");
  let o = 0;
  const take = (len: number) => all.subarray(o, (o += len));
  return { dim, W: take(dim * N_ACTIONS), b: take(N_ACTIONS), mu: take(dim), sd: take(dim) };
}

export async function fetchReadout(url: string): Promise<Readout> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return parseReadout(await res.arrayBuffer());
}

export function normalise(ro: Readout, x: Float32Array): Float32Array {
  const z = new Float32Array(ro.dim);
  for (let i = 0; i < ro.dim; i++) {
    const v = (x[i] - ro.mu[i]) / ro.sd[i];
    z[i] = v < -Z_CLIP ? -Z_CLIP : v > Z_CLIP ? Z_CLIP : v;
  }
  return z;
}

/** Action probabilities from normalised inputs z; illegal actions get probability 0. */
export function probs(ro: Readout, z: Float32Array, legal: boolean[]): number[] {
  const logits = Array.from(ro.b, (b) => b as number);
  for (let i = 0; i < ro.dim; i++) {
    const zi = z[i];
    if (zi === 0) continue;
    for (let a = 0; a < N_ACTIONS; a++) logits[a] += zi * ro.W[i * N_ACTIONS + a];
  }
  let max = -Infinity;
  for (let a = 0; a < N_ACTIONS; a++) if (legal[a] && logits[a] > max) max = logits[a];
  const p = logits.map((l, a) => (legal[a] ? Math.exp(l - max) : 0));
  const sum = p.reduce((s, v) => s + v, 0);
  return p.map((v) => v / sum);
}
