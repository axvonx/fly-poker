// A hand in big words: "Two pair" over "Kings and 8s", and a meter of how often it beats a random
// hand from here. The play page shows yours; the fair display shows the fly's.

import { DECK } from "./engine/poker";
import { describe, winChance, type MadeHand } from "./hands";

export class HandPanel {
  private name: HTMLElement;
  private detail: HTMLElement;
  private meter: HTMLElement;
  private fill: HTMLElement;
  private pct: HTMLElement;

  constructor(root: HTMLElement) {
    root.classList.add("hand");
    root.setAttribute("aria-live", "polite");
    root.innerHTML = `
      <p class="hand__name"></p>
      <p class="hand__detail"></p>
      <div class="hand__meter" hidden title="How often this hand beats a random hand, from here">
        <span class="hand__track"><span class="hand__fill"></span></span>
        <span class="hand__chance"><span class="hand__pct"></span> vs a random hand</span>
      </div>`;
    const $ = (sel: string) => root.querySelector(sel) as HTMLElement;
    this.name = $(".hand__name");
    this.detail = $(".hand__detail");
    this.meter = $(".hand__meter");
    this.fill = $(".hand__fill");
    this.pct = $(".hand__pct");
  }

  /** Show the best hand in hole + board (nothing when hole is empty). */
  cards(hole: string[], board: string[]): void {
    if (hole.length < 2) this.show(null, null);
    else this.show(describe([...hole, ...board]), winChance(hole, board, DECK));
  }

  show(h: MadeHand | null, chance: number | null): void {
    const text = h ? h.name : "";
    if (this.name.textContent !== text) {
      this.name.textContent = text;
      this.name.classList.remove("is-new");
      void this.name.offsetWidth; // restart the pop animation
      this.name.classList.add("is-new");
    }
    this.detail.textContent = h ? h.detail : "";
    this.meter.hidden = chance === null;
    if (chance !== null) {
      this.fill.style.transform = `scaleX(${chance})`;
      this.pct.textContent = `${Math.round(chance * 100)}%`;
      this.meter.dataset.level = chance >= 0.65 ? "strong" : chance >= 0.45 ? "fair" : "weak";
    }
  }
}
