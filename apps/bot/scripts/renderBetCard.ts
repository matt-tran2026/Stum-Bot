import "dotenv/config";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { buildBetCardImage, type OddsCompareResponse } from "../src/lib/betCard/index.js";
import { parseAnyBetPayload, type BetLinkPayload } from "../src/lib/betPayload.js";

const enableScrapers = (process.env.ENABLE_SCRAPERS ?? "true").toLowerCase() === "true";
const scraperTimeoutMs = Number(process.env.SCRAPER_TIMEOUT_MS ?? 15000);
const apiBaseUrl = process.env.API_BASE_URL;
const includeCompare = (process.env.BET_CARD_INCLUDE_COMPARE ?? "true").toLowerCase() === "true";

function formatOdds(odds: number): string {
  return odds > 0 ? `+${odds}` : `${odds}`;
}

async function compareOdds(payload: BetLinkPayload): Promise<OddsCompareResponse | null> {
  if (!apiBaseUrl) return null;

  try {
    const response = await fetch(`${apiBaseUrl}/odds/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(text);
    }

    return response.json() as Promise<OddsCompareResponse>;
  } catch (error) {
    console.error("Compare call failed:", error);
    return null;
  }
}

async function loadPayloadFromJson(pathArg: string): Promise<BetLinkPayload> {
  const absolute = resolve(pathArg);
  const raw = await readFile(absolute, "utf8");
  const parsed = JSON.parse(raw) as BetLinkPayload;

  if (!parsed.sport || !parsed.market || !parsed.selection || (!parsed.event && !parsed.eventId)) {
    throw new Error(`Invalid payload JSON in ${basename(absolute)}`);
  }

  return parsed;
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    throw new Error("Usage: npm --workspace @mvp/bot run render:card -- <bet-link-or-payload.json>");
  }

  let payload: BetLinkPayload | null = null;
  let sourceUrl: string | undefined;

  if (arg.startsWith("http://") || arg.startsWith("https://")) {
    sourceUrl = arg;
    payload = await parseAnyBetPayload(arg, { enableScrapers, scraperTimeoutMs });
  } else if (arg.endsWith(".json")) {
    payload = await loadPayloadFromJson(arg);
  } else {
    payload = await parseAnyBetPayload(arg, { enableScrapers, scraperTimeoutMs });
    const firstUrl = arg.match(/https?:\/\/\S+/i)?.[0];
    sourceUrl = firstUrl ?? undefined;
  }

  if (!payload) {
    throw new Error("Could not parse payload from input.");
  }

  const comparison = includeCompare ? await compareOdds(payload) : null;
  const result = await buildBetCardImage(payload, comparison, {
    sourceUrl,
    includeCompare,
    enableScrapers,
    notes: comparison ? undefined : ["No compare data"]
  });

  const outputPath = resolve("card.png");
  await writeFile(outputPath, result.image);

  console.log("Parsed payload:", JSON.stringify(payload, null, 2));
  console.log("Card input:", JSON.stringify(result.input, null, 2));
  if (comparison?.books?.length) {
    const top = comparison.books.slice().sort((a, b) => b.odds - a.odds).slice(0, 3);
    console.log("Top compare:", top.map((row) => `${row.bookName} ${formatOdds(row.odds)}`).join(", "));
  }
  console.log(`Wrote ${outputPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

