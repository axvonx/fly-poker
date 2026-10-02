// The bar under the table. On your turn: your five choices, priced in dollars. After the
// hand: what the fly was thinking at each of its decisions, then "Next hand".

import type { Obs } from "../engine/poker";
import { ACTIONS, ACTION_LABEL, type Action } from "../protocol";
import { dollars } from "./money";

const $ = (id: string) => document.getElementById(id)!;
const STREET = ["Pre-flop", "Flop", "Turn", "River"];
const SHORT: Record<Action, string> = { fold: "fold", call: "check/call", half: "½ pot", pot: "pot", allin: "all in" };

export interface FlyThought {
  street: number;
  action: Action;
  probs: Record<Action, number>;
}

export class Bar {
  private buttons: HTMLButtonElement[];

  constructor(onAct: (action: number) => void, onNext: () => void) {
    this.buttons = ACTIONS.map((a, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `act act--${a}`;
      b.disabled = true;
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
      b.innerHTML = `<span class="act__label"></span><span class="act__detail"></span>`;
      b.querySelector(".act__label")!.textContent = label;
      b.querySelector(".act__detail")!.textContent = detail;
    });
    $("bar-status").textContent = "Your move";
    this.buttons.find((b) => !b.disabled)?.focus({ preventScroll: true });
  }

  /** Not your turn: keep the buttons in place, greyed out. */
  wait(status: string): void {
    this.show("actions");
    this.disable();
    $("bar-status").textContent = status;
  }

  /** After the hand: the fly's reasoning, decision by decision. */
  recap(thoughts: FlyThought[], verdict: string): void {
    $("recap-verdict").textContent = verdict;
    const list = $("recap-list");
    list.replaceChildren(
      ...(thoughts.length
        ? thoughts.map((t) => {
            const li = document.createElement("li");
            li.className = "thought";
            const head = document.createElement("p");
            head.className = "thought__head";
            head.innerHTML = `<span class="thought__street"></span> <span class="thought__action"></span>`;
            head.querySelector(".thought__street")!.textContent = STREET[t.street];
            head.querySelector(".thought__action")!.textContent = ACTION_LABEL[t.action];
            const bar = document.createElement("div");
            bar.className = "thought__bar";
            bar.setAttribute("role", "img");
            const odds = ACTIONS.filter((a) => t.probs[a] >= 0.005).map((a) => `${SHORT[a]} ${Math.round(t.probs[a] * 100)}%`);
            bar.setAttribute("aria-label", odds.join(", "));
            for (const a of ACTIONS) {
              if (t.probs[a] < 0.005) continue;
              const seg = document.createElement("span");
              seg.className = `seg seg--${a}${a === t.action ? " is-chosen" : ""}`;
              seg.style.flexGrow = String(t.probs[a]);
              seg.title = `${SHORT[a]} ${Math.round(t.probs[a] * 100)}%`;
              bar.append(seg);
            }
            const legend = document.createElement("p");
            legend.className = "thought__odds";
            legend.textContent = odds.join(" · ");
            li.append(head, bar, legend);
            return li;
          })
        : [Object.assign(document.createElement("li"), { className: "thought thought--none", textContent: "The fly never had to decide this hand." })]),
    );
    this.show("recap");
    ($("next") as HTMLButtonElement).focus({ preventScroll: true });
  }

  private disable(): void {
    for (const b of this.buttons) b.disabled = true;
  }

  private show(which: "actions" | "recap"): void {
    $("bar-actions").hidden = which !== "actions";
    $("bar-recap").hidden = which !== "recap";
  }
}
