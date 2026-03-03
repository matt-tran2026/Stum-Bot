export type AmericanOdds = number;

export function americanToDecimal(american: AmericanOdds): number {
  if (american === 0) {
    throw new Error("American odds cannot be 0");
  }

  if (american > 0) {
    return 1 + american / 100;
  }

  return 1 + 100 / Math.abs(american);
}

export function impliedProbability(american: AmericanOdds): number {
  if (american > 0) {
    return 100 / (american + 100);
  }

  return Math.abs(american) / (Math.abs(american) + 100);
}

export function noVigProbability(twoWayA: AmericanOdds, twoWayB: AmericanOdds): { a: number; b: number } {
  const rawA = impliedProbability(twoWayA);
  const rawB = impliedProbability(twoWayB);
  const total = rawA + rawB;

  return {
    a: rawA / total,
    b: rawB / total
  };
}

export function expectedValuePerUnit(american: AmericanOdds, fairWinProbability: number): number {
  const decimalOdds = americanToDecimal(american);
  const netWin = decimalOdds - 1;
  const loseProbability = 1 - fairWinProbability;

  return fairWinProbability * netWin - loseProbability;
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}
