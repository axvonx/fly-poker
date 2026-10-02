// Live training stats: a ticking hands counter and the real fly's winnings against each
// bot during training (the noisy training log, smoothed), one line per bot in its colour.

import { signedDollars } from "./play/money";
import { OPPONENT_COLOR, OPPONENT_LABEL, type Message, type Opponent, type TrainingPoint } from "./protocol";

const $ = (id: string) => document.getElementById(id)!;
const SVG = "http://www.w3.org/2000/svg";
const TRAINING_BOTS: Opponent[] = ["random", "station", "maniac", "equity"];
const SMOOTH = 0.2; // exponential smoothing per log interval (2,000 hands)

export class Training {
  private hands = 0;
  private perSec = 0;
  private stamp = performance.now();

  constructor() {
    $("legend").replaceChildren(
      ...TRAINING_BOTS.map((o) => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="legend__swatch" style="background:${OPPONENT_COLOR[o]}"></span>${OPPONENT_LABEL[o]}`;
        return li;
      }),
    );
    const tick = () => {
      // Extrapolate between stats messages so the counter visibly ticks at the real pace.
      const shown = Math.floor(this.hands + (this.perSec * (performance.now() - this.stamp)) / 1000);
      $("hands").textContent = this.hands ? shown.toLocaleString() : "—";
      requestAnimationFrame(tick);
    };
    tick();
  }

  handle(m: Message): void {
    if (m.type !== "stats" || !m.real) return;
    this.hands = m.real.hands;
    this.perSec = m.real.hands_per_sec;
    this.stamp = performance.now();
    if (m.series) this.graph(m.series);
    if (m.winnings !== undefined) {
      const chips = Math.round(m.winnings * 100);
      $("winnings").textContent = chips ? signedDollars(chips) : "$0";
      $("winnings").dataset.sign = chips > 0 ? "up" : chips < 0 ? "down" : "";
    }
  }

  private graph(series: TrainingPoint[]): void {
    const svg = $("training-graph");
    svg.replaceChildren();
    if (series.length < 2) return;
    const W = 360, H = 72, pad = 4;
    const lines = TRAINING_BOTS.map((o) => {
      let ema: number | null = null;
      return series.map((p) => {
        const v = p.bb100[o] ?? 0;
        ema = ema === null ? v : ema + SMOOTH * (v - ema);
        return [p.hands, ema] as const;
      });
    });
    const xs = series.map((p) => p.hands);
    const ys = lines.flat().map(([, y]) => y).concat(0);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const X = (v: number) => pad + ((v - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
    const Y = (v: number) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
    const add = (tag: string, attrs: Record<string, string | number>) => {
      const e = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      svg.append(e);
    };
    add("line", { x1: pad, x2: W - pad, y1: Y(0), y2: Y(0), class: "graph__zero" });
    lines.forEach((pts, i) =>
      add("polyline", {
        points: pts.map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" "),
        class: "graph__line",
        stroke: OPPONENT_COLOR[TRAINING_BOTS[i]],
      }),
    );
  }
}
