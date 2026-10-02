import { describe as suite, expect, it } from "vitest";
import { DECK, madeHand } from "../src/engine/poker";
import { describe, EXAMPLES, RIVER_CHANCE } from "../src/hands";

function deal(n: number, seed: number): string[] {
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const d = [...DECK];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(rand() * (d.length - i));
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d.slice(0, n);
}

suite("hand names", () => {
  it("agree with the engine's category on random seven-card deals", () => {
    for (let k = 0; k < 3000; k++) {
      const cards = deal(7, k + 1);
      const h = describe(cards);
      expect(Math.min(h.rank, 8)).toBe(madeHand(cards.slice(0, 2), cards.slice(2)));
      expect(h.best).toHaveLength(5);
      for (const c of h.core) expect(h.best).toContain(c);
    }
  });

  it("match the published river frequencies", () => {
    const n = 40000, counts = new Array(10).fill(0);
    for (let k = 0; k < n; k++) counts[describe(deal(7, 99991 * k + 7)).rank]++;
    for (const r of [0, 1, 2, 3, 4, 5, 6]) expect(Math.abs((100 * counts[r]) / n - RIVER_CHANCE[r])).toBeLessThan(0.8);
  });

  it("name the examples as their rank, cores as starred", () => {
    EXAMPLES.forEach((ex, rank) => {
      const h = describe(ex.map((c) => c.slice(0, 2)));
      expect(h.rank).toBe(rank);
      expect(new Set(h.core)).toEqual(new Set(ex.filter((c) => c.endsWith("*")).map((c) => c.slice(0, 2))));
    });
  });

  it("read naturally", () => {
    expect(describe(["Ah", "2c", "3d", "4s", "5h", "Kd", "Kc"]).name).toBe("Straight");
    expect(describe(["Ah", "2c", "3d", "4s", "5h", "Kd", "9c"]).detail).toBe("5 high");
    expect(describe(["Kh", "Kd", "8c", "8s", "2h"]).detail).toBe("Kings and 8s");
    expect(describe(["Qs", "Qh", "Qd", "5c", "5h", "5d", "2c"]).detail).toBe("Queens full of 5s");
    expect(describe(["As", "Kd"]).name).toBe("High card");
    expect(describe(["9s", "9d"]).name).toBe("Pair");
  });
});
