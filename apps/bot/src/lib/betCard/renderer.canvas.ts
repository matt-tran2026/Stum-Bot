import type { CardInput } from "./schema.js";

type CanvasModule = {
  createCanvas: (width: number, height: number) => {
    getContext: (type: "2d") => CanvasRenderingContext2D;
    toBuffer: (mime: "image/png") => Buffer;
  };
};

type CanvasRenderingContext2D = {
  fillStyle: string | CanvasGradient;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textBaseline: string;
  textAlign: "left" | "right" | "center";
  fillRect: (x: number, y: number, w: number, h: number) => void;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  stroke: () => void;
  fillText: (text: string, x: number, y: number) => void;
  roundRect: (x: number, y: number, w: number, h: number, r: number) => void;
  fill: () => void;
  measureText: (text: string) => { width: number };
  createLinearGradient: (x0: number, y0: number, x1: number, y1: number) => CanvasGradient;
};

type CanvasGradient = {
  addColorStop: (offset: number, color: string) => void;
};

const WIDTH = 900;
const PADDING = 36;
const LEG_ROW_HEIGHT = 68;

function ellipsis(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 3 && ctx.measureText(`${trimmed}...`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}...`;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 2): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth) {
      line = next;
      continue;
    }

    if (line) {
      lines.push(line);
      line = word;
    }

    if (lines.length >= maxLines - 1) {
      lines.push(ellipsis(ctx, line, maxWidth));
      return lines;
    }
  }

  if (line) lines.push(line);
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines - 1).concat(ellipsis(ctx, lines[maxLines - 1] ?? "", maxWidth));
  }

  return lines;
}

function calcHeight(input: CardInput): number {
  const legs = input.type === "parlay" ? Math.max(input.legs?.length ?? 0, 1) : 0;
  const compareRows = input.compare?.length ?? 0;
  const noteRows = input.notes?.length ?? 0;

  return 280 + (legs * LEG_ROW_HEIGHT) + (compareRows * 24) + (noteRows * 20);
}

async function importCanvas(): Promise<CanvasModule> {
  const dynamicImport = new Function("m", "return import(m)") as (m: string) => Promise<unknown>;
  return dynamicImport("@napi-rs/canvas") as Promise<CanvasModule>;
}

export async function renderBetCardCanvas(input: CardInput): Promise<Buffer> {
  const { createCanvas } = await importCanvas();
  const height = calcHeight(input);

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext("2d");

  const background = ctx.createLinearGradient(0, 0, WIDTH, height);
  background.addColorStop(0, "#0b1220");
  background.addColorStop(1, "#1a2337");

  ctx.fillStyle = background;
  ctx.fillRect(0, 0, WIDTH, height);

  ctx.fillStyle = "#f8fbff";
  ctx.font = "bold 32px Arial";
  ctx.textBaseline = "top";
  const title = `${input.book ?? "Sportsbook"}  ${input.type === "parlay" ? "Parlay" : "Single"}`;
  ctx.fillText(title, PADDING, PADDING);

  ctx.fillStyle = "#9fb4d8";
  ctx.font = "20px Arial";
  ctx.fillText([input.header.sport, input.header.league].filter(Boolean).join("  •  "), PADDING, PADDING + 44);

  let y = PADDING + 92;

  ctx.fillStyle = "#151f32";
  ctx.beginPath();
  ctx.roundRect(PADDING, y, WIDTH - PADDING * 2, input.type === "parlay" ? 90 : 132, 14);
  ctx.fill();

  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px Arial";
  const heading = input.main.eventName ?? input.legs?.[0]?.eventName ?? "Event";
  ctx.fillText(ellipsis(ctx, heading, WIDTH - PADDING * 3), PADDING + 20, y + 16);

  ctx.font = "20px Arial";
  const detail = [input.main.market, input.main.selection, input.main.line].filter(Boolean).join(" | ");
  ctx.fillStyle = "#c9d8f6";
  const detailLines = wrapText(ctx, detail || "No market data", WIDTH - PADDING * 3, 2);
  detailLines.forEach((line, idx) => ctx.fillText(line, PADDING + 20, y + 52 + idx * 24));

  if (input.main.postedOdds) {
    ctx.textAlign = "right";
    ctx.fillStyle = "#9cffb6";
    ctx.font = "bold 30px Arial";
    ctx.fillText(input.main.postedOdds, WIDTH - PADDING - 18, y + 26);
    ctx.textAlign = "left";
  }

  y += input.type === "parlay" ? 110 : 152;

  if (input.type === "parlay" && input.legs?.length) {
    ctx.fillStyle = "#f8fbff";
    ctx.font = "bold 22px Arial";
    ctx.fillText("Legs", PADDING, y);
    y += 34;

    for (const leg of input.legs) {
      ctx.fillStyle = "#151f32";
      ctx.beginPath();
      ctx.roundRect(PADDING, y, WIDTH - PADDING * 2, LEG_ROW_HEIGHT - 8, 10);
      ctx.fill();

      ctx.fillStyle = "#ffffff";
      ctx.font = "bold 18px Arial";
      ctx.fillText(ellipsis(ctx, leg.eventName, WIDTH - 280), PADDING + 16, y + 10);

      ctx.font = "16px Arial";
      ctx.fillStyle = "#c9d8f6";
      const sub = [leg.market, leg.selection, leg.line].filter(Boolean).join(" | ");
      ctx.fillText(ellipsis(ctx, sub, WIDTH - 280), PADDING + 16, y + 34);

      if (leg.odds) {
        ctx.textAlign = "right";
        ctx.fillStyle = "#9cffb6";
        ctx.font = "bold 22px Arial";
        ctx.fillText(leg.odds, WIDTH - PADDING - 14, y + 20);
        ctx.textAlign = "left";
      }

      y += LEG_ROW_HEIGHT;
    }
  }

  ctx.fillStyle = "#f8fbff";
  ctx.font = "bold 20px Arial";
  ctx.fillText("Compare", PADDING, y);
  y += 28;

  const compareRows = input.compare?.length ? input.compare : [{ book: "No compare data", odds: "-" }];
  for (const row of compareRows.slice(0, 3)) {
    ctx.fillStyle = "#c9d8f6";
    ctx.font = "17px Arial";
    ctx.fillText(row.book, PADDING, y);

    ctx.textAlign = "right";
    ctx.fillStyle = "#ffffff";
    ctx.font = "bold 17px Arial";
    ctx.fillText(row.odds, WIDTH - PADDING, y);
    ctx.textAlign = "left";
    y += 24;
  }

  if (input.stake || input.payout) {
    y += 10;
    ctx.fillStyle = "#9fb4d8";
    ctx.font = "16px Arial";
    ctx.fillText([input.stake ? `Stake ${input.stake}` : "", input.payout ? `Payout ${input.payout}` : ""].filter(Boolean).join("  •  "), PADDING, y);
    y += 22;
  }

  if (input.notes?.length) {
    y += 8;
    for (const note of input.notes.slice(0, 2)) {
      ctx.fillStyle = "#8ea7cf";
      ctx.font = "14px Arial";
      ctx.fillText(`- ${ellipsis(ctx, note, WIDTH - PADDING * 2)}`, PADDING, y);
      y += 18;
    }
  }

  return canvas.toBuffer("image/png");
}

