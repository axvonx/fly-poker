// Poker hands in plain words, for people: "Two pair", "Kings and 8s", and which cards make it.
// Ranking comes from the engine's evaluator (handScore), which the golden tests check.

import { handScore, RANKS } from "./engine/poker";

export const HAND_NAMES = [
  "High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind",
  "Straight flush", "Royal flush",
] as const;

const PLURAL = ["2s", "3s", "4s", "5s", "6s", "7s", "8s", "9s", "10s", "Jacks", "Queens", "Kings", "Aces"];
const SINGLE = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "Jack", "Queen", "King", "Ace"];

export interface MadeHand {
  rank: number; // index into HAND_NAMES
  name: string; // "Two pair"
  detail: string; // "Kings and 8s"
  best: string[]; // the best five cards (fewer before the flop)
  core: string[]; // the cards that make the hand: the pair, the trips, all five of a flush...
}

const rankOf = (c: string) => RANKS.indexOf(c[0]);

function combos(cards: string[], k: number): string[][] {
  if (k === 0) return [[]];
  if (cards.length < k) return [];
  const [first, ...rest] = cards;
  return [...combos(rest, k - 1).map((c) => [first, ...c]), ...combos(rest, k)];
}

/** Describe the best hand in 2..7 cards. */
export function describe(cards: string[]): MadeHand {
  const best = cards.length > 5
    ? combos(cards, 5).reduce((a, b) => (handScore(b) > handScore(a) ? b : a))
    : [...cards];
  const byRank = new Map<number, string[]>();
  for (const c of best) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) ?? []), c]);
  const groups = [...byRank.entries()].sort((a, b) => b[1].length - a[1].length || b[0] - a[0]);
  const top = Math.max(...best.map(rankOf));
  const flush = best.length === 5 && best.every((c) => c[1] === best[0][1]);
  const ranks = [...new Set(best.map(rankOf))].sort((a, b) => b - a);
  const wheel = ranks.join() === "12,3,2,1,0";
  const straight = best.length === 5 && ranks.length === 5 && (ranks[0] - ranks[4] === 4 || wheel);
  const straightTop = wheel ? 3 : ranks[0];
  const [g0, g1] = groups;

  const hand = (rank: number, detail: string, core: string[]): MadeHand =>
    ({ rank, name: HAND_NAMES[rank], detail, best, core });
  if (straight && flush) {
    return straightTop === 12 ? hand(9, "Ace to 10, one suit", best) : hand(8, `${SINGLE[straightTop]} high`, best);
  }
  if (g0[1].length === 4) return hand(7, PLURAL[g0[0]], g0[1]);
  if (g0[1].length === 3 && g1?.[1].length >= 2) return hand(6, `${PLURAL[g0[0]]} full of ${PLURAL[g1[0]]}`, best);
  if (flush) return hand(5, `${SINGLE[top]} high`, best);
  if (straight) return hand(4, `${SINGLE[straightTop]} high`, best);
  if (g0[1].length === 3) return hand(3, PLURAL[g0[0]], g0[1]);
  if (g0[1].length === 2 && g1?.[1].length === 2) return hand(2, `${PLURAL[g0[0]]} and ${PLURAL[g1[0]]}`, [...g0[1], ...g1[1]]);
  if (g0[1].length === 2) return hand(1, PLURAL[g0[0]], g0[1]);
  return hand(0, SINGLE[top], best.filter((c) => rankOf(c) === top));
}

/** Chance of ending with each hand by the river, from all 133,784,560 seven-card deals. */
export const RIVER_CHANCE = [17.4, 43.8, 23.5, 4.83, 4.62, 3.03, 2.6, 0.168, 0.0279, 0.0032];

/** One example of each hand, best five cards; the starred ones are the hand's core. */
export const EXAMPLES: string[][] = [
  ["Ah*", "Jd", "8c", "6s", "3h"],
  ["Kh*", "Ks*", "9d", "6c", "2h"],
  ["Jh*", "Jc*", "4d*", "4s*", "Ah"],
  ["7h*", "7d*", "7c*", "Ks", "2d"],
  ["9c*", "8d*", "7h*", "6s*", "5c*"],
  ["Ad*", "Jd*", "9d*", "6d*", "3d*"],
  ["Qs*", "Qh*", "Qd*", "5c*", "5h*"],
  ["8s*", "8h*", "8d*", "8c*", "Kd"],
  ["9h*", "8h*", "7h*", "6h*", "5h*"],
  ["As*", "Ks*", "Qs*", "Js*", "Ts*"],
];

/** Chance to beat a random hand from here, by sampling the cards still to come. */
export function winChance(hole: string[], board: string[], deck: string[], samples = 1500): number {
  const seen = new Set([...hole, ...board]);
  const rest = deck.filter((c) => !seen.has(c));
  let score = 0;
  for (let s = 0; s < samples; s++) {
    // Partial Fisher-Yates: draw the opponent's 2 and the missing board cards.
    const need = 2 + 5 - board.length;
    for (let i = 0; i < need; i++) {
      const j = i + Math.floor(Math.random() * (rest.length - i));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const full = [...board, ...rest.slice(2, need)];
    const me = handScore([...hole, ...full]), them = handScore([rest[0], rest[1], ...full]);
    score += me > them ? 1 : me === them ? 0.5 : 0;
  }
  return score / samples;
}
