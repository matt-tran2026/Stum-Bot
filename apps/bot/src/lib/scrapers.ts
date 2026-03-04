export type ScrapedBetFields = {
  sport?: string;
  market?: string;
  selection?: string;
  event?: string;
  eventId?: string;
  sportsbook?: string;
  postedOdds?: number;
};

type ScrapeOptions = {
  timeoutMs: number;
};

type RenderedResult = {
  finalUrl: URL;
  html: string;
  payloads: string[];
};

function hostToSportsbook(hostname: string): string | undefined {
  const host = hostname.toLowerCase();
  if (host.includes("bet365")) return "bet365";
  if (host.includes("hardrock")) return "hardrock";
  return undefined;
}

function shouldScrape(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host.includes("bet365") || host.includes("hardrock");
}

function extractString(html: string, patterns: RegExp[]): string | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) {
      return decodeURIComponent(match[1]).trim();
    }
  }
  return undefined;
}

function extractNumber(html: string, patterns: RegExp[]): number | undefined {
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (!match?.[1]) continue;
    const value = Number(match[1]);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function collectByKey(input: unknown, wantedKeys: Set<string>, out: string[], depth = 0): void {
  if (depth > 8 || out.length > 120) return;

  if (Array.isArray(input)) {
    for (const item of input) {
      collectByKey(item, wantedKeys, out, depth + 1);
    }
    return;
  }

  if (!isRecord(input)) {
    return;
  }

  for (const [key, value] of Object.entries(input)) {
    const keyNorm = key.toLowerCase();
    if (wantedKeys.has(keyNorm) && typeof value === "string" && value.trim()) {
      out.push(value.trim());
    } else {
      collectByKey(value, wantedKeys, out, depth + 1);
    }
  }
}

function collectNumberByKey(input: unknown, wantedKeys: Set<string>, depth = 0): number | undefined {
  if (depth > 8) return undefined;

  if (Array.isArray(input)) {
    for (const item of input) {
      const found = collectNumberByKey(item, wantedKeys, depth + 1);
      if (found !== undefined) return found;
    }
    return undefined;
  }

  if (!isRecord(input)) {
    return undefined;
  }

  for (const [key, value] of Object.entries(input)) {
    const keyNorm = key.toLowerCase();
    if (wantedKeys.has(keyNorm)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        return value;
      }
      if (typeof value === "string") {
        const maybe = Number(value);
        if (Number.isFinite(maybe)) {
          return maybe;
        }
      }
    }

    const found = collectNumberByKey(value, wantedKeys, depth + 1);
    if (found !== undefined) return found;
  }

  return undefined;
}

function normalizeSport(sport: string | undefined): string | undefined {
  if (!sport) return undefined;
  const normalized = sport.toLowerCase().replace(/\s+/g, "_");
  if (normalized.includes("nba") || normalized.includes("basketball")) return "basketball_nba";
  if (normalized.includes("nfl") || normalized.includes("american_football")) return "americanfootball_nfl";
  if (normalized.includes("nhl") || normalized.includes("ice_hockey")) return "icehockey_nhl";
  if (normalized.includes("mlb") || normalized.includes("baseball")) return "baseball_mlb";
  return normalized;
}

function extractFieldsFromHtml(html: string, sourceUrl: URL): ScrapedBetFields | null {
  const sport = normalizeSport(
    extractString(html, [
      /"sport_key"\s*:\s*"([^"]+)"/i,
      /"sportKey"\s*:\s*"([^"]+)"/i,
      /"sport"\s*:\s*"([^"]+)"/i
    ])
  );

  const market = extractString(html, [
    /"market_key"\s*:\s*"([^"]+)"/i,
    /"marketKey"\s*:\s*"([^"]+)"/i,
    /"market"\s*:\s*"([^"]+)"/i
  ]);

  const selection = extractString(html, [
    /"selection"\s*:\s*"([^"]+)"/i,
    /"selectionName"\s*:\s*"([^"]+)"/i,
    /"outcomeName"\s*:\s*"([^"]+)"/i
  ]);

  const event = extractString(html, [
    /"event_name"\s*:\s*"([^"]+)"/i,
    /"eventName"\s*:\s*"([^"]+)"/i,
    /"matchName"\s*:\s*"([^"]+)"/i
  ]);

  const eventId = extractString(html, [
    /"event_id"\s*:\s*"([^"]+)"/i,
    /"eventId"\s*:\s*"([^"]+)"/i
  ]);

  const postedOdds = extractNumber(html, [
    /"odds"\s*:\s*([+-]?\d{2,4})/i,
    /"americanOdds"\s*:\s*([+-]?\d{2,4})/i,
    /"priceAmerican"\s*:\s*([+-]?\d{2,4})/i
  ]);

  const sportsbook = hostToSportsbook(sourceUrl.hostname);

  if (!sport || !market || !selection || (!event && !eventId)) {
    return null;
  }

  return {
    sport,
    market,
    selection,
    event,
    eventId,
    sportsbook,
    postedOdds
  };
}

function extractFieldsFromJsonPayload(payload: string, sourceUrl: URL): ScrapedBetFields | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }

  const sportCandidates: string[] = [];
  collectByKey(parsed, new Set(["sport", "sportkey", "sport_key", "league", "leaguekey", "league_key"]), sportCandidates);

  const marketCandidates: string[] = [];
  collectByKey(parsed, new Set(["market", "marketkey", "market_key", "markettype", "bettype", "bet_type"]), marketCandidates);

  const selectionCandidates: string[] = [];
  collectByKey(
    parsed,
    new Set(["selection", "selectionname", "outcome", "outcomename", "pick", "pickname", "runnername"]),
    selectionCandidates
  );

  const eventCandidates: string[] = [];
  collectByKey(parsed, new Set(["event", "eventname", "event_name", "matchname", "fixture", "fixture_name"]), eventCandidates);

  const eventIdCandidates: string[] = [];
  collectByKey(parsed, new Set(["eventid", "event_id", "fixtureid", "fixture_id", "gameid", "game_id"]), eventIdCandidates);

  const postedOdds = collectNumberByKey(parsed, new Set(["odds", "americanodds", "price", "priceamerican", "line"]));

  const sport = normalizeSport(sportCandidates[0]);
  const market = marketCandidates[0];
  const selection = selectionCandidates[0];
  const event = eventCandidates[0];
  const eventId = eventIdCandidates[0];
  const sportsbook = hostToSportsbook(sourceUrl.hostname);

  if (!sport || !market || !selection || (!event && !eventId)) {
    return null;
  }

  return {
    sport,
    market,
    selection,
    event,
    eventId,
    sportsbook,
    postedOdds
  };
}

async function fetchHtml(url: string, timeoutMs: number): Promise<{ finalUrl: URL; html: string } | null> {
  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("text/html")) {
    return null;
  }

  const html = await response.text();
  if (!html.trim()) {
    return null;
  }

  return {
    finalUrl: new URL(response.url || url),
    html
  };
}

async function fetchRenderedHtml(url: string, timeoutMs: number): Promise<RenderedResult | null> {
  let playwright: unknown;
  try {
    const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
    playwright = await dynamicImport("playwright");
  } catch {
    return null;
  }

  const chromium = (playwright as { chromium?: { launch: (opts: { headless: boolean }) => Promise<unknown> } }).chromium;

  if (!chromium) {
    return null;
  }

  const browser = await chromium.launch({ headless: true }) as {
    newContext: (opts: Record<string, unknown>) => Promise<unknown>;
    close: () => Promise<void>;
  };
  try {
    const context = await browser.newContext({
      locale: "en-US",
      timezoneId: "America/New_York",
      geolocation: { latitude: 40.7128, longitude: -74.006 },
      permissions: ["geolocation"],
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36"
    }) as {
      newPage: () => Promise<unknown>;
      close: () => Promise<void>;
    };
    try {
      const page = await context.newPage() as {
        on: (event: "response", handler: (response: { url: () => string; headers: () => Record<string, string>; text: () => Promise<string> }) => void | Promise<void>) => void;
        goto: (target: string, opts: { waitUntil: "domcontentloaded"; timeout: number }) => Promise<void>;
        waitForTimeout: (ms: number) => Promise<void>;
        content: () => Promise<string>;
        url: () => string;
      };
      const payloads: string[] = [];

      page.on("response", async (response: { url: () => string; headers: () => Record<string, string>; text: () => Promise<string> }) => {
        try {
          const headers = response.headers();
          const contentType = (headers["content-type"] ?? headers["Content-Type"] ?? "").toLowerCase();
          const responseUrl = response.url().toLowerCase();
          const looksUseful = contentType.includes("application/json")
            || responseUrl.includes("betslip")
            || responseUrl.includes("odds")
            || responseUrl.includes("selection")
            || responseUrl.includes("market");

          if (!looksUseful) {
            return;
          }

          const body = await response.text();
          if (body && body.length > 20 && body.length < 800_000) {
            payloads.push(body);
          }
        } catch {
          // ignore failed response parsing
        }
      });

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
      await page.waitForTimeout(5000);
      const html = await page.content();
      const finalUrl = new URL(page.url());
      return { finalUrl, html, payloads };
    } finally {
      await context.close();
    }
  } finally {
    await browser.close();
  }
}

export async function scrapeBetFromLink(rawLink: string, options: ScrapeOptions): Promise<ScrapedBetFields | null> {
  let url: URL;
  try {
    url = new URL(rawLink);
  } catch {
    return null;
  }

  if (!shouldScrape(url.hostname)) {
    return null;
  }

  try {
    const htmlResult = await fetchHtml(rawLink, options.timeoutMs);
    if (htmlResult) {
      const parsed = extractFieldsFromHtml(htmlResult.html, htmlResult.finalUrl);
      if (parsed) {
        return parsed;
      }
    }
  } catch {
    // fall through to rendered scraping
  }

  try {
    const renderedResult = await fetchRenderedHtml(rawLink, options.timeoutMs);
    if (!renderedResult) {
      return null;
    }

    for (const payload of renderedResult.payloads) {
      const parsedPayload = extractFieldsFromJsonPayload(payload, renderedResult.finalUrl);
      if (parsedPayload) {
        return parsedPayload;
      }

      const parsedPayloadHtml = extractFieldsFromHtml(payload, renderedResult.finalUrl);
      if (parsedPayloadHtml) {
        return parsedPayloadHtml;
      }
    }

    return extractFieldsFromHtml(renderedResult.html, renderedResult.finalUrl);
  } catch {
    return null;
  }
}
