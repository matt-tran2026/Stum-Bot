import { createHash } from "node:crypto";
import type { BetLinkPayload } from "../betPayload.js";
import { TtlCache, TEN_MINUTES_MS } from "./cache.js";
import { findAdapter } from "./adapters/registry.js";
import type { EnrichedSlip } from "./adapters/types.js";
import { validateCardInput, type CardInput } from "./schema.js";
import { renderBetCardCanvas } from "./renderer.canvas.js";
import { renderBetCardPlaywright } from "./renderer.playwright.js";

export type OddsCompareResponse = {
  eventName: string;
  sport: string;
  market: string;
  selection: string;
  sportsbook: string | null;
  postedOdds: number | null;
  books: Array<{
    bookKey: string;
    bookName: string;
    odds: number;
  }>;
};

export type BuildCardOptions = {
  sourceUrl?: string;
  includeCompare: boolean;
  enableScrapers: boolean;
  notes?: string[];
};

export type BuildShareCardOptions = {
  sourceUrl: string;
  includeCompare?: boolean;
  enableScrapers: boolean;
  notes?: string[];
};

const enrichedSlipCache = new TtlCache<EnrichedSlip | null>(TEN_MINUTES_MS);
const renderedCardCache = new TtlCache<Buffer>(TEN_MINUTES_MS);

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

function toLineFromSelection(selection: string): string | undefined {
  const match = selection.match(/(-?\d+(?:\.\d+)?)/);
  return match?.[1];
}

function bookFromUrl(sourceUrl?: string): string | undefined {
  if (!sourceUrl) return undefined;

  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host.includes("bet365")) return "Bet365";
    if (host.includes("hardrock")) return "Hard Rock";
    return host.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

function toCardInputFromPayload(payload: BetLinkPayload, compare: OddsCompareResponse | null, notes: string[] = []): CardInput {
  return validateCardInput({
    book: payload.sportsbook,
    type: "single",
    header: {
      sport: payload.sport
    },
    main: {
      eventName: compare?.eventName ?? payload.event,
      market: payload.market,
      selection: payload.selection,
      line: toLineFromSelection(payload.selection),
      postedOdds: payload.postedOdds !== undefined ? formatOdds(payload.postedOdds) : undefined
    },
    compare: compare
      ? compare.books
          .slice()
          .sort((a, b) => b.odds - a.odds)
          .slice(0, 3)
          .map((row) => ({ book: row.bookName, odds: formatOdds(row.odds) }))
      : undefined,
    notes
  });
}

function toCardInputFromEnriched(slip: EnrichedSlip, sourceUrl: string, notes: string[] = []): CardInput {
  return validateCardInput({
    sourceUrl,
    book: bookFromUrl(sourceUrl),
    type: slip.type,
    header: {},
    main: {
      eventName: slip.legs[0]?.eventName,
      market: slip.legs[0]?.market,
      selection: slip.legs[0]?.selection,
      line: slip.legs[0]?.line,
      postedOdds: slip.legs[0]?.odds
    },
    legs: slip.legs,
    notes: [...(slip.notes ?? []), ...notes]
  });
}

async function tryEnrich(sourceUrl: string): Promise<EnrichedSlip | null> {
  let url: URL;
  try {
    url = new URL(sourceUrl);
  } catch {
    return null;
  }

  const adapter = findAdapter(url);
  if (!adapter) {
    return null;
  }

  const shareId = adapter.extractShareId(url);
  if (!shareId) {
    return null;
  }

  const cacheKey = `${adapter.id}:${shareId}`;
  const cached = enrichedSlipCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const slip = await adapter.fetchAndParse(shareId, url);
    enrichedSlipCache.set(cacheKey, slip);
    return slip;
  } catch {
    enrichedSlipCache.set(cacheKey, null);
    return null;
  }
}

function mergeEnrichedCard(
  baseInput: CardInput,
  enriched: EnrichedSlip,
  sourceUrl: string | undefined,
  includeCompare: boolean
): CardInput {
  const card: CardInput = {
    ...baseInput,
    sourceUrl,
    type: enriched.type,
    legs: enriched.legs,
    main: {
      ...baseInput.main,
      eventName: enriched.legs[0]?.eventName ?? baseInput.main.eventName,
      market: enriched.legs[0]?.market ?? baseInput.main.market,
      selection: enriched.legs[0]?.selection ?? baseInput.main.selection,
      line: enriched.legs[0]?.line ?? baseInput.main.line,
      postedOdds: enriched.legs[0]?.odds ?? baseInput.main.postedOdds
    },
    stake: enriched.stake,
    payout: enriched.payout,
    notes: [...(baseInput.notes ?? []), ...(enriched.notes ?? [])],
    book: baseInput.book ?? bookFromUrl(sourceUrl)
  };

  if (!includeCompare) {
    card.compare = undefined;
  }

  return validateCardInput(card);
}

function buildRenderCacheKey(input: CardInput): string {
  const hash = createHash("sha256");
  hash.update(JSON.stringify(input));
  return hash.digest("hex");
}

async function renderWithFallback(input: CardInput, enableScrapers: boolean): Promise<Buffer> {
  try {
    return await renderBetCardCanvas(input);
  } catch (canvasErr) {
    if (!enableScrapers) {
      throw canvasErr;
    }
    return renderBetCardPlaywright(input);
  }
}

async function renderCached(input: CardInput, enableScrapers: boolean): Promise<Buffer> {
  const cacheKey = buildRenderCacheKey(input);
  const cached = renderedCardCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const image = await renderWithFallback(input, enableScrapers);
  renderedCardCache.set(cacheKey, image);
  return image;
}

export async function tryEnrichShareLink(sourceUrl: string): Promise<EnrichedSlip | null> {
  return tryEnrich(sourceUrl);
}

export async function buildBetCardImageFromShareUrl(
  options: BuildShareCardOptions
): Promise<{ image: Buffer; input: CardInput } | null> {
  const enriched = await tryEnrich(options.sourceUrl);
  if (!enriched) {
    return null;
  }

  const input = toCardInputFromEnriched(enriched, options.sourceUrl, options.notes);
  if (options.includeCompare === false) {
    input.compare = undefined;
  }

  const image = await renderCached(input, options.enableScrapers);
  return { image, input };
}

export async function buildBetCardImage(
  payload: BetLinkPayload,
  compare: OddsCompareResponse | null,
  options: BuildCardOptions
): Promise<{ image: Buffer; input: CardInput }> {
  const base = toCardInputFromPayload(payload, options.includeCompare ? compare : null, options.notes);

  let input = base;
  if (options.sourceUrl) {
    const enriched = await tryEnrich(options.sourceUrl);
    if (enriched) {
      input = mergeEnrichedCard(base, enriched, options.sourceUrl, options.includeCompare);
    }
  }

  const image = await renderCached(input, options.enableScrapers);
  return { image, input };
}

export type { CardInput } from "./schema.js";
