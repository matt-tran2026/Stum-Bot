import type { CardInput } from "./schema.js";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildHtml(input: CardInput): string {
  const compare = (input.compare?.length ? input.compare : [{ book: "No compare data", odds: "-" }])
    .slice(0, 3)
    .map((row) => `<div class="row"><span>${escapeHtml(row.book)}</span><strong>${escapeHtml(row.odds)}</strong></div>`)
    .join("");

  const legs = (input.legs ?? [])
    .map((leg) => `
      <div class="leg">
        <div class="event">${escapeHtml(leg.eventName)}</div>
        <div class="meta">${escapeHtml([leg.market, leg.selection, leg.line].filter(Boolean).join(" | "))}</div>
        <div class="odds">${escapeHtml(leg.odds ?? "")}</div>
      </div>
    `)
    .join("");

  return `
    <html>
      <head>
        <style>
          * { box-sizing: border-box; font-family: Arial, sans-serif; }
          body { margin: 0; background: #0d1524; }
          .card {
            width: 900px;
            padding: 28px;
            color: #f6f9ff;
            background: linear-gradient(135deg, #0b1220, #1a2337);
          }
          .title { font-size: 34px; font-weight: 700; }
          .sub { margin-top: 6px; color: #9fb4d8; font-size: 18px; }
          .hero {
            margin-top: 20px;
            background: #151f32;
            border-radius: 12px;
            padding: 16px;
          }
          .hero .event { font-size: 24px; font-weight: 700; }
          .hero .meta { color: #c9d8f6; margin-top: 8px; line-height: 1.4; }
          .hero .posted { color: #9cffb6; margin-top: 8px; font-size: 26px; font-weight: 700; }
          .section { margin-top: 18px; }
          .section h3 { margin: 0 0 10px 0; font-size: 20px; }
          .leg {
            display: grid;
            grid-template-columns: 1fr auto;
            gap: 8px;
            background: #151f32;
            border-radius: 10px;
            padding: 12px;
            margin-bottom: 8px;
          }
          .leg .event { font-weight: 700; }
          .leg .meta { color: #c9d8f6; font-size: 14px; grid-column: 1; }
          .leg .odds { color: #9cffb6; font-weight: 700; grid-column: 2; grid-row: 1 / span 2; align-self: center; }
          .row { display: flex; justify-content: space-between; margin-bottom: 6px; color: #c9d8f6; }
          .row strong { color: #fff; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="title">${escapeHtml(input.book ?? "Sportsbook")} ${input.type === "parlay" ? "Parlay" : "Single"}</div>
          <div class="sub">${escapeHtml([input.header.sport, input.header.league].filter(Boolean).join(" • "))}</div>

          <div class="hero">
            <div class="event">${escapeHtml(input.main.eventName ?? input.legs?.[0]?.eventName ?? "Event")}</div>
            <div class="meta">${escapeHtml([input.main.market, input.main.selection, input.main.line].filter(Boolean).join(" | ") || "No market data")}</div>
            <div class="posted">${escapeHtml(input.main.postedOdds ?? "")}</div>
          </div>

          ${input.type === "parlay" && input.legs?.length ? `<div class="section"><h3>Legs</h3>${legs}</div>` : ""}

          <div class="section"><h3>Compare</h3>${compare}</div>
        </div>
      </body>
    </html>
  `;
}

export async function renderBetCardPlaywright(input: CardInput): Promise<Buffer> {
  const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
  const playwright = await dynamicImport("playwright") as {
    chromium: {
      launch: (opts: { headless: boolean }) => Promise<{
        newPage: () => Promise<{
          setContent: (html: string, opts: { waitUntil: "domcontentloaded" }) => Promise<void>;
          waitForTimeout: (ms: number) => Promise<void>;
          locator: (selector: string) => { screenshot: (opts: { type: "png" }) => Promise<Buffer> };
        }>;
        close: () => Promise<void>;
      }>;
    };
  };

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(buildHtml(input), { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(40);
    const image = await page.locator(".card").screenshot({ type: "png" });
    return image;
  } finally {
    await browser.close();
  }
}

