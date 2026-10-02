// The phone page: one screen, no scrolling. A slim top bar (score, practice, menu), the portrait
// table filling the middle with the fly's brain glowing behind it, your hand as a pill, and the
// thumb dock. Everything else (practice slider, hand guide, training chart, lens, credits) is in a
// sheet that slides up.

import { BrainView } from "../../brain";
import type { RaiseRange } from "../../engine/game";
import type { Obs } from "../../engine/poker";
import { HandPanel } from "../../handpanel";
import type { BootData } from "../boot";
import { Chart } from "../chart";
import type { PlayController, PlayView } from "../controller";
import { buildHowTo } from "../howto";
import { signedDollars } from "../money";
import { PlayTable } from "../table";
import { runIntro } from "../intro";
import { renderThoughts, type FlyThought } from "../thoughts";
import { Dock } from "./dock";
import "./mobile.css";

const short = (n: number) => (n >= 1e6 ? `${+(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
const mb = (b: number) => (b / 1e6).toFixed(1);
const GITHUB = `<svg viewBox="0 0 16 16" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

const BRAIN_REST = 0.3; // the brain's opacity behind the table while the fly isn't thinking

export class MobileView implements PlayView {
  readonly table: PlayTable;
  private root = document.createElement("main");
  private brain: BrainView;
  private brainCanvas: HTMLCanvasElement;
  private chart: Chart;
  private pill: HandPanel;
  private dock!: Dock;
  private sheet: HTMLDialogElement;
  private introduced = false;
  private q = <T extends HTMLElement = HTMLElement>(sel: string) => this.root.querySelector(sel) as T;

  constructor(private data: BootData) {
    // The desktop page's markup isn't used on a phone.
    document.querySelector("main.play")?.remove();
    document.getElementById("how-sheet")?.remove();
    document.getElementById("loading")?.remove();

    this.root.className = "m";
    this.root.innerHTML = `
      <header class="m-top">
        <div class="m-score"><span class="m-score__value">$0</span><span class="m-score__detail"></span></div>
        <button class="m-chip" type="button" aria-label="Practice level: change it in the menu"></button>
        <button class="m-menu" type="button" aria-label="Menu">☰</button>
      </header>
      <section class="m-stage" aria-label="The table">
        <canvas class="m-brain" aria-hidden="true"></canvas>
        <canvas class="m-table"></canvas>
        <div class="tags m-tags" aria-live="polite"></div>
        <div class="m-loading" role="status">
          <p class="m-loading__text">Loading the fly's brain…</p>
          <span class="m-loading__track"><span class="m-loading__fill"></span></span>
        </div>
      </section>
      <div class="m-pill"></div>
      <div class="m-dockwrap"></div>
      <dialog class="m-sheet" aria-label="Menu">
        <form method="dialog" class="m-sheet__close"><button aria-label="Close">✕</button></form>
        <section>
          <h2>Practice</h2>
          <label class="m-practice">
            <input type="range" min="0" max="0" step="1" value="0" aria-label="How much practice the fly has had" />
            <output class="m-practice__hands"></output>
          </label>
          <button class="m-lens" type="button" aria-pressed="false">Fly's-eye view</button>
        </section>
        <section>
          <h2>Which hand wins?</h2>
          <p class="sheet__lead">Make a higher hand on this list than your opponent to win.</p>
          <ol class="ranks"></ol>
          <a class="sheet__tutorial" href="https://www.wikihow.com/Play-Texas-Hold%27em" target="_blank" rel="noopener">New to poker? Learn to play on wikiHow ↗</a>
        </section>
        <section>
          <h2>Training vs bots <span class="unit">$/100 hands</span></h2>
          <svg id="training-graph" viewBox="0 0 360 90" role="img" aria-label="Winnings against each practice bot during training, with a marker at the fly you are playing"></svg>
          <ul class="legend" id="legend"></ul>
        </section>
        <nav class="m-links" aria-label="Credits">
          <span>The fly's brain: ${data.site.neurons.toLocaleString()} neurons</span>
          <a href="https://www.janelia.org/project-team/flyem" title="Connectome: MaleCNS v1.0 by FlyEM (HHMI Janelia), University of Cambridge and Google. CC-BY 4.0">MaleCNS v1.0 · CC-BY</a>
          <a href="https://github.com/axvonx/fly-poker" aria-label="Code on GitHub">${GITHUB}</a>
        </nav>
      </dialog>
      <div class="m-rotate" aria-hidden="true"><p>Turn your phone upright to play</p></div>`;
    document.body.prepend(this.root);
    document.body.classList.add("is-mobile");

    this.brainCanvas = this.q<HTMLCanvasElement>(".m-brain");
    this.brain = new BrainView(this.brainCanvas, data.xyz, data.site.readout, () => {}, 1.5);
    this.brainCanvas.style.opacity = String(BRAIN_REST);
    this.table = new PlayTable(this.q<HTMLCanvasElement>(".m-table"), this.q(".m-tags"), { layout: "portrait", maxPixelRatio: 1.5 });
    this.pill = new HandPanel(this.q(".m-pill"));
    this.chart = new Chart(data.training);
    buildHowTo(this.q(".ranks"));

    this.sheet = this.q<HTMLDialogElement>(".m-sheet");
    const open = () => this.sheet.showModal();
    this.q(".m-menu").addEventListener("click", open);
    this.q(".m-chip").addEventListener("click", open);
    this.sheet.addEventListener("click", (e) => {
      const r = this.sheet.getBoundingClientRect(); // tap outside the sheet to close
      if (e.clientY < r.top) this.sheet.close();
    });
    // The open sheet would sit above the "turn upright" card (dialogs are on top): close it.
    matchMedia("(orientation: landscape) and (max-height: 520px)").addEventListener("change", (e) => {
      if (e.matches) this.sheet.close();
    });
    const lens = this.q(".m-lens");
    lens.addEventListener("click", () => {
      const on = lens.getAttribute("aria-pressed") !== "true";
      lens.setAttribute("aria-pressed", String(on));
      this.table.setLens(on);
    });
  }

  bind(ctl: PlayController): void {
    this.dock = new Dock((a) => ctl.act(a), (to) => ctl.raise(to), () => ctl.next());
    this.q(".m-dockwrap").append(this.dock.el);
    this.q(".m-stage").append(this.dock.panel);
    const slider = this.q<HTMLInputElement>(".m-practice input");
    const snaps = ctl.snapshots;
    slider.max = String(snaps.length - 1);
    slider.value = String(ctl.pick);
    const showPick = () => {
      const s = snaps[Number(slider.value)];
      this.q(".m-practice__hands").textContent = `${short(s.hands)} hands of practice`;
      this.q(".m-chip").textContent = `Fly · ${short(s.hands)}`;
      this.chart.mark(s.hands);
    };
    slider.addEventListener("input", showPick);
    slider.addEventListener("change", () => {
      this.sheet.close();
      void ctl.choose(Number(slider.value));
    });
    slider.disabled = true; // until the brain is loaded, or a change would deal a second hand
    showPick();
  }

  brainFrame(activity: Uint8Array, level: number): void {
    this.brain.frame(activity);
    this.brainCanvas.style.opacity = String(BRAIN_REST + 0.65 * Math.min(1, level * 1.8)); // flares while it thinks
  }

  brainRest(): void {
    this.brain.rest();
    this.brainCanvas.style.opacity = String(BRAIN_REST);
  }

  turn(o: Obs, amounts: number[], raise: RaiseRange | null): void {
    this.dock.turn(o, amounts, raise);
    if (!this.introduced) {
      this.introduced = true; // once per load, at your first move (cards dealt, buttons live)
      void runIntro([
        { rect: () => this.table.screenRect("fly"), text: "This is the fly" },
        { rect: () => this.table.screenRect("cards"), text: "These are your cards" },
        { rect: () => this.q(".dock__row").getBoundingClientRect(), text: "These are your actions" },
      ]);
    }
  }

  wait(): void {
    this.dock?.wait();
  }

  done(thoughts: FlyThought[]): void {
    renderThoughts(this.table.bubble, thoughts);
    this.table.bubble.hidden = false;
    this.dock.done();
  }

  hand(hole: string[], board: string[]): void {
    this.pill.cards(hole, board);
  }

  score(total: number, played: number): void {
    const v = this.q(".m-score__value");
    v.textContent = played ? signedDollars(total) : "$0";
    v.dataset.sign = total > 0 ? "up" : total < 0 ? "down" : "";
    this.q(".m-score__detail").textContent = played ? `${played} hand${played === 1 ? "" : "s"}` : "vs the fly";
  }

  progress(loaded: number, size: number): void {
    const t = size || this.data.packed.file_bytes;
    this.q(".m-loading__text").textContent = `Loading the fly's brain… ${mb(loaded)} / ${mb(t)} MB`;
    this.q(".m-loading__fill").style.transform = `scaleX(${Math.min(1, loaded / t)})`;
  }

  loaded(): void {
    this.q(".m-loading").hidden = true;
    this.q<HTMLInputElement>(".m-practice input").disabled = false;
  }

  fail(message: string): void {
    const el = this.q(".m-loading");
    el.hidden = false;
    el.classList.add("is-error");
    this.q(".m-loading__text").textContent = `Something went wrong: ${message}`;
  }
}
