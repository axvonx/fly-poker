// The side rail: a live hands counter, the opponent ladder, and the learning curve.

import { OPPONENTS, OPPONENT_BLURB, OPPONENT_LABEL, type EvalPoint, type Message, type Opponent } from "./protocol";

const $ = (id: string) => document.getElementById(id)!;
const SVG = "http://www.w3.org/2000/svg";

type Verdict = "beats" | "loses" | "unclear" | "untested";
const VERDICT_TEXT: Record<Verdict, string> = {
  beats: "Beats it",
  loses: "Loses to it",
  unclear: "Too close to call",
  untested: "Not tested yet",
};

export class Rail {
  private hands = 0;
  private perSec = 0;
  private stamp = performance.now();

  constructor() {
    const ladder = $("ladder");
    // Hardest at the top: the ladder is climbed.
    for (const o of [...OPPONENTS].reverse()) {
      const li = document.createElement("li");
      li.className = "rung";
      li.dataset.opponent = o;
      li.innerHTML = `<span class="rung__name">${OPPONENT_LABEL[o]}</span>
        <span class="rung__blurb">${OPPONENT_BLURB[o]}</span>
        <span class="rung__verdict" data-verdict="untested">${VERDICT_TEXT.untested}</span>`;
      ladder.append(li);
    }
    const tick = () => {
      // Extrapolate between stats messages so the counter visibly ticks at the real pace.
      const shown = Math.floor(this.hands + (this.perSec * (performance.now() - this.stamp)) / 1000);
      $("hands").textContent = shown.toLocaleString();
      requestAnimationFrame(tick);
    };
    tick();
  }

  handle(m: Message): void {
    if (m.type !== "stats" || !m.real) return;
    this.hands = m.real.hands;
    this.perSec = m.real.hands_per_sec;
    this.stamp = performance.now();
    $("pace").textContent = `About ${Math.round(this.perSec * 3600).toLocaleString()} more every hour`;
    this.ladder(m.eval);
    this.curve(m.eval.filter((p) => p.opponent === "equity"));
  }

  private ladder(points: EvalPoint[]): void {
    for (const o of OPPONENTS) {
      const latest = points.filter((p) => p.opponent === o).at(-1);
      const v: Verdict = !latest
        ? "untested"
        : latest.bb100 - latest.ci95 > 0
          ? "beats"
          : latest.bb100 + latest.ci95 < 0
            ? "loses"
            : "unclear";
      const el = document.querySelector<HTMLElement>(`.rung[data-opponent="${o as Opponent}"] .rung__verdict`)!;
      el.dataset.verdict = v;
      el.textContent = VERDICT_TEXT[v];
    }
  }

  private curve(points: EvalPoint[]): void {
    const svg = $("curve");
    svg.replaceChildren();
    if (points.length < 2) {
      $("curve-note").textContent = "The curve appears once the fly has been tested twice.";
      return;
    }
    $("curve-note").textContent = "Big blinds won per 100 hands. Above the line means winning.";
    const W = 320, H = 160, pad = 8;
    const xs = points.map((p) => p.hands), ys = points.flatMap((p) => [p.bb100 - p.ci95, p.bb100 + p.ci95, 0]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const X = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
    const Y = (v: number) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
    const el = (tag: string, attrs: Record<string, string | number>) => {
      const e = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      svg.append(e);
      return e;
    };
    el("line", { x1: pad, x2: W - pad, y1: Y(0), y2: Y(0), class: "curve__zero" });
    const band = points.map((p) => `${X(p.hands)},${Y(p.bb100 + p.ci95)}`)
      .concat([...points].reverse().map((p) => `${X(p.hands)},${Y(p.bb100 - p.ci95)}`));
    el("polygon", { points: band.join(" "), class: "curve__band" });
    el("polyline", { points: points.map((p) => `${X(p.hands)},${Y(p.bb100)}`).join(" "), class: "curve__line" });
  }
}
