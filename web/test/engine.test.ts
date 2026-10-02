// The browser engine against the Python reference (tools/golden.py writes test/golden/).
// The fly cases also need the packed connectomes in public/data/ (tools/pack_connectome.py);
// without them those tests are skipped, and the rules/features tests still run.

import { existsSync, readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { Brain, gunzip, isGzip, parseConnectome, type Connectome } from "../src/engine/connectome";
import { encode, N_FEATURES } from "../src/engine/features";
import { Fly, Session } from "../src/engine/game";
import { ALLIN, HALF, Hand, madeHand, POT, type Obs } from "../src/engine/poker";
import { parseReadout } from "../src/engine/readout";
import { raiseStops } from "../src/play/raise";

const root = new URL("..", import.meta.url).pathname;
const golden = (name: string) => JSON.parse(readFileSync(`${root}test/golden/${name}`, "utf8"));
const rules = golden("rules.json") as {
  deck: string[];
  steps: { obs: Obs; action: number }[];
  board: string[];
  payoffs: [number, number];
}[];
const hands = golden("hands.json") as { hole: string[]; board: string[]; category: number }[];
const fly = golden("fly.json") as {
  hands: {
    arm: "real" | "shuffled" | "nobrain";
    snapshot: string;
    fly_seat: number;
    deck: string[];
    actions: number[];
    payoffs: [number, number];
    sample_index: number[];
    decisions: { index: number; obs: Obs; features: number[]; sample: number[]; sum: number; probs: number[] }[];
  }[];
};

const connectomePath = (wiring: string) => `${root}public/data/connectome-${wiring}.bin`;
const haveConnectomes = ["real", "shuffled"].every((w) => existsSync(connectomePath(w)));
const loaded = new Map<string, Connectome>();
function connectome(wiring: string): Connectome {
  if (!loaded.has(wiring)) loaded.set(wiring, parseConnectome(gunzipSync(readFileSync(connectomePath(wiring)))));
  return loaded.get(wiring)!;
}
function readout(arm: string, snapshot: string) {
  const b = readFileSync(`${root}test/golden/readouts/${arm}-${snapshot}.f32`);
  return parseReadout(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
}

describe("poker rules match pokerkit", () => {
  it(`replays ${rules.length} bot-vs-bot hands with identical observations and payoffs`, () => {
    for (const [i, g] of rules.entries()) {
      const h = new Hand(g.deck);
      for (const [j, step] of g.steps.entries()) {
        expect(h.done, `hand ${i} step ${j}`).toBe(false);
        expect(h.obs(), `hand ${i} step ${j}`).toEqual(step.obs);
        h.act(step.action);
      }
      expect(h.done, `hand ${i} finished`).toBe(true);
      expect(h.board, `hand ${i} board`).toEqual(g.board);
      expect(h.payoffs, `hand ${i} payoffs`).toEqual(g.payoffs);
    }
  });

  it(`names ${hands.length} made hands as pokerkit does`, () => {
    for (const g of hands) expect(madeHand(g.hole, g.board), `${g.hole} | ${g.board}`).toBe(g.category);
  });

  it("refuses illegal actions", () => {
    const h = new Hand(rules[0].deck);
    h.act(1); // button completes
    expect(() => h.act(0)).toThrow(/illegal/); // big blind can't fold to no bet
  });
});

describe("a person's raise of any size", () => {
  // Preflop the button (seat 1) acts first: blinds 50/100, so pot 150 and 50 to call.
  const fresh = () => new Hand(rules[0].deck);

  it("reads a preset's exact amount as that preset, and any other size by its fraction of the pot", () => {
    const h = fresh();
    expect([h.minRaiseTo(), h.raiseAmountFor(HALF), h.raiseAmountFor(POT), h.maxRaiseTo()]).toEqual([200, 200, 300, 20_000]);
    expect(h.raiseBucket(200)).toBe(HALF);
    expect(h.raiseBucket(300)).toBe(POT);
    expect(h.raiseBucket(20_000)).toBe(ALLIN);
    expect(h.raiseBucket(240)).toBe(HALF); // raises 140 into 200: 0.7 of the pot
    expect(h.raiseBucket(250)).toBe(POT); // 0.75
    expect(h.raiseBucket(5_000)).toBe(POT);
  });

  it("plays a preset through actRaiseTo exactly as act() does", () => {
    for (const a of [HALF, POT, ALLIN]) {
      const viaAct = fresh();
      viaAct.act(a);
      const viaRaise = fresh();
      viaRaise.actRaiseTo(viaRaise.raiseAmountFor(a));
      expect(viaRaise.history).toEqual(viaAct.history);
      expect(viaRaise.obs()).toEqual(viaAct.obs());
    }
  });

  it("bets the exact amount and leaves the right call", () => {
    const h = fresh();
    h.actRaiseTo(730);
    expect(h.history).toEqual([[1, 0, POT]]);
    expect(h.obs()).toMatchObject({ seat: 0, pot: 830, to_call: 630 });
  });

  it("refuses raises outside the legal range, fractions of a chip, and raises when none is legal", () => {
    expect(() => fresh().actRaiseTo(199)).toThrow();
    expect(() => fresh().actRaiseTo(20_001)).toThrow();
    expect(() => fresh().actRaiseTo(250.5)).toThrow();
    const h = fresh();
    h.act(ALLIN);
    expect(() => h.actRaiseTo(20_000)).toThrow();
  });

  it("plays a hand against the fly, with the amount on the action event", () => {
    const session = new Session(new Fly(null, readout("nobrain", "h000900000")));
    let events = session.newHand(7, 1);
    const turn = events[events.length - 1];
    expect(turn).toMatchObject({ type: "turn", raise: { min: 200, max: 20_000 } });
    events = session.raiseTo(450);
    expect(events[0]).toEqual({ type: "action", who: "human", action: "pot", pot: 550, to: 450 });
    let guard = 0;
    while (events[events.length - 1].type === "turn" && guard++ < 50) events = session.act(1);
    expect(events[events.length - 1].type).toBe("result");
  });

  it("offers the slider every whole dollar between the limits, plus the presets", () => {
    expect(raiseStops(150, 520, [260, 999])).toEqual([150, 200, 260, 300, 400, 500, 520]);
    expect(raiseStops(200, 400, [200, 300])).toEqual([200, 300, 400]);
    expect(raiseStops(500, 500, [])).toEqual([500]);
  });
});

describe("features match flypoker.features.encode", () => {
  it("encodes every golden decision identically", () => {
    expect(N_FEATURES).toBe(131);
    for (const g of fly.hands) {
      for (const d of g.decisions) {
        const x = encode(d.obs);
        d.features.forEach((v, k) => expect(x[k]).toBeCloseTo(v, 6));
      }
    }
  });
});

describe.skipIf(!haveConnectomes)("the fly matches the Python reference (csr kernel)", () => {
  for (const arm of ["real", "shuffled", "nobrain"] as const) {
    it(`${arm}: probabilities within 1e-4 at every decision`, () => {
      let worstP = 0;
      let worstRate = 0;
      for (const g of fly.hands.filter((g) => g.arm === arm)) {
        const brain = arm === "nobrain" ? null : new Brain(connectome(arm));
        const f = new Fly(brain, readout(arm, g.snapshot));
        f.begin();
        const h = new Hand(g.deck);
        const decisions = new Map(g.decisions.map((d) => [d.index, d]));
        for (const [i, a] of g.actions.entries()) {
          const d = decisions.get(i);
          if (d) {
            const o = h.obs();
            expect(o).toEqual(d.obs);
            const { probs, inputs } = f.decide(o);
            d.probs.forEach((p, k) => (worstP = Math.max(worstP, Math.abs(probs[k] - p))));
            g.sample_index.forEach((idx, k) => {
              const ref = d.sample[k];
              worstRate = Math.max(worstRate, Math.abs(inputs[idx] - ref) / Math.max(Math.abs(ref), 1e-6));
            });
            const sum = inputs.reduce((s, v) => s + v, 0);
            expect(sum).toBeCloseTo(d.sum, 3);
          }
          h.act(a);
        }
        expect(h.payoffs).toEqual(g.payoffs);
      }
      console.log(`${arm}: worst |dp| ${worstP.toExponential(2)}, worst relative rate error ${worstRate.toExponential(2)}`);
      expect(worstP).toBeLessThan(1e-4);
    });
  }

  it("decompresses with DecompressionStream (the browser path) to the same bytes", async () => {
    const raw = readFileSync(connectomePath("real"));
    expect(isGzip(raw)).toBe(true);
    expect(Buffer.compare(Buffer.from(await gunzip(raw)), gunzipSync(raw))).toBe(0);
  });

  it("plays a full hand against a person, and times one decision", () => {
    const g = fly.hands.find((g) => g.arm === "real")!;
    const session = new Session(new Fly(new Brain(connectome("real")), readout("real", g.snapshot)), { frames: true });
    const frames: Uint8Array[] = [];
    let events = session.newHand(7, 0, frames);
    let guard = 0;
    while (events[events.length - 1].type === "turn" && guard++ < 50) events = session.act(1, frames);
    expect(events[events.length - 1].type).toBe("result");
    if (frames.length) expect(frames[0].length).toBe(connectome("real").n);

    const f = new Fly(new Brain(connectome("real")), readout("real", g.snapshot));
    f.begin();
    const o = new Hand(g.deck).obs();
    f.decide(o); // warm up the JIT
    const t0 = performance.now();
    const n = 5;
    for (let i = 0; i < n; i++) f.decide(o);
    console.log(`one decision (8 steps over ${connectome("real").nnz.toLocaleString()} synapses): ${((performance.now() - t0) / n).toFixed(1)} ms`);
  });
});
