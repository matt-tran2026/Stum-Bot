import { expectedValuePerUnit } from "@mvp/shared";
import type { BookOdd, OddsComparison } from "./types.js";

export async function fetchMarketOdds(_event: string, _marketType: string, _selection: string): Promise<BookOdd[]> {
  // Replace with a real odds provider integration.
  return [
    { bookKey: "draftkings", bookName: "DraftKings", odds: -105 },
    { bookKey: "fanduel", bookName: "FanDuel", odds: -102 },
    { bookKey: "betmgm", bookName: "BetMGM", odds: +100 },
    { bookKey: "caesars", bookName: "Caesars", odds: -108 }
  ];
}

export function buildOddsComparison(odds: BookOdd[], fairProbability: number): OddsComparison {
  const market = odds
    .map((entry) => ({
      ...entry,
      ev: expectedValuePerUnit(entry.odds, fairProbability)
    }))
    .sort((a, b) => b.ev - a.ev);

  const best = market[0];

  return {
    bestBookKey: best.bookKey,
    bestBookName: best.bookName,
    bestOdds: best.odds,
    bestEv: best.ev,
    market
  };
}
