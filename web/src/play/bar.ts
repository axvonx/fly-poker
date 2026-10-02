// The bar under the table. On your turn: Fold, Check/Call and Raise, priced in dollars, with the
// raise size picked above them (chips for the usual sizes, a slider for any other); after the
// hand, "Next hand" in their place. Always: your hand, in big words, and how often it beats a
// random hand.

import type { RaiseRange } from "../engine/game";
import type { Obs } from "../engine/poker";
import { HandPanel } from "../handpanel";
import { dollars } from "./money";
import { RaiseControl, raiseLabel } from "./raise";

const FOLD = 0, CALL = 1;
const $ = (id: string) => document.getElementById(id)!;
export class Bar {
  private fold = button("Fold", "act act--fold");
  private call = button("Check / call", "act act--call");
  private raise = button("Raise", "act act--raise");
  private sizer: RaiseControl;
  private handPanel = new HandPanel($("hand"));
  private turnState: { o: Obs; range: RaiseRange } | null = null;

  constructor(onAct: (action: number) => void, onRaise: (to: number) => void, onNext: () => void) {
    this.sizer = new RaiseControl((to) => {
      if (this.turnState) setLabel(this.raise, ...raiseLabel(this.turnState.o, to, this.turnState.range));
    });
    const act = (go: () => void) => {
      this.wait();
      go();
    };
    this.fold.addEventListener("click", () => act(() => onAct(FOLD)));
    this.call.addEventListener("click", () => act(() => onAct(CALL)));
    this.raise.addEventListener("click", () => {
      const to = this.sizer.value;
      act(() => onRaise(to));
    });
    $("actions").replaceChildren(this.fold, this.call, this.raise);
    $("actions").before(this.sizer.el);
    $("next").addEventListener("click", () => onNext());
    this.show("actions");
    this.wait();
  }

  /** Your turn: label each legal choice with what it costs, and offer the raise sizes. */
  turn(o: Obs, amounts: number[], range: RaiseRange | null): void {
    this.show("actions");
    $("actions").classList.add("is-turn");
    this.turnState = range && { o, range };
    this.fold.disabled = !o.legal[FOLD];
    this.call.disabled = !o.legal[CALL];
    setLabel(this.call, o.to_call ? "Call" : "Check", o.to_call ? dollars(o.to_call) : "");
    this.raise.disabled = !range;
    if (!range) setLabel(this.raise, "Raise", "");
    this.sizer.set(o, amounts, range); // relabels the Raise button
    [this.call, this.fold, this.raise].find((b) => !b.disabled)?.focus({ preventScroll: true });
  }

  /** Not your turn: everything stays in place, greyed out. */
  wait(): void {
    this.show("actions");
    $("actions").classList.remove("is-turn");
    this.turnState = null;
    for (const b of [this.fold, this.call, this.raise]) b.disabled = true;
    this.sizer.disable();
  }

  /** Your best hand right now, and how often it beats a random hand from here. */
  hand(hole: string[], board: string[]): void {
    this.handPanel.cards(hole, board);
  }

  /** The hand is over: "Next hand" takes the buttons' place. */
  done(): void {
    this.show("next");
    ($("next") as HTMLButtonElement).focus({ preventScroll: true });
  }

  private show(which: "actions" | "next"): void {
    // "Next hand" fills the height the controls took, so the table above doesn't jump.
    const box = $("bar-actions");
    box.style.minHeight = which === "next" ? `${box.offsetHeight}px` : "";
    $("actions").hidden = this.sizer.el.hidden = which !== "actions";
    $("next").hidden = which !== "next";
  }
}

function button(label: string, cls: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.disabled = true;
  b.innerHTML = `<span class="act__label"></span><span class="act__detail"></span>`;
  b.querySelector(".act__label")!.textContent = label;
  return b;
}

function setLabel(b: HTMLButtonElement, label: string, detail: string): void {
  b.querySelector(".act__label")!.textContent = label;
  b.querySelector(".act__detail")!.textContent = detail;
}
