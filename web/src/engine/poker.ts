// Heads-up no-limit hold'em, ported from flypoker/poker.py (which runs on pokerkit).
// Seat 0 is the big blind, seat 1 the button / small blind. Cards come from the given deck:
// hole cards deck[0:2] (seat 0) and deck[2:4] (seat 1), flop deck[4:7], turn deck[7], river deck[8].
// Parity with the Python reference is checked by web/test/engine.test.ts against tools/golden.py.

export const SB = 50;
export const BB = 100;
export const STACK = 20_000;
export const ACTIONS = ["fold", "call", "half", "pot", "allin"] as const; // "call" is check-or-call
export const N_ACTIONS = ACTIONS.length;
export const FOLD = 0;
export const CALL = 1;
export const HALF = 2;
export const POT = 3;
export const ALLIN = 4;

export const RANKS = "23456789TJQKA";
export const SUITS = "cdhs";
export const DECK: string[] = [...RANKS].flatMap((r) => [...SUITS].map((s) => r + s));
export const CARD_INDEX: Record<string, number> = Object.fromEntries(DECK.map((c, i) => [c, i]));

export const HAND_CATEGORIES = [
  "High card",
  "One pair",
  "Two pair",
  "Three of a kind",
  "Straight",
  "Flush",
  "Full house",
  "Four of a kind",
  "Straight flush",
] as const;

/** (seat, street, action) */
export type HistoryItem = [number, number, number];

/** What one seat can see when it is asked to act. */
export interface Obs {
  seat: number;
  hole: string[];
  board: string[];
  street: number; // 0 preflop .. 3 river
  pot: number; // chips in the middle, including current-street bets
  to_call: number;
  stack: number;
  opp_stack: number;
  history: HistoryItem[];
  legal: boolean[];
}

const STREET_OF_BOARD: Record<number, number> = { 0: 0, 3: 1, 4: 2, 5: 3 };
const BOARD_DEALS: Record<number, [number, number]> = { 0: [4, 7], 3: [7, 8], 4: [8, 9] };

export class Hand {
  readonly deck: string[];
  readonly history: HistoryItem[] = [];
  board: string[] = [];
  bets = [BB, SB];
  stacks = [STACK - BB, STACK - SB];
  /** Chips each seat has put in this hand (pokerkit's negative payoffs while playing). */
  private committed = [BB, SB];
  private collected = 0;
  private active = [true, true];
  private queue: number[] = [];
  private raiseAmount = 0; // largest raise increment this street
  private acted = new Set<number>();
  private shortAllIns: number[] = [];
  private finished = false;
  payoffs: [number, number] = [0, 0];

  constructor(deck: string[]) {
    this.deck = deck;
    this.beginBetting();
  }

  get done(): boolean {
    return this.finished;
  }

  get actor(): number | null {
    return this.finished || !this.queue.length ? null : this.queue[0];
  }

  get street(): number {
    return STREET_OF_BOARD[this.board.length];
  }

  get pot(): number {
    return this.collected + this.bets[0] + this.bets[1];
  }

  holeCards(seat: number): string[] {
    return this.deck.slice(2 * seat, 2 * seat + 2);
  }

  // -- betting state (pokerkit semantics) -----------------------------------
  private maxBet(): number {
    return Math.max(this.bets[0], this.bets[1]);
  }

  private effectiveStack(i: number): number {
    if (!this.active[i]) return 0;
    const own = this.bets[i] + this.stacks[i];
    const other = this.active[1 - i] ? this.bets[1 - i] + this.stacks[1 - i] : 0;
    return Math.min(own, other);
  }

  toCall(): number {
    const a = this.actor!;
    return Math.min(this.stacks[a], this.maxBet() - this.bets[a]);
  }

  canRaise(): boolean {
    const a = this.actor;
    if (a === null) return false;
    const shortSum = this.shortAllIns.reduce((s, v) => s + v, 0);
    if (this.shortAllIns.length && shortSum < this.raiseAmount && this.acted.has(a)) return false;
    if (this.stacks[a] <= this.maxBet() - this.bets[a]) return false;
    const o = 1 - a;
    return this.active[o] && this.stacks[o] + this.bets[o] > this.maxBet();
  }

  minRaiseTo(): number {
    const a = this.actor!;
    return Math.min(this.stacks[a] + this.bets[a], Math.max(this.raiseAmount, BB) + this.maxBet());
  }

  maxRaiseTo(): number {
    const a = this.actor!;
    return this.stacks[a] + this.bets[a];
  }

  private raiseTo(frac: number): number {
    const potAfterCall = this.pot + this.toCall();
    const target = this.maxBet() + Math.trunc(frac * potAfterCall);
    return Math.min(Math.max(target, this.minRaiseTo()), this.maxRaiseTo());
  }

  legalMask(): boolean[] {
    const m = [false, false, false, false, false];
    if (this.finished || this.actor === null) return m;
    m[CALL] = true;
    m[FOLD] = this.toCall() > 0;
    if (this.canRaise()) {
      const hi = this.maxRaiseTo();
      m[ALLIN] = true;
      // Sized raises are only distinct from all-in when they land below it.
      m[HALF] = this.raiseTo(0.5) < hi;
      m[POT] = this.raiseTo(1.0) < hi;
    }
    return m;
  }

  obs(): Obs {
    const seat = this.actor;
    if (seat === null) throw new Error("no one to act");
    return {
      seat,
      hole: this.holeCards(seat),
      board: [...this.board],
      street: this.street,
      pot: this.pot,
      to_call: this.toCall(),
      stack: this.stacks[seat],
      opp_stack: this.stacks[1 - seat],
      history: this.history.map((h) => [...h] as HistoryItem),
      legal: this.legalMask(),
    };
  }

  /** Chips that would go in for each action right now (for display). */
  raiseAmountFor(action: number): number {
    if (action === ALLIN) return this.maxRaiseTo();
    if (action === HALF) return this.raiseTo(0.5);
    if (action === POT) return this.raiseTo(1.0);
    return this.bets[this.actor!] + this.toCall();
  }

  /** Which of the fly's three raises a raise to `to` reads as (its opponent's-last-move input is
   *  one of the five actions). A preset's exact amount is that preset, so playing it this way
   *  writes the same history as act(); any other size goes to half or pot by its fraction of the
   *  pot, split at the geometric midpoint √½. */
  raiseBucket(to: number): number {
    const m = this.legalMask();
    if (to === this.maxRaiseTo()) return ALLIN;
    if (m[HALF] && to === this.raiseTo(0.5)) return HALF;
    if (m[POT] && to === this.raiseTo(1.0)) return POT;
    const frac = (to - this.maxBet()) / (this.pot + this.toCall());
    return frac < Math.SQRT1_2 ? HALF : POT;
  }

  // -- acting -------------------------------------------------------------------
  act(action: number): void {
    if (!this.legalMask()[action]) throw new Error(`illegal action ${ACTIONS[action]}`);
    this.apply(action, action >= HALF ? this.raiseAmountFor(action) : 0);
  }

  /** A person's raise to any legal street total (in chips), not only the three preset sizes. */
  actRaiseTo(to: number): void {
    if (this.finished || this.actor === null || !this.canRaise()) throw new Error("can't raise now");
    if (!Number.isInteger(to) || to < this.minRaiseTo() || to > this.maxRaiseTo()) {
      throw new Error(`raise to ${to} is outside ${this.minRaiseTo()}..${this.maxRaiseTo()}`);
    }
    this.apply(this.raiseBucket(to), to);
  }

  private apply(action: number, to: number): void {
    const seat = this.actor!;
    const street = this.street;
    if (action === FOLD) {
      this.queue.shift();
      this.acted.add(seat);
      this.active[seat] = false;
    } else if (action === CALL) {
      const amount = this.toCall();
      this.queue.shift();
      this.acted.add(seat);
      this.put(seat, amount);
    } else {
      this.raise(seat, to);
    }
    this.history.push([seat, street, action]);
    if (!this.queue.length || this.active.filter(Boolean).length <= 1) this.endBetting();
  }

  private put(seat: number, amount: number): void {
    this.bets[seat] += amount;
    this.stacks[seat] -= amount;
    this.committed[seat] += amount;
  }

  private raise(seat: number, to: number): void {
    const increment = to - this.maxBet();
    this.acted.add(seat);
    this.put(seat, to - this.bets[seat]);
    this.queue = [1 - seat].filter((i) => this.active[i] && this.stacks[i] > 0);
    if (increment >= this.raiseAmount) {
      this.acted.clear();
      this.acted.add(seat);
    }
    this.raiseAmount = Math.max(this.raiseAmount, increment);
    if (this.stacks[seat]) this.shortAllIns = [];
    else this.shortAllIns.push(increment);
    if (this.shortAllIns.reduce((s, v) => s + v, 0) >= this.raiseAmount) this.shortAllIns = [];
  }

  private beginBetting(): void {
    // Preflop the button (seat 1) opens; after the flop the big blind (seat 0) does.
    const opener = this.board.length === 0 ? 1 : 0;
    this.queue = [opener, 1 - opener].filter(
      (i) => this.active[i] && this.stacks[i] > 0 && this.effectiveStack(i) > 0,
    );
    this.raiseAmount = 0;
    this.acted.clear();
    this.shortAllIns = [];
    const only = this.queue.length === 1 && this.bets[this.queue[0]] >= this.maxBet();
    if (!this.queue.length || only) this.endBetting();
  }

  private endBetting(): void {
    this.queue = [];
    this.collected += this.bets[0] + this.bets[1];
    this.bets = [0, 0];
    const alive = [0, 1].filter((i) => this.active[i]);
    if (alive.length === 1) return this.settle([alive[0]]);
    if (this.board.length === 5) return this.showdown();
    const [lo, hi] = BOARD_DEALS[this.board.length];
    this.board.push(...this.deck.slice(lo, hi));
    this.beginBetting();
  }

  private showdown(): void {
    const s0 = handScore([...this.holeCards(0), ...this.board]);
    const s1 = handScore([...this.holeCards(1), ...this.board]);
    this.settle(s0 > s1 ? [0] : s1 > s0 ? [1] : [0, 1]);
  }

  private settle(winners: number[]): void {
    const share = this.collected / winners.length;
    for (const i of [0, 1]) this.payoffs[i] = -this.committed[i] + (winners.includes(i) ? share : 0);
    this.finished = true;
  }
}

// -- hand evaluation ------------------------------------------------------------

/** Best 5-card hand among `cards` (5..7) as a comparable number: category, then tiebreak ranks. */
export function handScore(cards: string[]): number {
  return evaluate(cards).score;
}

function evaluate(cards: string[]): { category: number; score: number } {
  const counts = new Array(13).fill(0);
  const suitRanks: number[][] = [[], [], [], []];
  for (const c of cards) {
    const r = RANKS.indexOf(c[0]);
    counts[r]++;
    suitRanks[SUITS.indexOf(c[1])].push(r);
  }
  const make = (category: number, ranks: number[]) => {
    let score = category;
    for (let k = 0; k < 5; k++) score = score * 13 + (ranks[k] ?? 0);
    return { category, score };
  };
  /** Rank of the top card of the best straight in a rank bitmask, or -1. */
  const straightTop = (mask: number): number => {
    const m = (mask << 1) | ((mask >> 12) & 1); // bit 0 is the ace playing low (the wheel)
    for (let top = 13; top >= 4; top--) {
      if (((m >> (top - 4)) & 0b11111) === 0b11111) return top - 1;
    }
    return -1;
  };
  const flushSuit = suitRanks.findIndex((s) => s.length >= 5);
  if (flushSuit >= 0) {
    const mask = suitRanks[flushSuit].reduce((m, r) => m | (1 << r), 0);
    const top = straightTop(mask);
    if (top >= 0) return make(8, [top]);
  }
  const byCount = [...counts.keys()]
    .filter((r) => counts[r] > 0)
    .sort((a, b) => counts[b] - counts[a] || b - a);
  const desc = (exclude: number[]) =>
    [...counts.keys()].reverse().filter((r) => counts[r] > 0 && !exclude.includes(r));
  if (counts[byCount[0]] === 4) return make(7, [byCount[0], desc([byCount[0]])[0]]);
  const trips = [...counts.keys()].reverse().filter((r) => counts[r] >= 3);
  const pairs = [...counts.keys()].reverse().filter((r) => counts[r] >= 2);
  if (trips.length) {
    const t = trips[0];
    const p = pairs.filter((r) => r !== t);
    if (p.length) return make(6, [t, p[0]]);
  }
  if (flushSuit >= 0) return make(5, [...suitRanks[flushSuit]].sort((a, b) => b - a).slice(0, 5));
  const top = straightTop(counts.reduce((m, c, r) => (c ? m | (1 << r) : m), 0));
  if (top >= 0) return make(4, [top]);
  if (trips.length) return make(3, [trips[0], ...desc([trips[0]]).slice(0, 2)]);
  if (pairs.length >= 2) return make(2, [pairs[0], pairs[1], desc([pairs[0], pairs[1]])[0]]);
  if (pairs.length === 1) return make(1, [pairs[0], ...desc([pairs[0]]).slice(0, 3)]);
  return make(0, desc([]).slice(0, 5));
}

/** Index into HAND_CATEGORIES of the best hand a player can see right now. */
export function madeHand(hole: string[], board: string[]): number {
  if (!board.length) return hole[0][0] === hole[1][0] ? 1 : 0;
  return evaluate([...hole, ...board]).category;
}
