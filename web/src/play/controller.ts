// The game, without a page: talks to the engine (a Web Worker), deals, paces the fly's thinking
// onto the brain, keeps score, and hands everything to a view. Desktop and mobile are two views
// of this one controller (play/desktop.ts, play/mobile/view.ts).

import type { GameEvent, RaiseRange } from "../engine/game";
import type { Obs } from "../engine/poker";
import type { Reply, Request } from "../engine/worker";
import type { PlayTable } from "./table";
import type { FlyThought } from "./thoughts";

const FRAME_MS = 90; // one brain timestep on screen
const STREET_OF_BOARD: Record<number, number> = { 0: 0, 3: 1, 4: 2, 5: 3 };
export const url = (path: string) => new URL(path, document.baseURI).href; // the worker resolves URLs against its own script

export interface Snapshot {
  hands: number;
  file: string;
}

/** What a page must provide for the controller to play on it. */
export interface PlayView {
  table: PlayTable;
  brainFrame(activity: Uint8Array, level: number): void; // one dynamics step while the fly thinks
  brainRest(): void;
  turn(o: Obs, amounts: number[], raise: RaiseRange | null): void; // your move: what's legal, what it costs, how much you may raise to
  wait(): void; // not your move
  done(thoughts: FlyThought[]): void; // the hand is over: show the fly's thinking and "Next hand"
  hand(hole: string[], board: string[]): void; // your best hand changed
  score(totalChips: number, played: number): void;
  progress(loaded: number, total: number): void; // first connectome download
  loaded(): void;
  fail(message: string): void;
}

export class PlayController {
  private worker = new Worker(new URL("../engine/worker.ts", import.meta.url), { type: "module" });
  private waiting: ((r: Reply) => void)[] = [];
  private onProgress: (loaded: number, total: number) => void = () => {};
  private generation = 0; // bumped when a different fly is picked: an abandoned hand stops animating
  private handNo = 0;
  private thoughts: FlyThought[] = [];
  private street = 0;
  private total = 0;
  private played = 0;
  private picked: number;

  constructor(private view: PlayView, readonly snapshots: Snapshot[]) {
    this.picked = snapshots.length - 1;
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      if (e.data.type === "progress") this.onProgress(e.data.loaded, e.data.total);
      else this.waiting.shift()?.(e.data);
    };
    this.worker.onerror = (e) => view.fail(e.message || "The fly's engine failed to start.");
    view.table.onHand = (_h, hole, board) => view.hand(hole, board);
    view.score(0, 0);
  }

  get pick(): number {
    return this.picked;
  }

  /** First load (the ~16 MB connectome, with progress), then the first hand. */
  async start(): Promise<void> {
    this.view.wait();
    this.onProgress = (loaded, total) => this.view.progress(loaded, total);
    await this.load();
    this.onProgress = () => {};
    this.view.loaded();
    await this.deal();
  }

  /** Play a different snapshot of the fly. Only the latest pick deals a hand. */
  async choose(index: number): Promise<void> {
    const g = ++this.generation;
    this.picked = index;
    this.view.table.reset();
    this.view.brainRest();
    this.view.wait();
    this.view.hand([], []);
    await this.load();
    if (g === this.generation) void this.deal();
  }

  /** You act (index into ACTIONS). */
  act(action: number): void {
    this.send({ type: "act", action });
  }

  /** You raise to a street total (in chips). */
  raise(to: number): void {
    this.send({ type: "raise", to });
  }

  next(): void {
    void this.deal();
  }

  private send(req: Request): void {
    const g = this.generation;
    this.call(req).then((r) => this.play(r, g)).catch((err: unknown) => this.fail(err));
  }

  private call(req: Request): Promise<Reply> {
    return new Promise((resolve, reject) => {
      this.waiting.push((r) => (r.type === "error" ? reject(new Error(r.message)) : resolve(r)));
      this.worker.postMessage(req);
    });
  }

  private fail(err: unknown): void {
    this.view.fail(err instanceof Error ? err.message : String(err));
  }

  private async load(): Promise<void> {
    const s = this.snapshots[this.picked];
    await this.call({
      type: "load", arm: "real", snapshotUrl: url(`snapshots/${s.file}`), snapshotHands: s.hands,
      connectomeUrl: url("data/connectome-real.bin"), options: { frames: true },
    });
  }

  private async deal(): Promise<void> {
    const g = this.generation;
    this.thoughts = [];
    this.street = 0;
    this.view.wait();
    this.view.hand([], []);
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    try {
      const reply = await this.call({ type: "newHand", seed, humanSeat: this.handNo++ % 2 });
      await this.play(reply, g);
    } catch (err) {
      this.fail(err);
    }
  }

  private async play(reply: Reply, g: number): Promise<void> {
    if (reply.type !== "events") return;
    const { view } = this;
    const frames = reply.frames.map((b) => new Uint8Array(b));
    const decisions = reply.events.filter((e) => e.type === "thinking").length;
    const perDecision = decisions ? frames.length / decisions : 0;
    let next = 0;
    let pending: { street: number } | null = null;
    for (const e of reply.events as GameEvent[]) {
      if (g !== this.generation) return;
      if (e.type === "board") this.street = STREET_OF_BOARD[e.cards.length] ?? this.street;
      if (e.type === "thinking") {
        view.wait();
        await view.table.handle(e);
        pending = { street: this.street };
        for (let k = 0; k < perDecision && g === this.generation; k++, next++) {
          const f = frames[next];
          let sum = 0;
          for (let i = 0; i < f.length; i += 7) sum += f[i];
          const level = Math.min(1, sum / (f.length / 7) / 60);
          view.brainFrame(f, level);
          view.table.thinking(level);
          await new Promise((r) => setTimeout(r, FRAME_MS));
        }
        continue;
      }
      if (e.type === "decision") {
        view.brainRest();
        this.thoughts.push({ street: pending?.street ?? this.street, action: e.action, probs: e.probs });
        await view.table.handle(e);
        continue;
      }
      if (e.type === "turn") {
        await view.table.handle(e);
        if (g === this.generation) view.turn(e.obs, e.amounts, e.raise);
        continue;
      }
      if (e.type === "result") {
        view.wait();
        await view.table.handle(e);
        if (g !== this.generation) return;
        this.total += Math.round(e.human_bb * 100);
        this.played++;
        view.score(this.total, this.played);
        view.done(this.thoughts);
        continue;
      }
      await view.table.handle(e);
    }
  }
}
