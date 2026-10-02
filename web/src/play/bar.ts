// The bar under the table. On your turn: your five choices, priced in dollars; after the hand,
// "Next hand" in their place. Always: your hand, in big words, and how often it beats a random hand.

import type { Obs } from "../engine/poker";
import type { MadeHand } from "../hands";
import { ACTIONS, ACTION_LABEL } from "../protocol";
import { dollars } from "./money";

const $ = (id: string) => document.getElementById(id)!;
export class Bar {
  private buttons: HTMLButtonElement[];

  constructor(onAct: (action: number) => void, onNext: () => void) {
    this.buttons = ACTIONS.map((a, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `act act--${a}`;
      b.disabled = true;
      b.innerHTML = `<span class="act__label"></span><span class="act__detail"></span>`;
      b.querySelector(".act__label")!.textContent = ACTION_LABEL[a];
      b.addEventListener("click", () => {
        this.disable();
        onAct(i);
      });
      return b;
    });
    $("actions").replaceChildren(...this.buttons);
    $("next").addEventListener("click", () => onNext());
    this.show("actions");
  }

  /** Your turn: label each legal choice with what it costs. amounts[a] is the street total it bets to. */
  turn(o: Obs, amounts: number[]): void {
    this.show("actions");
    ACTIONS.forEach((a, i) => {
      const b = this.buttons[i];
      b.disabled = !o.legal[i];
      let label: string = ACTION_LABEL[a], detail = "";
      if (a === "call") {
        label = o.to_call ? "Call" : "Check";
        detail = o.to_call ? dollars(o.to_call) : "";
      } else if (a === "half" || a === "pot") {
        detail = o.legal[i] ? `to ${dollars(amounts[i])}` : "";
      } else if (a === "allin") {
        detail = o.legal[i] ? dollars(o.stack) : "";
      }
      b.querySelector(".act__label")!.textContent = label;
      b.querySelector(".act__detail")!.textContent = detail;
    });
    this.buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
  }

  /** Not your turn: buttons stay in place, greyed out. */
  wait(): void {
    this.show("actions");
    this.disable();
  }

  /** Your best hand right now, and how often it beats a random hand from here. */
  hand(h: MadeHand | null, chance: number | null): void {
    const name = $("hand-name");
    const text = h ? h.name : "";
    if (name.textContent !== text) {
      name.textContent = text;
      name.classList.remove("is-new");
      void name.offsetWidth; // restart the pop animation
      name.classList.add("is-new");
    }
    $("hand-detail").textContent = h ? h.detail : "";
    const meter = $("hand-meter");
    meter.hidden = chance === null;
    if (chance !== null) {
      ($("hand-fill") as HTMLElement).style.transform = `scaleX(${chance})`;
      $("hand-chance").textContent = `${Math.round(chance * 100)}%`;
      meter.dataset.level = chance >= 0.65 ? "strong" : chance >= 0.45 ? "fair" : "weak";
    }
  }

  /** The hand is over: "Next hand" takes the buttons' place. */
  done(): void {
    this.show("next");
    ($("next") as HTMLButtonElement).focus({ preventScroll: true });
  }

  private disable(): void {
    for (const b of this.buttons) b.disabled = true;
  }

  private show(which: "actions" | "next"): void {
    $("actions").hidden = which !== "actions";
    $("next").hidden = which !== "next";
  }
}
