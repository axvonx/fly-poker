// The thumb dock: Fold, Check/Call, Raise ▴. Raise opens a row of the legal sizes above the dock
// (½ pot, pot, all in, each with what it bets). After the hand, one wide "Next hand →".

import type { Obs } from "../../engine/poker";
import { dollars } from "../money";

const FOLD = 0, CALL = 1, HALF = 2, POT = 3, ALLIN = 4;

export class Dock {
  readonly el = document.createElement("nav");
  private picker = document.createElement("div");
  private fold = button("Fold", "dock__btn dock__btn--fold");
  private call = button("Call", "dock__btn");
  private raise = button("Raise ▴", "dock__btn dock__btn--raise");
  private next = button("Next hand →", "dock__next");
  private sizes = [HALF, POT, ALLIN].map((a) => ({ a, el: button("", "pick__btn") }));

  constructor(onAct: (action: number) => void, onNext: () => void) {
    this.el.className = "dock";
    this.el.setAttribute("aria-label", "Your move");
    this.picker.className = "pick";
    this.picker.hidden = true;
    this.picker.append(...this.sizes.map((s) => s.el));
    const row = document.createElement("div");
    row.className = "dock__row";
    row.append(this.fold, this.call, this.raise);
    this.el.append(this.picker, row, this.next);

    const act = (a: number) => {
      this.wait();
      onAct(a);
    };
    this.fold.addEventListener("click", () => act(FOLD));
    this.call.addEventListener("click", () => act(CALL));
    this.raise.addEventListener("click", () => {
      this.picker.hidden = !this.picker.hidden;
      this.raise.setAttribute("aria-expanded", String(!this.picker.hidden));
    });
    for (const s of this.sizes) s.el.addEventListener("click", () => act(s.a));
    this.next.addEventListener("click", () => {
      this.wait();
      onNext();
    });
    this.wait();
  }

  /** Your move: label each choice with what it costs. amounts[a] is the street total it bets to. */
  turn(o: Obs, amounts: number[]): void {
    this.show("act");
    this.fold.disabled = !o.legal[FOLD];
    this.call.disabled = !o.legal[CALL];
    setLabel(this.call, o.to_call ? "Call" : "Check", o.to_call ? dollars(o.to_call) : "");
    const label: Record<number, [string, string]> = {
      [HALF]: ["½ pot", `to ${dollars(amounts[HALF])}`],
      [POT]: ["Pot", `to ${dollars(amounts[POT])}`],
      [ALLIN]: ["All in", dollars(o.stack)],
    };
    let any = false;
    for (const s of this.sizes) {
      s.el.hidden = !o.legal[s.a];
      any ||= o.legal[s.a];
      setLabel(s.el, ...label[s.a]);
    }
    this.raise.disabled = !any;
  }

  /** Not your move: everything in place, greyed out. */
  wait(): void {
    this.show("act");
    for (const b of [this.fold, this.call, this.raise]) b.disabled = true;
  }

  done(): void {
    this.show("next");
  }

  private show(which: "act" | "next"): void {
    this.picker.hidden = true;
    this.raise.setAttribute("aria-expanded", "false");
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
