import "dotenv/config";
import express from "express";
import cors from "cors";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { expectedValuePerUnit, formatPercent } from "@mvp/shared";
import { compareOdds, fetchMarketOdds, buildOddsComparison } from "./lib/odds.js";

const app = express();
app.use(cors());
app.use(express.json());

const createPickSchema = z.object({
  sport: z.string().min(1),
  league: z.string().min(1),
  event: z.string().min(1),
  marketType: z.string().min(1),
  selection: z.string().min(1),
  stakeUnits: z.number().positive(),
  rationale: z.string().min(10),
  fairProbability: z.number().min(0.01).max(0.99)
});

const compareOddsSchema = z.object({
  sport: z.string().min(1),
  market: z.string().min(1),
  selection: z.string().min(1),
  event: z.string().min(1).optional(),
  eventId: z.string().min(1).optional(),
  sportsbook: z.string().min(1).optional(),
  postedOdds: z.number().int().optional()
}).refine((val) => Boolean(val.event || val.eventId), {
  message: "Either event or eventId is required"
});

type InMemoryPick = z.infer<typeof createPickSchema> & {
  id: string;
  postedOdds: number;
  createdAt: string;
  bestBookName: string;
  bestEv: number;
};

const picks = new Map<string, InMemoryPick>();

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "api", now: new Date().toISOString() });
});

app.post("/odds/compare", async (req, res) => {
  const parsed = compareOddsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  try {
    const result = await compareOdds(parsed.data);
    return res.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to compare odds";
    return res.status(400).json({ error: message });
  }
});

app.post("/picks", async (req, res) => {
  const parsed = createPickSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten() });
  }

  const payload = parsed.data;
  const marketOdds = await fetchMarketOdds(payload.event, payload.marketType, payload.selection);
  const comparison = buildOddsComparison(marketOdds, payload.fairProbability);

  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const pick: InMemoryPick = {
    ...payload,
    id,
    createdAt,
    postedOdds: comparison.bestOdds,
    bestBookName: comparison.bestBookName,
    bestEv: comparison.bestEv
  };

  picks.set(id, pick);

  return res.status(201).json({
    id,
    postedOdds: comparison.bestOdds,
    bestBook: comparison.bestBookName,
    bestEv: formatPercent(comparison.bestEv),
    market: comparison.market.map((m) => ({ ...m, evPercent: formatPercent(m.ev) }))
  });
});

app.get("/picks", (_req, res) => {
  res.json(Array.from(picks.values()));
});

app.get("/picks/:id", (req, res) => {
  const pick = picks.get(req.params.id);
  if (!pick) {
    return res.status(404).json({ error: "Pick not found" });
  }

  const ev = expectedValuePerUnit(pick.postedOdds, pick.fairProbability);
  return res.json({
    ...pick,
    ev,
    evPercent: formatPercent(ev)
  });
});

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
});
