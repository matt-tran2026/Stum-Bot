export type BookOdd = {
  bookKey: string;
  bookName: string;
  odds: number;
};

export type OddsComparison = {
  bestBookKey: string;
  bestBookName: string;
  bestOdds: number;
  bestEv: number;
  market: Array<{
    bookKey: string;
    bookName: string;
    odds: number;
    ev: number;
  }>;
};
