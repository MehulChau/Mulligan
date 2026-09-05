const NAMED_LABELS: Record<number, string> = {
  [-4]: "condor",
  [-3]: "albatross",
  [-2]: "eagle",
  [-1]: "birdie",
  [0]: "par",
  [1]: "bogey",
  [2]: "double bogey",
};

/** "eagle"/"birdie"/"par"/"bogey"/"double bogey" for the named range; "+3" and beyond outside it. */
export function scoreToParLabel(strokes: number, par: number): string {
  const diff = strokes - par;
  const named = NAMED_LABELS[diff];
  if (named) return named;
  return diff > 0 ? `+${diff}` : `${diff}`;
}

export interface ScoreBreakdown {
  strokesToGreen: number;
  putts: number;
  totalStrokes: number;
  par: number;
  label: string;
}

export function summarizeScore(strokesToGreen: number, putts: number, par: number): ScoreBreakdown {
  const totalStrokes = strokesToGreen + putts;
  return { strokesToGreen, putts, totalStrokes, par, label: scoreToParLabel(totalStrokes, par) };
}
