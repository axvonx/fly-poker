// The HUD under the table: the five readout bars the fly chooses from.

import { ACTIONS, ACTION_LABEL, type Action, type Message } from "./protocol";

const $ = (id: string) => document.getElementById(id)!;

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
