// What the fly was thinking, shown after the hand in a bubble beside its avatar: one row per
// decision, its choice and how sure it was, and the spread over all five choices.

import { ACTIONS, ACTION_LABEL, type Action } from "../protocol";

const STREET = ["Pre-flop", "Flop", "Turn", "River"];
const SHORT: Record<Action, string> = { fold: "fold", call: "check/call", half: "½ pot", pot: "pot", allin: "all in" };

const PILL_SHORT: Record<Action, string> = { fold: "Fold", call: "Call", half: "½ pot", pot: "Pot", allin: "All in" };

export interface FlyThought {
  street: number;
  action: Action;
  probs: Record<Action, number>;
}

export function renderThoughts(el: HTMLElement, thoughts: FlyThought[]): void {
  const title = document.createElement("p");
  title.className = "bubble__title";
  title.textContent = thoughts.length ? "What I was thinking" : "I never had to decide";
  const rows = thoughts.map((t, i) => {
    const row = document.createElement("div");
    row.className = "thought";
    row.style.animationDelay = `${120 + i * 90}ms`;
    const street = document.createElement("span");
    street.className = "thought__street";
    street.textContent = STREET[t.street];
    const action = document.createElement("span");
    action.className = `pill pill--${t.action}`;
    // Long and short labels; a narrow table shows the short one (see play.css).
    action.innerHTML = `<span class="pill__long"></span><span class="pill__short"></span> ${Math.round(t.probs[t.action] * 100)}%`;
    action.querySelector(".pill__long")!.textContent = ACTION_LABEL[t.action];
    action.querySelector(".pill__short")!.textContent = PILL_SHORT[t.action];
    const bar = document.createElement("span");
    bar.className = "thought__bar";
    const odds = ACTIONS.filter((a) => t.probs[a] >= 0.005).map((a) => `${SHORT[a]} ${Math.round(t.probs[a] * 100)}%`);
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", odds.join(", "));
    bar.title = odds.join(" · ");
    for (const a of ACTIONS) {
      if (t.probs[a] < 0.005) continue;
      const seg = document.createElement("span");
      seg.className = `seg seg--${a}${a === t.action ? " is-chosen" : ""}`;
      seg.style.flexGrow = String(t.probs[a]);
      bar.append(seg);
    }
    row.append(street, action, bar);
    return row;
  });
  el.replaceChildren(title, ...rows);
}
