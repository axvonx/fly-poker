// The public page: play heads-up against the fly. Everything runs in the browser: the engine
// (a Web Worker) holds the frozen connectome and the trained readout; this file only paces
// its events onto the table, the brain view and the bar.

import "@fontsource/ibm-plex-sans-condensed/500.css";
import "@fontsource/ibm-plex-sans-condensed/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "../style.css";
import "./play.css";

import { BrainView } from "../brain";
import { gunzip, isGzip } from "../engine/connectome";
import { DECK } from "../engine/poker";
import { winChance } from "../hands";
import type { GameEvent } from "../engine/game";
import type { Reply, Request } from "../engine/worker";
import { Bar } from "./bar";
import { Chart, type TrainingSeries } from "./chart";
import { buildHowTo } from "./howto";
import { signedDollars } from "./money";
import { PlayTable } from "./table";
import { renderThoughts, type FlyThought } from "./thoughts";

const $ = (id: string) => document.getElementById(id)!;
const url = (path: string) => new URL(path, document.baseURI).href; // the worker resolves URLs against its own script
const FRAME_MS = 90; // one brain timestep on screen
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const STREET_OF_BOARD: Record<number, number> = { 0: 0, 3: 1, 4: 2, 5: 3 };

interface Manifest {
  arms: Record<string, { dim: number; snapshots: { hands: number; file: string }[] }>;
}

// ── the engine, as request → reply ───────────────────────────────────────────
const worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
const waiting: ((r: Reply) => void)[] = [];
let onProgress: (loaded: number, total: number) => void = () => {};
worker.onmessage = (e: MessageEvent<Reply>) => {
  if (e.data.type === "progress") onProgress(e.data.loaded, e.data.total);
  else waiting.shift()?.(e.data);
};
worker.onerror = (e) => fail(e.message || "The fly's engine failed to start.");
function call(req: Request): Promise<Reply> {
  return new Promise((resolve, reject) => {
    waiting.push((r) => (r.type === "error" ? reject(new Error(r.message)) : resolve(r)));
    worker.postMessage(req);
  });
}

function fail(message: string): void {
  $("loading").hidden = false;
  $("loading").classList.add("is-error");
  $("loading-text").textContent = `Something went wrong: ${message}`;
}

async function fetchBytes(path: string): Promise<Uint8Array> {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  return isGzip(bytes) ? gunzip(bytes) : bytes;
}
const fetchJson = async <T>(path: string): Promise<T> => {
  const res = await fetch(url(path));
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

async function boot(): Promise<void> {
  // Card faces are drawn onto canvases, so the faces must be loaded before the first deal.
  const fonts = Promise.all([
    document.fonts.load('700 92px "IBM Plex Sans Condensed"'),
    document.fonts.load('700 120px "IBM Plex Sans"'),
  ]);
  const [manifest, training, site, packed] = await Promise.all([
    fetchJson<Manifest>("snapshots/manifest.json"),
    fetchJson<TrainingSeries>("snapshots/training.json"),
    fetchJson<{ neurons: number; readout: number[] }>("data/site.json"),
    fetchJson<{ file_bytes: number }>("data/connectome-real.json"),
  ]);
  const snapshots = manifest.arms.real.snapshots;

  // The brain view starts while the connectome downloads: it only needs positions.
  const neurons = await fetchBytes("data/neurons.bin");
  const xyz = new Float32Array(neurons.buffer, neurons.byteOffset, site.neurons * 3);
  $("specimen-meta").textContent = `${site.neurons.toLocaleString()} neurons`;
  const scale = () => {
    ($("scalebar").querySelector(".scalebar__bar") as HTMLElement).style.width = `${100 / brain.umPerPixel()}px`;
  };
  const brain = new BrainView($("brain") as HTMLCanvasElement, xyz, site.readout, () => scale());
  await fonts;
  const table = new PlayTable($("table") as HTMLCanvasElement, $("tags"));
  const chart = new Chart(training);
  table.onHand = (h, hole, board) => bar.hand(h, winChance(hole, board, DECK));

  // ── how to play ──
  buildHowTo($("ranks"));
  const sheet = $("how-sheet") as HTMLDialogElement;
  $("how").addEventListener("click", () => sheet.showModal());
  sheet.addEventListener("click", (e) => e.target === sheet && sheet.close()); // click outside to close

  // ── the lens ──
  const lens = $("lens");
  const setLens = (on: boolean) => {
    table.setLens(on);
    lens.setAttribute("aria-pressed", String(on));
  };
  lens.addEventListener("click", () => setLens(lens.getAttribute("aria-pressed") !== "true"));
  addEventListener("keydown", (e) => {
    if ((e.key === "f" || e.key === "F") && !(e.target instanceof HTMLInputElement)) setLens(lens.getAttribute("aria-pressed") !== "true");
  });

  // ── score ──
  let total = 0, played = 0;
  const showScore = () => {
    $("score-value").textContent = played ? signedDollars(total) : "$0";
    $("score-value").dataset.sign = total > 0 ? "up" : total < 0 ? "down" : "";
    $("score-detail").textContent = played ? `${played} hand${played === 1 ? "" : "s"}` : "";
  };
  showScore();

  // ── playing ──
  let generation = 0; // bumped when a different fly is picked: an abandoned hand stops animating
  let handNo = 0;
  let thoughts: FlyThought[] = [];
  let street = 0;

  const play = async (reply: Reply, g: number) => {
    if (reply.type !== "events") return;
    const frames = reply.frames.map((b) => new Uint8Array(b));
    const decisions = reply.events.filter((e) => e.type === "thinking").length;
    const perDecision = decisions ? frames.length / decisions : 0;
    let next = 0;
    let pending: { street: number } | null = null;
    for (const e of reply.events as GameEvent[]) {
      if (g !== generation) return;
      if (e.type === "board") street = STREET_OF_BOARD[e.cards.length] ?? street;
      if (e.type === "thinking") {
        bar.wait();
        await table.handle(e);
        pending = { street };
        for (let k = 0; k < perDecision && g === generation; k++, next++) {
          const f = frames[next];
          brain.frame(f);
          let sum = 0;
          for (let i = 0; i < f.length; i += 7) sum += f[i];
          table.thinking(Math.min(1, sum / (f.length / 7) / 60));
          await new Promise((r) => setTimeout(r, FRAME_MS));
        }
        continue;
      }
      if (e.type === "decision") {
        brain.rest();
        thoughts.push({ street: pending?.street ?? street, action: e.action, probs: e.probs });
        await table.handle(e);
        continue;
      }
      if (e.type === "turn") {
        await table.handle(e);
        if (g === generation) bar.turn(e.obs, e.amounts);
        continue;
      }
      if (e.type === "result") {
        bar.wait();
        await table.handle(e);
        if (g !== generation) return;
        total += Math.round(e.human_bb * 100);
        played++;
        showScore();
        renderThoughts(table.bubble, thoughts);
        table.bubble.hidden = false;
        bar.done();
        continue;
      }
      await table.handle(e);
    }
  };

  const deal = async () => {
    const g = generation;
    thoughts = [];
    street = 0;
    bar.wait();
    bar.hand(null, null);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    const reply = await call({ type: "newHand", seed, humanSeat: handNo++ % 2 });
    await play(reply, g);
  };

  const bar = new Bar(
    async (action) => {
      const g = generation;
      await play(await call({ type: "act", action }), g);
    },
    () => void deal(),
  );

  // ── which fly ──
  const slider = $("practice") as HTMLInputElement;
  slider.max = String(snapshots.length - 1);
  slider.value = slider.max;
  const showPick = () => {
    const s = snapshots[Number(slider.value)];
    $("practice-hands").textContent = `${short(s.hands)} hands`;
    chart.mark(s.hands);
  };
  const load = async (onDownload?: (loaded: number, total: number) => void) => {
    const s = snapshots[Number(slider.value)];
    if (onDownload) onProgress = onDownload;
    await call({
      type: "load", arm: "real", snapshotUrl: url(`snapshots/${s.file}`), snapshotHands: s.hands,
      connectomeUrl: url("data/connectome-real.bin"), options: { frames: true },
    });
    onProgress = () => {};
  };
  slider.addEventListener("input", showPick);
  slider.addEventListener("change", async () => {
    generation++;
    table.reset();
    brain.rest();
    bar.wait();
    bar.hand(null, null);
    await load();
    void deal();
  });
  showPick();

  // ── first load: the connectome (~16 MB) ──
  const mb = (b: number) => (b / 1e6).toFixed(1);
  bar.wait();
  await load((loaded, size) => {
    const t = size || packed.file_bytes;
    $("loading-text").textContent = `Loading the fly's brain… ${mb(loaded)} / ${mb(t)} MB`;
    ($("loading-fill") as HTMLElement).style.transform = `scaleX(${Math.min(1, loaded / t)})`;
  });
  $("loading").hidden = true;
  await deal();
}

boot().catch((err: unknown) => {
  console.error(err);
  fail(err instanceof Error ? err.message : String(err));
});
