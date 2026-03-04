import {
  extractBestEffortLegCandidates,
  extractJsonFromNextData,
  extractJsonScriptBlocks,
  fetchHtmlWithDomainGuard,
  toStringOrUndefined
} from "./genericEmbeddedJson.js";
import type { EnrichedSlip, ShareLinkAdapter } from "./types.js";

const SHARE_PARAM_KEYS = ["shareId", "share_id", "slip", "betslip", "id"];

export const exampleEmbeddedJsonAdapter: ShareLinkAdapter = {
  id: "generic-nextjs-share",
  hostnames: ["bet365.com", "hardrock.bet"],

  canHandle(url: URL): boolean {
    return this.hostnames.some((domain) => url.hostname.toLowerCase().includes(domain));
  },

  extractShareId(url: URL): string | null {
    for (const key of SHARE_PARAM_KEYS) {
      const value = url.searchParams.get(key);
      if (value?.trim()) return value.trim();
    }

    const pathParts = url.pathname.split("/").filter(Boolean);
    const tail = pathParts[pathParts.length - 1];
    return tail && tail.length >= 6 ? tail : null;
  },

  async fetchAndParse(_shareId: string, url: URL): Promise<EnrichedSlip | null> {
    const html = await fetchHtmlWithDomainGuard(url, 12000);
    if (!html) {
      return null;
    }

    const jsonSources: unknown[] = [];
    const nextData = extractJsonFromNextData(html);
    if (nextData) {
      jsonSources.push(nextData);
    }

    jsonSources.push(...extractJsonScriptBlocks(html));

    for (const source of jsonSources) {
      const rows = extractBestEffortLegCandidates(source);
      const legs = rows
        .map((row) => {
          const eventName = toStringOrUndefined(row.eventName ?? row.event ?? row.fixture ?? row.matchName);
          const market = toStringOrUndefined(row.market ?? row.marketName ?? row.betType);
          const selection = toStringOrUndefined(row.selection ?? row.pick ?? row.outcome ?? row.outcomeName);
          const line = toStringOrUndefined(row.line ?? row.point ?? row.handicap);
          const odds = toStringOrUndefined(row.odds ?? row.price ?? row.americanOdds);

          if (!eventName || !market || !selection) {
            return null;
          }

          return { eventName, market, selection, line, odds };
        })
        .filter((row): row is NonNullable<typeof row> => Boolean(row));

      if (legs.length > 0) {
        return {
          type: legs.length > 1 ? "parlay" : "single",
          legs,
          notes: ["Enriched from public embedded JSON"]
        };
      }
    }

    // TODO: Add sportsbook-specific mappers once real share payload samples are captured.
    return null;
  }
};

