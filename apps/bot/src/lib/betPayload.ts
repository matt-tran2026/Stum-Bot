import { scrapeBetFromLink } from "./scrapers.js";

export type BetLinkPayload = {
  sport: string;
  market: string;
  selection: string;
  event?: string;
  eventId?: string;
  sportsbook?: string;
  postedOdds?: number;
};

export type ParseBetPayloadOptions = {
  enableScrapers: boolean;
  scraperTimeoutMs: number;
};

function normalizeBookFromHostname(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  if (host.includes("bet365")) return "Bet365";
  if (host.includes("fanduel")) return "FanDuel";
  if (host.includes("draftkings")) return "DraftKings";
  if (host.includes("caesars")) return "Caesars";
  if (host.includes("betmgm")) return "BetMGM";
  return undefined;
}

function parseBetLink(link: string): BetLinkPayload | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }

  const sport =
    url.searchParams.get("sport") ??
    url.searchParams.get("sport_key") ??
    url.searchParams.get("league");

  const market =
    url.searchParams.get("market") ??
    url.searchParams.get("market_key") ??
    url.searchParams.get("bet_type");

  const selection =
    url.searchParams.get("selection") ??
    url.searchParams.get("pick") ??
    url.searchParams.get("outcome");

  const eventId =
    url.searchParams.get("event_id") ??
    url.searchParams.get("eventId");

  const event =
    url.searchParams.get("event") ??
    url.searchParams.get("event_name");

  const sportsbook =
    url.searchParams.get("sportsbook") ??
    url.searchParams.get("book") ??
    url.searchParams.get("bookmaker") ??
    normalizeBookFromHostname(url.hostname);

  const postedOddsRaw = url.searchParams.get("odds") ?? url.searchParams.get("price");
  const postedOdds = postedOddsRaw ? Number(postedOddsRaw) : undefined;

  if (!sport || !market || !selection || (!eventId && !event)) {
    return null;
  }

  return {
    sport,
    market,
    selection,
    event: event ?? undefined,
    eventId: eventId ?? undefined,
    sportsbook,
    postedOdds: Number.isFinite(postedOdds) ? postedOdds : undefined
  };
}

function parseManualBetDetails(input: string): Partial<BetLinkPayload> {
  const fields: Partial<BetLinkPayload> = {};
  const regex = /(sport|market|selection|event|event_id|eventid|sportsbook|book|bookmaker|odds|price)\s*[:=]\s*([^|\n]+)/gi;

  for (const match of input.matchAll(regex)) {
    const key = match[1].toLowerCase().trim();
    const rawValue = match[2].trim();
    if (!rawValue) continue;

    if (key === "sport") fields.sport = rawValue;
    if (key === "market") fields.market = rawValue;
    if (key === "selection") fields.selection = rawValue;
    if (key === "event") fields.event = rawValue;
    if (key === "event_id" || key === "eventid") fields.eventId = rawValue;
    if (key === "sportsbook" || key === "book" || key === "bookmaker") fields.sportsbook = rawValue;
    if (key === "odds" || key === "price") {
      const oddsNum = Number(rawValue);
      if (Number.isFinite(oddsNum)) fields.postedOdds = oddsNum;
    }
  }

  return fields;
}

function mergeBetDetails(base: BetLinkPayload | null, extras: Partial<BetLinkPayload>): BetLinkPayload | null {
  const sport = extras.sport ?? base?.sport;
  const market = extras.market ?? base?.market;
  const selection = extras.selection ?? base?.selection;
  const event = extras.event ?? base?.event;
  const eventId = extras.eventId ?? base?.eventId;

  if (!sport || !market || !selection || (!event && !eventId)) {
    return null;
  }

  return {
    sport,
    market,
    selection,
    event,
    eventId,
    sportsbook: extras.sportsbook ?? base?.sportsbook,
    postedOdds: extras.postedOdds ?? base?.postedOdds
  };
}

export function extractFirstUrl(input: string): string | null {
  const match = input.match(/https?:\/\/\S+/i);
  return match ? match[0] : null;
}

async function parseBetLinkWithRedirect(rawInput: string): Promise<BetLinkPayload | null> {
  const extractedUrl = extractFirstUrl(rawInput);
  const link = extractedUrl ?? rawInput.trim();
  const direct = parseBetLink(link);
  const manual = parseManualBetDetails(rawInput);

  if (direct) {
    return mergeBetDetails(direct, manual);
  }

  if (!extractedUrl) {
    return mergeBetDetails(null, manual);
  }

  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return mergeBetDetails(null, manual);
  }

  if (!url.hostname.toLowerCase().includes("bet365")) {
    return mergeBetDetails(null, manual);
  }

  try {
    const response = await fetch(link, {
      method: "GET",
      redirect: "follow"
    });

    if (!response.url || response.url === link) {
      return mergeBetDetails(null, manual);
    }

    const redirectedUrl = new URL(response.url);
    if (!redirectedUrl.hostname.toLowerCase().includes("bet365")) {
      return mergeBetDetails(null, manual);
    }

    const redirected = parseBetLink(response.url);
    return mergeBetDetails(redirected, manual);
  } catch {
    return mergeBetDetails(null, manual);
  }
}

export async function parseAnyBetPayload(
  input: string,
  options: ParseBetPayloadOptions
): Promise<BetLinkPayload | null> {
  const direct = await parseBetLinkWithRedirect(input);
  if (direct) {
    return direct;
  }

  const fragments = input.split("|").map((part) => part.trim()).filter(Boolean);
  for (const fragment of fragments) {
    const parsed = await parseBetLinkWithRedirect(fragment);
    if (parsed) {
      return parsed;
    }
  }

  if (options.enableScrapers) {
    const link = extractFirstUrl(input);
    if (link) {
      const scraped = await scrapeBetFromLink(link, { timeoutMs: options.scraperTimeoutMs });
      if (scraped) {
        return mergeBetDetails(null, scraped);
      }
    }
  }

  return null;
}

