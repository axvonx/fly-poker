// How the fly did against the practice bots while it trained ($ per 100 hands at $0.50/$1,
// numerically the training log's bb/100), with a marker at the fly you're playing.

import { OPPONENT_COLOR, OPPONENT_LABEL, type Opponent } from "../protocol";

const $ = (id: string) => document.getElementById(id)!;
const SVG = "http://www.w3.org/2000/svg";
const BOTS: Opponent[] = ["random", "station", "maniac", "equity"];
const SMOOTH = 0.2; // exponential smoothing per log interval, as on the fair display

export interface TrainingSeries {
  series: { hands: number; bb100: Partial<Record<Opponent, number>> }[];
}

export class Chart {
  private X: (v: number) => number = () => 0;

  constructor(private data: TrainingSeries) {
    $("legend").replaceChildren(
      ...BOTS.map((o) => {
        const li = document.createElement("li");
        li.innerHTML = `<span class="legend__swatch" style="background:${OPPONENT_COLOR[o]}"></span>${OPPONENT_LABEL[o]}`;
        return li;
      }),
    );
    this.draw();
  }

  private draw(): void {
    const svg = $("training-graph");
    svg.replaceChildren();
    const series = this.data.series;
    if (series.length < 2) return;
    const W = 360, H = 90, pad = 4;
    const lines = BOTS.map((o) => {
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
    this.X = (v: number) => pad + ((Math.min(Math.max(v, x0), x1) - x0) / (x1 - x0 || 1)) * (W - 2 * pad);
    const Y = (v: number) => H - pad - ((v - y0) / (y1 - y0 || 1)) * (H - 2 * pad);
    const add = (tag: string, attrs: Record<string, string | number>) => {
      const e = document.createElementNS(SVG, tag);
      for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
      svg.append(e);
      return e;
    };
    add("line", { x1: pad, x2: W - pad, y1: Y(0), y2: Y(0), class: "graph__zero" });
    lines.forEach((pts, i) =>
      add("polyline", {
        points: pts.map(([x, y]) => `${this.X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(" "),
        class: "graph__line",
        stroke: OPPONENT_COLOR[BOTS[i]],
      }),
    );
    add("line", { x1: 0, x2: 0, y1: 0, y2: H, class: "graph__marker", id: "graph-marker" });
  }

  /** Mark the snapshot being played. */
  mark(hands: number): void {
    const m = document.getElementById("graph-marker");
    if (!m) return;
    const x = this.X(hands).toFixed(1);
    m.setAttribute("x1", x);
    m.setAttribute("x2", x);
  }
}
