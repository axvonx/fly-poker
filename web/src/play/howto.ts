// "How to play": the rules in three lines, then every hand from strongest to weakest, with an
// example, its core cards lit, and how often you end up with it by the river.

import { EXAMPLES, HAND_NAMES, RIVER_CHANCE } from "../hands";

const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

export function mini(code: string, lit = false): HTMLElement {
  const el = document.createElement("span");
  const rank = code[0] === "T" ? "10" : code[0], suit = code[1];
  el.className = `mini mini--${suit === "h" || suit === "d" ? "red" : "black"}${lit ? " is-lit" : ""}`;
  el.textContent = `${rank}${SUIT[suit]}`;
  return el;
}

const pct = (p: number) => (p >= 1 ? `${p.toFixed(1)}%` : p >= 0.1 ? `${p.toFixed(2)}%` : `${p.toFixed(4)}%`);

export function buildHowTo(list: HTMLElement): void {
  const rows = HAND_NAMES.map((name, rank) => {
    const li = document.createElement("li");
    li.className = "rank";
    const cards = document.createElement("span");
    cards.className = "rank__cards";
    cards.append(...EXAMPLES[rank].map((c) => mini(c.slice(0, 2), c.endsWith("*"))));
    const odds = document.createElement("span");
    odds.className = "rank__odds";
    // Log scale, so the rare hands still show a sliver.
    const w = Math.max(0.02, Math.log10(RIVER_CHANCE[rank] / 0.001) / Math.log10(100 / 0.001));
    odds.innerHTML = `<span class="rank__bar"><span style="transform:scaleX(${w.toFixed(3)})"></span></span><span class="rank__pct">${pct(RIVER_CHANCE[rank])}</span>`;
    const label = document.createElement("span");
    label.className = "rank__name";
    label.textContent = name;
    li.append(label, cards, odds);
    return li;
  });
  list.replaceChildren(...rows.reverse());
}
