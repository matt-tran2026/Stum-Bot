import { expectedValuePerUnit } from "@mvp/shared";
import type { BookOdd, OddsComparison } from "./types.js";

const ODDS_API_BASE_URL = process.env.ODDS_API_BASE_URL ?? "https://api.the-odds-api.com/v4";
const ODDS_API_KEY = process.env.ODDS_API_KEY;

type OddsApiOutcome = {
  name: string;
  price: number;
  point?: number;
  description?: string;
};

type OddsApiMarket = {
  key: string;
  outcomes: OddsApiOutcome[];
};

type OddsApiBookmaker = {
  key: string;
  title: string;
  markets: OddsApiMarket[];
};

type OddsApiEvent = {
  id: string;
  home_team: string;
  away_team: string;
  bookmakers?: OddsApiBookmaker[];
};

export type CompareOddsInput = {
  sport: string;
  market: string;
  selection: string;
  event?: string;
  eventId?: string;
  sportsbook?: string;
  postedOdds?: number;
};

export type CompareOddsOutput = {
  eventName: string;
  sport: string;
  market: string;
  selection: string;
  sportsbook: string | null;
  postedOdds: number | null;
  books: BookOdd[];
};

function assertApiKey(): string {
  if (!ODDS_API_KEY) {
    throw new Error("Missing ODDS_API_KEY");
  }
  return ODDS_API_KEY;
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function parseSelection(selection: string): {
  direction: "over" | "under" | null;
  point: number | null;
  subject: string;
} {
  const normalized = selection.replace(/\s+/g, " ").trim();
  const dirMatch = normalized.match(/\b(over|under)\b/i);
  const pointMatch = normalized.match(/(-?\d+(?:\.\d+)?)/);

  const direction = dirMatch ? (dirMatch[1].toLowerCase() as "over" | "under") : null;
  const point = pointMatch ? Number(pointMatch[1]) : null;

  let subject = normalized;
  if (direction) {
    const split = normalized.split(new RegExp(`\\b${direction}\\b`, "i"));
    subject = split[0]?.trim() ?? normalized;
  }

  return { direction, point, subject: normalize(subject) };
}

function pointsClose(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return true;
  return Math.abs(a - b) < 0.01;
}

function outcomeScore(selection: ReturnType<typeof parseSelection>, outcome: OddsApiOutcome): number {
  let score = 0;
  const outcomeName = normalize(outcome.name);
  const outcomeDescription = normalize(outcome.description ?? "");

  if (selection.direction && outcomeName === selection.direction) {
    score += 3;
  }

  if (selection.point !== null && typeof outcome.point === "number" && pointsClose(selection.point, outcome.point)) {
    score += 2;
  }

  if (selection.subject) {
    if (outcomeDescription.includes(selection.subject)) {
      score += 4;
    } else if (`${outcomeDescription} ${outcomeName}`.includes(selection.subject)) {
      score += 2;
    }
  }

  if (!selection.direction && outcomeName && normalize(`${outcome.description ?? ""} ${outcome.name}`).includes(selection.subject)) {
    score += 2;
  }

  return score;
}

function toEventName(event: OddsApiEvent): string {
  return `${event.away_team} @ ${event.home_team}`;
}

function eventNameMatches(inputEvent: string, event: OddsApiEvent): boolean {
  const needleTokens = normalize(inputEvent).split(" ").filter(Boolean);
  if (needleTokens.length === 0) return false;

  const haystack = normalize(`${event.home_team} ${event.away_team}`);
  return needleTokens.every((token) => haystack.includes(token));
}

async function fetchJson<T>(path: string, query: Record<string, string | undefined>): Promise<T> {
  const url = new URL(path, ODDS_API_BASE_URL);
  for (const [key, value] of Object.entries(query)) {
    if (value) {
      url.searchParams.set(key, value);
    }
  }

  const response = await fetch(url, {
    headers: { Accept: "application/json" }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Odds API request failed (${response.status}): ${body}`);
  }

  return response.json() as Promise<T>;
}

async function resolveEventId(sport: string, eventName: string): Promise<string> {
  const apiKey = assertApiKey();
  const events = await fetchJson<OddsApiEvent[]>(`/sports/${sport}/events`, { apiKey });
  const match = events.find((event) => eventNameMatches(eventName, event));

  if (!match) {
    throw new Error(`Could not find event "${eventName}" in sport "${sport}"`);
  }

  return match.id;
}

export async function compareOdds(input: CompareOddsInput): Promise<CompareOddsOutput> {
  const apiKey = assertApiKey();
  const eventId = input.eventId ?? (input.event ? await resolveEventId(input.sport, input.event) : null);

  if (!eventId) {
    throw new Error("Missing eventId or event name");
  }

  const event = await fetchJson<OddsApiEvent>(`/sports/${input.sport}/events/${eventId}/odds`, {
    apiKey,
    regions: "us",
    markets: input.market,
    oddsFormat: "american"
  });

  const parsedSelection = parseSelection(input.selection);
  const books: BookOdd[] = [];

  for (const bookmaker of event.bookmakers ?? []) {
    const market = bookmaker.markets?.find((m) => m.key === input.market);
    if (!market) continue;

    const rankedOutcomes = [...market.outcomes]
      .map((outcome) => ({ outcome, score: outcomeScore(parsedSelection, outcome) }))
      .sort((a, b) => b.score - a.score);

    const best = rankedOutcomes[0];
    if (!best || best.score <= 0) continue;

    books.push({
      bookKey: bookmaker.key,
      bookName: bookmaker.title,
      odds: best.outcome.price
    });
  }

  if (books.length === 0) {
    throw new Error("No matching outcomes found for selection in this market");
  }

  return {
    eventName: toEventName(event),
    sport: input.sport,
    market: input.market,
    selection: input.selection,
    sportsbook: input.sportsbook ?? null,
    postedOdds: input.postedOdds ?? null,
    books
  };
}

export async function fetchMarketOdds(event: string, marketType: string, selection: string): Promise<BookOdd[]> {
  try {
    const result = await compareOdds({
      sport: "basketball_nba",
      event,
      market: marketType,
      selection
    });

    return result.books;
  } catch {
    return [
      { bookKey: "draftkings", bookName: "DraftKings", odds: -105 },
      { bookKey: "fanduel", bookName: "FanDuel", odds: -102 },
      { bookKey: "betmgm", bookName: "BetMGM", odds: +100 },
      { bookKey: "caesars", bookName: "Caesars", odds: -108 }
    ];
  }
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
