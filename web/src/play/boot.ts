// Everything a view needs before the first hand, fetched once.

import { gunzip, isGzip } from "../engine/connectome";
import type { TrainingSeries } from "./chart";
import { url, type Snapshot } from "./controller";

export interface BootData {
  snapshots: Snapshot[];
  training: TrainingSeries;
  site: { neurons: number; readout: number[] };
  packed: { file_bytes: number }; // the connectome's size, for progress when Content-Length is missing
  xyz: Float32Array; // neuron positions, for the brain view
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return isGzip(bytes) ? gunzip(bytes) : bytes;
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export async function bootData(): Promise<BootData> {
  const [manifest, training, site, packed, neurons] = await Promise.all([
    fetchJson<{ arms: Record<string, { snapshots: Snapshot[] }> }>("snapshots/manifest.json"),
    fetchJson<TrainingSeries>("snapshots/training.json"),
    fetchJson<BootData["site"]>("data/site.json"),
    fetchJson<BootData["packed"]>("data/connectome-real.json"),
    fetchBytes("data/neurons.bin"),
  ]);
  const xyz = new Float32Array(neurons.buffer, neurons.byteOffset, site.neurons * 3);
  return { snapshots: manifest.arms.real.snapshots, training, site, packed, xyz };
}
