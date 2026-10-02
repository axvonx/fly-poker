// "Which hand wins?": every hand from best to worst, in plain words, with an example (the
// cards that count are lit) and how often you end up with it.

import { EXAMPLES, HAND_NAMES, RIVER_CHANCE } from "../hands";

const SUIT: Record<string, string> = { s: "♠", h: "♥", d: "♦", c: "♣" };

const PLAIN = [
  "Nothing above. Your highest card counts.",
  "Two cards of the same rank.",
  "Two different pairs.",
  "Three cards of the same rank.",
  "Five cards in a row.",
  "Five cards of the same suit.",
  "Three of a kind plus a pair.",
  "Four cards of the same rank.",
  "Five in a row, all one suit.",
  "A K Q J 10, all one suit.",
];

export function mini(code: string, lit = false): HTMLElement {
  const el = document.createElement("span");
  const rank = code[0] === "T" ? "10" : code[0], suit = code[1];
  el.className = `mini mini--${suit === "h" || suit === "d" ? "red" : "black"}${lit ? " is-lit" : ""}`;
  el.textContent = `${rank}${SUIT[suit]}`;
  return el;
}

/** "1 in 2", "1 in 38", "1 in 30,940" — easier to picture than a percentage. */
const oneIn = (percent: number) => `1 in ${Math.round(100 / percent).toLocaleString()}`;

export function buildHowTo(list: HTMLElement): void {
  const rows = HAND_NAMES.map((name, rank) => {
    const li = document.createElement("li");
    li.className = "rank";
    const text = document.createElement("div");
    text.className = "rank__text";
    text.innerHTML = `<p class="rank__name"></p><p class="rank__plain"></p>`;
    text.querySelector(".rank__name")!.textContent = name;
    text.querySelector(".rank__plain")!.textContent = PLAIN[rank];
    const cards = document.createElement("span");
    cards.className = "rank__cards";
    cards.append(...EXAMPLES[rank].map((c) => mini(c.slice(0, 2), c.endsWith("*"))));
    const odds = document.createElement("span");
    odds.className = "rank__odds";
    odds.textContent = oneIn(RIVER_CHANCE[rank]);
    odds.title = "How often you end up with this hand by the last card";
    li.append(text, cards, odds);
    return li;
  });
  list.replaceChildren(...rows.reverse());
}
