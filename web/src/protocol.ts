// Messages from flypoker/server.py. Keep in step with flypoker/exhibit.py.

export const ACTIONS = ["fold", "call", "half", "pot", "allin"] as const;
export type Action = (typeof ACTIONS)[number];

export const ACTION_LABEL: Record<Action, string> = {
  fold: "Fold",
  call: "Check / call",
  half: "Raise ½ pot",
  pot: "Raise pot",
  allin: "All in",
};

export const OPPONENTS = ["random", "station", "maniac", "equity", "slumbot"] as const;
export type Opponent = (typeof OPPONENTS)[number];

export const OPPONENT_LABEL: Record<Opponent, string> = {
  random: "Random",
  station: "Calling station",
  maniac: "Maniac",
  equity: "Equity bot",
  slumbot: "Slumbot",
};

export const OPPONENT_BLURB: Record<Opponent, string> = {
  random: "Picks any legal move",
  station: "Never folds, never raises",
  maniac: "Raises every chance it gets",
  equity: "Bets by its odds of winning",
  slumbot: "A strong research poker AI",
};

export interface Meta {
  neurons: number;
  regions: string[];
  readout: number[];
  sensory_count: number;
  arm: string;
}

export interface EvalPoint {
  hands: number;
  opponent: Opponent;
  bb100: number;
  ci95: number;
  pairs: number;
}

export type Message =
  | {
      type: "stats";
      real?: { hands: number; hands_per_sec: number };
      shuffled?: { hands: number; hands_per_sec: number };
      nobrain?: { hands: number; hands_per_sec: number };
      eval: EvalPoint[];
    }
  | { type: "hand"; opponent: Opponent; fly_button: boolean; fly_cards: string[]; snapshot_hands: number }
  | { type: "board"; cards: string[] }
  | { type: "action"; who: "opponent"; action: Action; pot: number }
  | { type: "thinking"; legal: boolean[]; pot: number; to_call: number }
  | { type: "decision"; probs: Record<Action, number>; action: Action; pot: number }
  | { type: "result"; fly_bb: number; opponent_cards: string[]; showdown: boolean };

export interface BrainFrame {
  step: number;
  steps: number;
  activity: Uint8Array;
}

export function parseFrame(buf: ArrayBuffer): BrainFrame {
  const head = new Uint8Array(buf, 0, 4);
  return { step: head[1], steps: head[2], activity: new Uint8Array(buf, 4) };
}
