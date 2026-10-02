// Web Worker: owns the fly so the page stays responsive while it thinks.
//
//   const w = new Worker(new URL("./engine/worker.ts", import.meta.url), { type: "module" });
//   w.postMessage({ type: "load", arm: "real", snapshotUrl: "snapshots/real/h000870000.f32", snapshotHands: 870000 });
//   w.postMessage({ type: "newHand", seed: 42, humanSeat: 1 });
//   w.postMessage({ type: "act", action: 1 });
//   w.postMessage({ type: "raise", to: 750 });
//
// Replies: { type: "progress", loaded, total } (connectome download) | { type: "loaded", ... } | { type: "events", events, frames } | { type: "error", message }.
// frames (when options.frames) are whole-brain activity bytes, one per dynamics step, transferred.

import { BRAIN_PARAMS, Brain, fetchConnectome, type Connectome } from "./connectome";
import { Fly, Session, type GameEvent, type SessionOptions } from "./game";
import { fetchReadout } from "./readout";

export type Arm = "real" | "shuffled" | "nobrain";

export type Request =
  | { type: "load"; arm: Arm; snapshotUrl: string; snapshotHands?: number; connectomeUrl?: string; options?: SessionOptions }
  | { type: "newHand"; seed: number; humanSeat: number }
  | { type: "act"; action: number }
  | { type: "raise"; to: number }; // any legal street total, not only the preset sizes

export type Reply =
  | { type: "progress"; loaded: number; total: number }
  | { type: "loaded"; arm: Arm; neurons: number; readoutDim: number; ms: number }
  | { type: "events"; events: GameEvent[]; frames: ArrayBuffer[]; ms: number }
  | { type: "error"; message: string };

interface WorkerScope {
  postMessage(message: Reply, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Request>) => void) | null;
}
const scope = self as unknown as WorkerScope;

const connectomes = new Map<string, Promise<Connectome>>(); // wiring -> decoded, kept across arm switches
let session: Session | null = null;

async function handle(req: Request): Promise<void> {
  const t0 = performance.now();
  if (req.type === "load") {
    let brain: Brain | null = null;
    if (req.arm !== "nobrain") {
      const url = req.connectomeUrl ?? `data/connectome-${req.arm}.bin`;
      if (!connectomes.has(url)) {
        const progress = (loaded: number, total: number) => scope.postMessage({ type: "progress", loaded, total });
        connectomes.set(url, fetchConnectome(url, progress));
      }
      brain = new Brain(await connectomes.get(url)!, BRAIN_PARAMS);
    }
    const readout = await fetchReadout(req.snapshotUrl);
    session = new Session(new Fly(brain, readout), { ...req.options, snapshotHands: req.snapshotHands });
    scope.postMessage({
      type: "loaded", arm: req.arm, neurons: brain?.c.n ?? 0, readoutDim: readout.dim, ms: performance.now() - t0,
    });
    return;
  }
  if (!session) throw new Error("load a fly first");
  const frames: Uint8Array[] = [];
  const events =
    req.type === "newHand" ? session.newHand(req.seed, req.humanSeat, frames)
    : req.type === "raise" ? session.raiseTo(req.to, frames)
    : session.act(req.action, frames);
  const buffers = frames.map((f) => f.buffer as ArrayBuffer);
  scope.postMessage({ type: "events", events, frames: buffers, ms: performance.now() - t0 }, buffers);
}

// Requests are handled strictly in order, even while a load is still downloading.
let queue: Promise<void> = Promise.resolve();
scope.onmessage = (e) => {
  queue = queue.then(() => handle(e.data)).catch((err: unknown) => {
    scope.postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) });
  });
};
