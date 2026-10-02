// The desktop page: the wide table with the brain beside it, the bar of buttons, your hand in
// big words, the training chart. The markup is in index.html (<main class="play">).

import { BrainView } from "../brain";
import type { Obs } from "../engine/poker";
import { Bar } from "./bar";
import type { BootData } from "./boot";
import { Chart } from "./chart";
import type { PlayController, PlayView } from "./controller";
import { buildHowTo } from "./howto";
import { signedDollars } from "./money";
import { PlayTable } from "./table";
import { renderThoughts, type FlyThought } from "./thoughts";

const $ = (id: string) => document.getElementById(id)!;
const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const mb = (b: number) => (b / 1e6).toFixed(1);

export class DesktopView implements PlayView {
  readonly table: PlayTable;
  private brain: BrainView;
  private chart: Chart;
  private bar!: Bar;
  private slider = $("practice") as HTMLInputElement;

  constructor(private data: BootData) {
    $("specimen-meta").textContent = `${data.site.neurons.toLocaleString()} neurons`;
    const scale = () => {
      ($("scalebar").querySelector(".scalebar__bar") as HTMLElement).style.width = `${100 / this.brain.umPerPixel()}px`;
    };
    this.brain = new BrainView($("brain") as HTMLCanvasElement, data.xyz, data.site.readout, () => scale());
    this.table = new PlayTable($("table") as HTMLCanvasElement, $("tags"));
    this.chart = new Chart(data.training);

    // How to play: a sheet; click outside its box to close (its own padding is the dialog too).
    buildHowTo($("ranks"));
    const sheet = $("how-sheet") as HTMLDialogElement;
    $("how").addEventListener("click", () => sheet.showModal());
    sheet.addEventListener("click", (e) => {
      const r = sheet.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) sheet.close();
    });

    // The fly's-eye lens: button or F.
    const lens = $("lens");
    const setLens = (on: boolean) => {
      this.table.setLens(on);
      lens.setAttribute("aria-pressed", String(on));
    };
    lens.addEventListener("click", () => setLens(lens.getAttribute("aria-pressed") !== "true"));
    addEventListener("keydown", (e) => {
      if ((e.key === "f" || e.key === "F") && !(e.target instanceof HTMLInputElement)) setLens(lens.getAttribute("aria-pressed") !== "true");
    });
  }

  /** Wire the controls to the controller (they need it; it needs the view first). */
  bind(ctl: PlayController): void {
    this.bar = new Bar((a) => ctl.act(a), () => ctl.next());
    const snaps = ctl.snapshots;
    this.slider.max = String(snaps.length - 1);
    this.slider.value = String(ctl.pick);
    const showPick = () => {
      const s = snaps[Number(this.slider.value)];
      $("practice-hands").textContent = `${short(s.hands)} hands`;
      this.chart.mark(s.hands);
    };
    this.slider.addEventListener("input", showPick);
    this.slider.addEventListener("change", () => void ctl.choose(Number(this.slider.value)));
    this.slider.disabled = true; // until the brain is loaded, or a change would deal a second hand
    showPick();
  }

  brainFrame(activity: Uint8Array): void {
    this.brain.frame(activity);
  }

  brainRest(): void {
    this.brain.rest();
  }

  turn(o: Obs, amounts: number[]): void {
    this.bar.turn(o, amounts);
  }

  wait(): void {
    this.bar?.wait();
  }

  done(thoughts: FlyThought[]): void {
    renderThoughts(this.table.bubble, thoughts);
    this.table.bubble.hidden = false;
    this.bar.done();
  }

  hand(hole: string[], board: string[]): void {
    this.bar?.hand(hole, board);
  }

  score(total: number, played: number): void {
    $("score-value").textContent = played ? signedDollars(total) : "$0";
    $("score-value").dataset.sign = total > 0 ? "up" : total < 0 ? "down" : "";
    $("score-detail").textContent = played ? `${played} hand${played === 1 ? "" : "s"}` : "";
  }

  progress(loaded: number, size: number): void {
    const t = size || this.data.packed.file_bytes;
    $("loading-text").textContent = `Loading the fly's brain… ${mb(loaded)} / ${mb(t)} MB`;
    ($("loading-fill") as HTMLElement).style.transform = `scaleX(${Math.min(1, loaded / t)})`;
  }

  loaded(): void {
    $("loading").hidden = true;
    this.slider.disabled = false;
  }

  fail(message: string): void {
    $("loading").hidden = false;
    $("loading").classList.add("is-error");
    $("loading-text").textContent = `Something went wrong: ${message}`;
  }
}
