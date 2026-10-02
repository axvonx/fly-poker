// A person plays the fly, one hand at a time. Runs anywhere (the Web Worker, or node in tests).

import { activityBytes, Brain } from "./connectome";
import { encode } from "./features";
import { ACTIONS, BB, DECK, Hand, type Obs } from "./poker";
import { normalise, probs, type Readout } from "./readout";

export type Action = (typeof ACTIONS)[number];

/** The fly: a frozen brain (null for the no-brain control) plus a trained readout. */
export class Fly {
  readonly brain: Brain | null;
  readout: Readout;

  constructor(brain: Brain | null, readout: Readout) {
    const inputs = brain ? brain.c.descending.length : readout.dim;
    if (inputs !== readout.dim) throw new Error(`readout expects ${readout.dim} inputs, brain gives ${inputs}`);
    this.brain = brain;
    this.readout = readout;
  }

  /** Call at the start of every hand: the brain's state carries over only within a hand. */
  begin(): void {
    this.brain?.reset();
  }

  /** Think about one decision. onStep sees the whole-brain state after each dynamics step. */
  decide(o: Obs, onStep?: (r: Float32Array, step: number) => void): { probs: number[]; inputs: Float32Array } {
    const u = encode(o);
    let x = u;
    if (this.brain) {
      this.brain.run(u, onStep);
      x = this.brain.readout();
    }
    return { probs: probs(this.readout, normalise(this.readout, x), o.legal), inputs: x };
  }
}

/** Small seeded PRNG (sfc32): deals and the fly's sampling are reproducible from a seed. */
export function rng(seed: number): () => number {
  let a = 0x9e3779b9;
  let b = 0x243f6a88;
  let c = 0xb7e15162;
  let d = seed >>> 0;
  const next = () => {
    a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
    const t = (a + b) | 0;
    a = b ^ (b >>> 9);
    b = (c + (c << 3)) | 0;
    c = (c << 21) | (c >>> 11);
    d = (d + 1) | 0;
    const out = (t + d) | 0;
    c = (c + out) | 0;
    return (out >>> 0) / 4294967296;
  };
  for (let i = 0; i < 12; i++) next();
  return next;
}

export function shuffledDeck(random: () => number): string[] {
  const deck = [...DECK];
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function sample(p: number[], random: () => number): number {
  let u = random();
  for (let a = 0; a < p.length; a++) {
    if (p[a] > 0 && (u -= p[a]) < 0) return a;
  }
  return p.reduce((best, v, a) => (v > p[best] ? a : best), 0); // rounding left u >= 0
}

/** Display events, in the shape of web/src/protocol.ts (with who: "human" | "fly"). */
export type GameEvent =
  | { type: "hand"; human_seat: number; human_button: boolean; human_cards: string[]; snapshot_hands: number }
  | { type: "board"; cards: string[] }
  | { type: "thinking"; legal: boolean[]; pot: number; to_call: number }
  | { type: "decision"; probs: Record<Action, number>; action: Action; pot: number }
  | { type: "action"; who: "human"; action: Action; pot: number }
  | { type: "turn"; obs: Obs; amounts: number[] }
  | { type: "result"; human_bb: number; fly_cards: string[]; showdown: boolean; board: string[] };

export interface SessionOptions {
  greedy?: boolean; // take the fly's most likely action instead of sampling (training samples)
  frames?: boolean; // capture whole-brain activity bytes after every dynamics step
  snapshotHands?: number;
}

/** One hand between a person and the fly. Feed it the person's actions; it plays the fly's. */
export class Session {
  readonly fly: Fly;
  readonly options: SessionOptions;
  hand: Hand | null = null;
  humanSeat = 0;
  private random: () => number = Math.random;
  private boardSeen = 0;

  constructor(fly: Fly, options: SessionOptions = {}) {
    this.fly = fly;
    this.options = options;
  }

  /** Deal a new hand. Returns events up to the person's first decision (or the end). */
  newHand(seed: number, humanSeat: number, frames: Uint8Array[] = []): GameEvent[] {
    this.random = rng(seed);
    this.hand = new Hand(shuffledDeck(this.random));
    this.humanSeat = humanSeat;
    this.boardSeen = 0;
    this.fly.begin();
    const events: GameEvent[] = [{
      type: "hand",
      human_seat: humanSeat,
      human_button: humanSeat === 1,
      human_cards: this.hand.holeCards(humanSeat),
      snapshot_hands: this.options.snapshotHands ?? 0,
    }];
    return this.advance(events, frames);
  }

  /** The person acts. Returns events up to their next decision (or the end). */
  act(action: number, frames: Uint8Array[] = []): GameEvent[] {
    const h = this.hand;
    if (!h || h.done || h.actor !== this.humanSeat) throw new Error("not your turn");
    h.act(action);
    const events: GameEvent[] = [{ type: "action", who: "human", action: ACTIONS[action], pot: h.pot }];
    return this.advance(events, frames);
  }

  private advance(events: GameEvent[], frames: Uint8Array[]): GameEvent[] {
    const h = this.hand!;
    while (true) {
      if (h.board.length > this.boardSeen) {
        events.push({ type: "board", cards: [...h.board] });
        this.boardSeen = h.board.length;
      }
      if (h.done) break;
      const o = h.obs();
      if (o.seat === this.humanSeat) {
        const amounts = o.legal.map((ok, a) => (ok ? h.raiseAmountFor(a) : 0));
        events.push({ type: "turn", obs: o, amounts });
        return events;
      }
      events.push({ type: "thinking", legal: o.legal, pot: o.pot, to_call: o.to_call });
      const onStep = this.options.frames ? (r: Float32Array) => frames.push(activityBytes(r)) : undefined;
      const { probs: p } = this.fly.decide(o, onStep);
      const a = this.options.greedy ? p.indexOf(Math.max(...p)) : sample(p, this.random);
      h.act(a);
      events.push({
        type: "decision",
        probs: Object.fromEntries(ACTIONS.map((name, k) => [name, p[k]])) as Record<Action, number>,
        action: ACTIONS[a],
        pot: h.pot,
      });
    }
    const last = h.history[h.history.length - 1];
    events.push({
      type: "result",
      human_bb: h.payoffs[this.humanSeat] / BB,
      fly_cards: h.holeCards(1 - this.humanSeat),
      showdown: !last || last[2] !== 0,
      board: [...h.board],
    });
    return events;
  }
}
