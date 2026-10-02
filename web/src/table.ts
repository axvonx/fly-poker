// The hand in progress: cards, pot, and the five readout bars the fly chooses from.

import { ACTIONS, ACTION_LABEL, OPPONENT_LABEL, type Action, type Message } from "./protocol";

const SUIT_GLYPH: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };
const SUIT_NAME: Record<string, string> = { s: "spades", h: "hearts", d: "diamonds", c: "clubs" };

const $ = (id: string) => document.getElementById(id)!;

function card(code?: string): HTMLElement {
  const el = document.createElement("span");
  if (!code) {
    el.className = "card card--down";
    el.setAttribute("aria-label", "face-down card");
    return el;
  }
  const rank = code[0] === "T" ? "10" : code[0];
  const suit = code[1];
  el.className = `card card--${suit === "h" || suit === "d" ? "red" : "black"}`;
  el.setAttribute("aria-label", `${rank} of ${SUIT_NAME[suit]}`);
  el.innerHTML = `<span class="card__rank">${rank}</span><span class="card__suit">${SUIT_GLYPH[suit]}</span>`;
  return el;
}

function setCards(id: string, codes: (string | undefined)[]): void {
  $(id).replaceChildren(...codes.map(card));
}

export class TableView {
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
      this.bars.set(a, {
        row,
        fill: row.querySelector(".readout__fill")!,
        value: row.querySelector(".readout__value")!,
      });
    }
  }

  handle(m: Message): void {
    switch (m.type) {
      case "hand":
        $("opponent-name").textContent = OPPONENT_LABEL[m.opponent];
        setCards("opponent-cards", [undefined, undefined]);
        setCards("fly-cards", m.fly_cards);
        setCards("board", []);
        $("pot").textContent = "";
        $("opponent-last").textContent = "";
        $("fly-last").textContent = m.fly_button ? "Dealer" : "Big blind";
        this.resetBars();
        break;
      case "board":
        setCards("board", m.cards);
        break;
      case "action":
        $("opponent-last").textContent = ACTION_LABEL[m.action];
        if (m.pot) $("pot").textContent = `Pot ${m.pot.toLocaleString()}`;
        break;
      case "thinking":
        $("pot").textContent = `Pot ${m.pot.toLocaleString()}`;
        $("fly-last").textContent = "Thinking…";
        this.resetBars(m.legal);
        break;
      case "decision":
        for (const a of ACTIONS) {
          const b = this.bars.get(a)!;
          const p = m.probs[a];
          b.fill.style.transform = `scaleX(${p})`;
          b.value.textContent = b.row.classList.contains("is-illegal") ? "" : `${Math.round(p * 100)}%`;
          b.row.classList.toggle("is-chosen", a === m.action);
        }
        $("fly-last").textContent = ACTION_LABEL[m.action];
        break;
      case "result": {
        if (m.showdown) setCards("opponent-cards", m.opponent_cards);
        const bb = m.fly_bb;
        $("pot").textContent =
          bb > 0 ? `The fly wins ${fmtBB(bb)}` : bb < 0 ? `The fly loses ${fmtBB(-bb)}` : "Split pot";
        break;
      }
    }
  }

  private resetBars(legal?: boolean[]): void {
    ACTIONS.forEach((a, i) => {
      const b = this.bars.get(a)!;
      b.fill.style.transform = "scaleX(0)";
      b.value.textContent = "";
      b.row.classList.remove("is-chosen");
      b.row.classList.toggle("is-illegal", legal ? !legal[i] : false);
    });
  }
}

function fmtBB(bb: number): string {
  const n = Math.abs(bb) >= 10 ? Math.round(bb) : Math.round(bb * 10) / 10;
  return `${n} big blind${n === 1 ? "" : "s"}`;
}
