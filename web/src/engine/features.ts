// What the fly is shown: a port of flypoker/features.py. No equity or hand-strength maths:
// cards, chips, position, the opponent's last move and the name of the hand you hold.

import { CARD_INDEX, HAND_CATEGORIES, N_ACTIONS, STACK, madeHand, type Obs } from "./poker";

const LAYOUT: [string, number][] = [
  ["hole", 52],
  ["board", 52],
  ["street", 4],
  ["button", 1],
  ["chips", 5],
  ["made_hand", HAND_CATEGORIES.length],
  ["suited", 1],
  ["opp_last", N_ACTIONS + 1], // +1: opponent hasn't acted this street
  ["raises", 1],
];
export const N_FEATURES = LAYOUT.reduce((s, [, n]) => s + n, 0);
const OFFSET: Record<string, number> = {};
{
  let o = 0;
  for (const [name, n] of LAYOUT) {
    OFFSET[name] = o;
    o += n;
  }
}

export function encode(o: Obs): Float32Array {
  const x = new Float32Array(N_FEATURES);
  for (const c of o.hole) x[OFFSET.hole + CARD_INDEX[c]] = 1;
  for (const c of o.board) x[OFFSET.board + CARD_INDEX[c]] = 1;
  x[OFFSET.street + o.street] = 1;
  x[OFFSET.button] = o.seat === 1 ? 1 : 0;
  const potOdds = o.to_call ? o.to_call / (o.pot + o.to_call) : 0;
  x.set([o.pot / STACK, o.to_call / STACK, o.stack / STACK, o.opp_stack / STACK, potOdds], OFFSET.chips);
  x[OFFSET.made_hand + madeHand(o.hole, o.board)] = 1;
  x[OFFSET.suited] = o.hole[0][1] === o.hole[1][1] ? 1 : 0;
  const thisStreet = o.history.filter(([, st]) => st === o.street);
  const opp = thisStreet.filter(([seat]) => seat !== o.seat);
  x[OFFSET.opp_last + (opp.length ? opp[opp.length - 1][2] : N_ACTIONS)] = 1;
  x[OFFSET.raises] = thisStreet.filter(([, , a]) => a >= 2).length / 4;
  return x;
}
