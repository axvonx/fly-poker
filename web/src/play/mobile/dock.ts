// The thumb dock: Fold, Check/Call, Raise ▴. Raise opens a panel over the foot of the table: chips
// for the usual sizes (Min, ½ pot, Pot, All in), a slider with − / + for any other, and a wide
// "Raise to $X" that commits. After the hand, one wide "Next hand →".

import type { RaiseRange } from "../../engine/game";
import type { Obs } from "../../engine/poker";
import { dollars } from "../money";
import { RaiseControl, raiseLabel } from "../raise";

const FOLD = 0, CALL = 1;

export class Dock {
  readonly el = document.createElement("nav");
  /** The raise panel. The page puts it over the table, so opening it doesn't resize the table. */
  readonly panel = document.createElement("div");
  private fold = button("Fold", "dock__btn dock__btn--fold");
  private call = button("Call", "dock__btn dock__btn--call");
  private raise = button("Raise ▴", "dock__btn dock__btn--raise");
  private go = button("Raise", "pick__go");
  private next = button("Next hand →", "dock__next");
  private sizer: RaiseControl;
  private turnState: { o: Obs; range: RaiseRange } | null = null;

  constructor(onAct: (action: number) => void, onRaise: (to: number) => void, onNext: () => void) {
    this.el.className = "dock";
    this.el.setAttribute("aria-label", "Your move");
    this.sizer = new RaiseControl((to) => {
      if (this.turnState) setLabel(this.go, ...raiseLabel(this.turnState.o, to, this.turnState.range));
    });
    this.panel.className = "pick";
    this.panel.hidden = true;
    this.panel.setAttribute("aria-label", "How much to raise");
    this.panel.append(this.sizer.el, this.go);
    const row = document.createElement("div");
    row.className = "dock__row";
    row.append(this.fold, this.call, this.raise);
    this.el.append(row, this.next);

    const act = (go: () => void) => {
      this.wait();
      go();
    };
    this.fold.addEventListener("click", () => act(() => onAct(FOLD)));
    this.call.addEventListener("click", () => act(() => onAct(CALL)));
    this.raise.addEventListener("click", () => this.open(this.raise.getAttribute("aria-expanded") !== "true"));
    this.go.addEventListener("click", () => {
      const to = this.sizer.value;
      act(() => onRaise(to));
    });
    this.next.addEventListener("click", () => act(onNext));
    this.wait();
  }

  /** Your move: label each choice with what it costs, and ready the raise sizes. */
  turn(o: Obs, amounts: number[], range: RaiseRange | null): void {
    this.show("act");
    this.el.classList.add("is-turn");
    this.turnState = range && { o, range };
    this.fold.disabled = !o.legal[FOLD];
    this.call.disabled = !o.legal[CALL];
    setLabel(this.call, o.to_call ? "Call" : "Check", o.to_call ? dollars(o.to_call) : "");
    this.raise.disabled = this.go.disabled = !range;
    this.sizer.set(o, amounts, range); // relabels "Raise to $X"
  }

  /** Not your move: everything in place, greyed out. */
  wait(): void {
    this.show("act");
    this.el.classList.remove("is-turn");
    this.turnState = null;
    for (const b of [this.fold, this.call, this.raise, this.go]) b.disabled = true;
    this.sizer.disable();
  }

  done(): void {
    this.show("next");
  }

  private open(on: boolean): void {
    this.panel.hidden = !on;
    this.raise.setAttribute("aria-expanded", String(on));
  }

  private show(which: "act" | "next"): void {
    this.open(false);
    this.el.classList.toggle("is-done", which === "next");
  }
}

function button(label: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.innerHTML = `<span class="btn__label"></span><span class="btn__detail"></span>`;
  b.querySelector(".btn__label")!.textContent = label;
  return b;
}

function setLabel(b: HTMLButtonElement, label: string, detail: string): void {
  b.querySelector(".btn__label")!.textContent = label;
  b.querySelector(".btn__detail")!.textContent = detail;
}
