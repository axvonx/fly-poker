// The frozen connectome as a rate-based reservoir, a port of flypoker/brain.py:
//
//     r <- (1 - alpha) r + alpha * relu(gain * W r + E u)
//
// W is the signed MaleCNS connectome with each neuron's inputs normalised to unit total weight.
// The packed file (tools/pack_connectome.py) holds whole synapse counts; normalising them here in
// float32 reproduces the Python matrix exactly. The multiply accumulates in float64, so states
// differ from the reference only at float32 rounding level (as the Python mps kernel does).

/** BrainConfig defaults in flypoker/brain.py, as frozen in every run's config.json. */
export interface BrainParams {
  gain: number;
  alpha: number;
  inputGain: number;
  steps: number;
}
export const BRAIN_PARAMS: BrainParams = { gain: 0.95, alpha: 0.5, inputGain: 1.0, steps: 8 };

export interface Connectome {
  n: number;
  nnz: number;
  rowptr: Int32Array;
  cols: Int32Array;
  data: Float32Array; // normalised weights
  sensory: Int32Array;
  descending: Int32Array;
  groups: Uint8Array; // input feature of each sensory neuron
  nFeatures: number;
}

const MAGIC = 0x43594c46; // "FLYC" little-endian

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Fetch and decode a packed connectome. Handles the file being served gzipped or not. */
export async function fetchConnectome(url: string): Promise<Connectome> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  let bytes: Uint8Array = new Uint8Array(await res.arrayBuffer());
  if (isGzip(bytes)) bytes = await gunzip(bytes);
  return parseConnectome(bytes);
}

/** Decode an (uncompressed) packed connectome. */
export function parseConnectome(bytes: Uint8Array): Connectome {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u32 = (k: number) => view.getUint32(4 * k, true);
  if (u32(0) !== MAGIC) throw new Error("not a packed connectome");
  if (u32(1) !== 1) throw new Error(`unsupported connectome version ${u32(1)}`);
  const n = u32(2);
  const nnz = u32(3);
  const nSensory = u32(4);
  const nDesc = u32(5);
  const nFeatures = u32(6);
  const varintBytes = u32(8);
  let off = 36;
  // Copy each section into its own buffer, so typed-array alignment never depends on the input.
  const take = (len: number) => {
    const out = new Uint8Array(bytes.subarray(off, off + len)); // a copy (Buffer.slice would not be)
    off += len;
    return out.buffer;
  };
  const rowptr = new Int32Array(take(4 * (n + 1)));
  const sensory = new Int32Array(take(4 * nSensory));
  const descending = new Int32Array(take(4 * nDesc));
  const counts = new Int16Array(take(2 * nnz));
  const groups = new Uint8Array(take(nSensory));
  const varints = bytes.subarray(off, off + varintBytes);

  const cols = new Int32Array(nnz);
  let p = 0;
  for (let i = 0; i < n; i++) {
    let prev = 0;
    for (let k = rowptr[i], first = true; k < rowptr[i + 1]; k++, first = false) {
      let v = 0;
      let shift = 0;
      let b: number;
      do {
        b = varints[p++];
        v |= (b & 0x7f) << shift;
        shift += 7;
      } while (b & 0x80);
      prev = first ? v : prev + v;
      cols[k] = prev;
    }
  }
  if (p !== varintBytes) throw new Error("corrupt connectome column data");

  // Each neuron's inputs normalised to unit total |weight|, in float32 as numpy does.
  const data = new Float32Array(nnz);
  for (let i = 0; i < n; i++) {
    let total = 0;
    for (let k = rowptr[i]; k < rowptr[i + 1]; k++) total += Math.abs(counts[k]);
    const scale = Math.fround(1 / (total || 1));
    for (let k = rowptr[i]; k < rowptr[i + 1]; k++) data[k] = counts[k] * scale;
  }
  return { n, nnz, rowptr, cols, data, sensory, descending, groups, nFeatures };
}

export class Brain {
  readonly c: Connectome;
  readonly params: BrainParams;
  r: Float32Array;
  private next: Float32Array;
  private drive: Float32Array;

  constructor(c: Connectome, params: BrainParams = BRAIN_PARAMS) {
    this.c = c;
    this.params = params;
    this.r = new Float32Array(c.n);
    this.next = new Float32Array(c.n);
    this.drive = new Float32Array(c.n);
  }

  /** A silent brain: every hand starts here. */
  reset(): void {
    this.r.fill(0);
  }

  /** Advance `steps` dynamics steps under input features u; onStep sees the state after each. */
  run(u: Float32Array, onStep?: (r: Float32Array, step: number) => void): void {
    const { rowptr, cols, data, sensory, groups, n } = this.c;
    const { gain, alpha, inputGain, steps } = this.params;
    const drive = this.drive;
    for (let k = 0; k < sensory.length; k++) drive[sensory[k]] = inputGain * u[groups[k]];
    for (let s = 0; s < steps; s++) {
      const r = this.r;
      const next = this.next;
      for (let i = 0; i < n; i++) {
        let acc = 0;
        const end = rowptr[i + 1];
        for (let k = rowptr[i]; k < end; k++) acc += data[k] * r[cols[k]];
        let x = gain * acc + drive[i];
        if (x < 0) x = 0;
        next[i] = (1 - alpha) * r[i] + alpha * x;
      }
      this.next = r;
      this.r = next;
      onStep?.(next, s + 1);
    }
  }

  /** Descending-neuron rates: what the readout listens to. */
  readout(): Float32Array {
    const d = this.c.descending;
    const out = new Float32Array(d.length);
    for (let k = 0; k < d.length; k++) out[k] = this.r[d[k]];
    return out;
  }
}

/** Whole-brain activity as bytes, as flypoker/exhibit.py's activity_bytes does for the display. */
const ACTIVITY_K = 1000;
const ACTIVITY_SCALE = 255 / Math.log1p(ACTIVITY_K);
export function activityBytes(r: Float32Array, out = new Uint8Array(r.length)): Uint8Array {
  for (let i = 0; i < r.length; i++) {
    const v = Math.log1p(ACTIVITY_K * Math.max(r[i], 0)) * ACTIVITY_SCALE;
    out[i] = v > 255 ? 255 : v; // Uint8Array truncates, like numpy's astype(uint8)
  }
  return out;
}
