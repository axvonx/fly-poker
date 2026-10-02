// How much to raise: chips for the usual sizes (Min, ½ pot, Pot, All in), and a slider with − / +
// for anything between. The chips only set the amount; the page's own Raise button commits it.
// Shared by the desktop bar and the mobile dock.

import type { RaiseRange } from "../engine/game";
import type { Obs } from "../engine/poker";
import { dollars } from "./money";

const HALF = 2, POT = 3;
const STEP = 100; // the slider moves a dollar at a time

/** Every amount the slider can land on: min, each whole dollar between, max, and the presets. */
export function raiseStops(min: number, max: number, presets: number[]): number[] {
  const stops = new Set([min, max, ...presets.filter((p) => p >= min && p <= max)]);
  for (let v = Math.ceil(min / STEP) * STEP; v < max; v += STEP) if (v > min) stops.add(v);
  return [...stops].sort((a, b) => a - b);
}

/** The Raise button's two lines for a raise to `to`: all in at the top of the range. */
export function raiseLabel(o: Obs, to: number, range: RaiseRange): [string, string] {
  return to === range.max ? ["All in", dollars(o.stack)] : ["Raise", `to ${dollars(to)}`];
}

export class RaiseControl {
  readonly el = document.createElement("div");
  private chips = (["Min", "½ pot", "Pot", "All in"] as const).map((name) => ({ name, at: 0, el: small(name, "raise__chip") }));
  private slider = document.createElement("input");
  private less = small("−", "raise__step");
  private more = small("+", "raise__step");
  private stops: number[] = [];

  constructor(private onChange: (to: number) => void) {
    this.el.className = "raise";
    const chips = document.createElement("div");
    chips.className = "raise__chips";
    chips.append(...this.chips.map((c) => c.el));
    const slide = document.createElement("div");
    slide.className = "raise__slide";
    this.slider.type = "range";
    this.slider.className = "raise__slider";
    this.slider.step = "1";
    this.slider.setAttribute("aria-label", "Raise to");
    this.less.setAttribute("aria-label", "Raise a dollar less");
    this.more.setAttribute("aria-label", "Raise a dollar more");
    slide.append(this.less, this.slider, this.more);
    this.el.append(chips, slide);

    for (const c of this.chips) c.el.addEventListener("click", () => this.pick(this.stops.indexOf(c.at)));
    this.slider.addEventListener("input", () => this.pick(Number(this.slider.value)));
    this.less.addEventListener("click", () => this.pick(Number(this.slider.value) - 1));
    this.more.addEventListener("click", () => this.pick(Number(this.slider.value) + 1));
    this.disable();
  }

  /** The chosen street total, in chips. */
  get value(): number {
    return this.stops[Number(this.slider.value)];
  }

  /** Your turn. Starts on ½ pot (or pot, or the minimum) so the usual raise is one press. */
  set(o: Obs, amounts: number[], range: RaiseRange | null): void {
    if (!range) return this.disable();
    const presets = [HALF, POT].filter((a) => o.legal[a]).map((a) => amounts[a]);
    this.stops = raiseStops(range.min, range.max, presets);
    const at = [range.min, o.legal[HALF] ? amounts[HALF] : -1, o.legal[POT] ? amounts[POT] : -1, range.max];
    this.chips.forEach((c, i) => {
      c.at = at[i];
      // A chip that would land where another one does (or nowhere) isn't shown.
      c.el.hidden = at[i] < 0 || (i === 0 && at.slice(1).includes(range.min));
      c.el.disabled = false;
    });
    const only = this.stops.length === 1; // all in is the only raise left
    this.slider.hidden = this.less.hidden = this.more.hidden = only;
    this.slider.disabled = false;
    this.slider.min = "0";
    this.slider.max = String(this.stops.length - 1);
    this.pick(this.stops.indexOf(presets[0] ?? range.min));
  }

  /** Not your turn (or no raise is legal): everything stays in place, greyed out. */
  disable(): void {
    for (const c of this.chips) c.el.disabled = true;
    for (const b of [this.slider, this.less, this.more]) b.disabled = true;
  }

  private pick(i: number): void {
    i = Math.max(0, Math.min(this.stops.length - 1, i));
    this.slider.value = String(i);
    const to = this.stops[i];
    this.slider.setAttribute("aria-valuetext", dollars(to));
    for (const c of this.chips) c.el.setAttribute("aria-pressed", String(c.at === to));
    this.less.disabled = i === 0;
    this.more.disabled = i === this.stops.length - 1;
    this.onChange(to);
  }
}

function small(label: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  return b;
}
