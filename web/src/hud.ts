// The HUD under the table: the fly's own cards, large enough to read from across the gym,
// and the five readout bars it chooses from.

import { ACTIONS, ACTION_LABEL, type Action, type Message } from "./protocol";

const SUIT_GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };
const $ = (id: string) => document.getElementById(id)!;

function card(code: string): HTMLElement {
  const el = document.createElement("span");
  const rank = code[0] === "T" ? "10" : code[0], suit = code[1];
  el.className = `card card--${suit === "h" || suit === "d" ? "red" : "black"}`;
  el.setAttribute("aria-label", `${rank} of ${SUIT_NAME[suit]}`);
  el.innerHTML = `<span class="card__rank">${rank}</span><span class="card__suit">${SUIT_GLYPH[suit]}</span>`;
  return el;
}

export class Hud {
  private bars = new Map<Action, { row: HTMLElement; fill: HTMLElement; value: HTMLElement }>();

  constructor() {
    const list = $("readout");
    for (const a of ACTIONS) {
      const row = document.createElement("li");
      row.className = "readout__row";
      row.innerHTML = `<span class="readout__label">${ACTION_LABEL[a]}</span>
        <span class="readout__track"><span class="readout__fill"></span></span>
        <span class="readout__value"></span>`;
      list.append(row);
      this.bars.set(a, { row, fill: row.querySelector(".readout__fill")!, value: row.querySelector(".readout__value")! });
    }
  }

  handle(m: Message): void {
    if (m.type === "hand") {
      $("fly-cards").replaceChildren(...m.fly_cards.map(card));
      this.reset();
    } else if (m.type === "thinking") {
      this.reset(m.legal);
    } else if (m.type === "decision") {
      for (const a of ACTIONS) {
        const b = this.bars.get(a)!;
        b.fill.style.transform = `scaleX(${m.probs[a]})`;
        b.value.textContent = b.row.classList.contains("is-illegal") ? "" : `${Math.round(m.probs[a] * 100)}%`;
        b.row.classList.toggle("is-chosen", a === m.action);
      }
    }
  }

  private reset(legal?: boolean[]): void {
    ACTIONS.forEach((a, i) => {
      const b = this.bars.get(a)!;
      b.fill.style.transform = "scaleX(0)";
      b.value.textContent = "";
      b.row.classList.remove("is-chosen");
      b.row.classList.toggle("is-illegal", legal ? !legal[i] : false);
    });
  }
}
