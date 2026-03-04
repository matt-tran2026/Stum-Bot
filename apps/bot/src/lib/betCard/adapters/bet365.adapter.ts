import {
  extractJsonFromNextData,
  extractJsonScriptBlocks,
  fetchHtmlWithDomainGuard,
  toStringOrUndefined
} from "./genericEmbeddedJson.js";
import type { EnrichedLeg, EnrichedSlip, ShareLinkAdapter } from "./types.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function collectRecords(input: unknown, out: Array<Record<string, unknown>>, depth = 0): void {
  if (depth > 10 || out.length > 1500) {
    return;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      collectRecords(item, out, depth + 1);
    }
    return;
  }

  if (!isRecord(input)) {
    return;
  }

  out.push(input);
  for (const value of Object.values(input)) {
    collectRecords(value, out, depth + 1);
  }
}

function bestString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = toStringOrUndefined(record[key]);
    if (value) {
      return value;
    }
  }
  return undefined;
}

function eventFromTeams(record: Record<string, unknown>): string | undefined {
  const home = bestString(record, ["homeTeam", "home_team", "home"]);
  const away = bestString(record, ["awayTeam", "away_team", "away"]);
  if (home && away) {
    return `${away} @ ${home}`;
  }
  return undefined;
}

function mapRecordToLeg(record: Record<string, unknown>): EnrichedLeg | null {
  const eventName = bestString(record, ["eventName", "event_name", "event", "fixture", "fixtureName", "matchName"])
    ?? eventFromTeams(record);

  const market = bestString(record, ["marketName", "market", "marketType", "betType", "lineType"]);
  const selection = bestString(record, ["selectionName", "selection", "outcomeName", "outcome", "pick", "runnerName", "name"]);
  const line = bestString(record, ["line", "point", "points", "handicap", "total"]);
  const odds = bestString(record, ["americanOdds", "displayOdds", "oddsAmerican", "odds", "price"]);

  if (!market || !selection) {
    return null;
  }

  return {
    eventName: eventName ?? "Bet365 Event",
    market,
    selection,
    line,
    odds
  };
}

function normalizeOdds(raw?: string): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (/^[+-]\d+$/.test(trimmed)) {
    return trimmed;
  }

  const n = Number(trimmed);
  if (Number.isFinite(n) && Math.abs(n) >= 100) {
    return n > 0 ? `+${n}` : `${n}`;
  }

  return undefined;
}

function normalizeLegs(legs: EnrichedLeg[]): EnrichedLeg[] {
  const dedupe = new Set<string>();
  const normalized: EnrichedLeg[] = [];

  for (const leg of legs) {
    const cleaned: EnrichedLeg = {
      ...leg,
      odds: normalizeOdds(leg.odds)
    };

    const key = `${cleaned.eventName}|${cleaned.market}|${cleaned.selection}|${cleaned.line ?? ""}|${cleaned.odds ?? ""}`.toLowerCase();
    if (dedupe.has(key)) {
      continue;
    }

    dedupe.add(key);
    normalized.push(cleaned);
  }

  return normalized;
}

function legsFromUnknown(input: unknown): EnrichedLeg[] {
  const records: Array<Record<string, unknown>> = [];
  collectRecords(input, records);

  return normalizeLegs(
    records
      .map(mapRecordToLeg)
      .filter((leg): leg is EnrichedLeg => Boolean(leg))
  );
}

function parseJsonLikeValue(value: string): unknown | null {
  const candidates = [value, decodeURIComponent(value)];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // keep trying
    }
  }
  return null;
}

function extractParamJson(url: URL): unknown[] {
  const parsed: unknown[] = [];
  for (const [, value] of url.searchParams.entries()) {
    if (!value) continue;
    if (!(value.includes("{") || value.includes("[") || value.includes("%7B") || value.includes("%5B"))) {
      continue;
    }

    const json = parseJsonLikeValue(value);
    if (json) {
      parsed.push(json);
    }
  }

  return parsed;
}

function extractShareIdFromPath(url: URL): string | null {
  const parts = url.pathname.split("/").filter(Boolean);
  const tail = parts[parts.length - 1];
  return tail && tail.length >= 6 ? tail : null;
}

async function collectHtmlSources(url: URL): Promise<unknown[]> {
  const html = await fetchHtmlWithDomainGuard(url, 12000);
  if (!html) {
    return [];
  }

  const out: unknown[] = [];
  const next = extractJsonFromNextData(html);
  if (next) out.push(next);
  out.push(...extractJsonScriptBlocks(html));

  // Some Bet365 pages embed escaped JSON blobs in JS assignments.
  const inlineJsonRegex = /({\"[^<]{80,}?\"})/g;
  for (const match of html.matchAll(inlineJsonRegex)) {
    const raw = match[1];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw.replace(/\\"/g, '"'));
      out.push(parsed);
    } catch {
      // ignore
    }
  }

  return out;
}

export const bet365ShareAdapter: ShareLinkAdapter = {
  id: "bet365-share",
  hostnames: ["bet365.com"],

  canHandle(url: URL): boolean {
    return url.hostname.toLowerCase().includes("bet365");
  },

  extractShareId(url: URL): string | null {
    for (const key of ["shareId", "share_id", "slip", "betslip", "id"]) {
      const value = url.searchParams.get(key);
      if (value?.trim()) {
        return value.trim();
      }
    }

    return extractShareIdFromPath(url);
  },

  async fetchAndParse(_shareId: string, url: URL): Promise<EnrichedSlip | null> {
    const sources: unknown[] = [];
    sources.push(...extractParamJson(url));

    try {
      const htmlSources = await collectHtmlSources(url);
      sources.push(...htmlSources);
    } catch (error) {
      console.error("bet365 adapter HTML fetch failed:", error);
    }

    for (const source of sources) {
      const legs = legsFromUnknown(source);
      if (legs.length > 0) {
        return {
          type: legs.length > 1 ? "parlay" : "single",
          legs,
          notes: ["Bet365 public share enrichment"]
        };
      }
    }

    return null;
  }
};
