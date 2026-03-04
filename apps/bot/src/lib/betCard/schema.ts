import { z } from "zod";

export const compareEntrySchema = z.object({
  book: z.string().min(1),
  odds: z.string().min(1)
});

export const cardLegSchema = z.object({
  eventName: z.string().min(1),
  market: z.string().min(1),
  selection: z.string().min(1),
  line: z.string().optional(),
  odds: z.string().optional()
});

export const cardInputSchema = z.object({
  sourceUrl: z.string().url().optional(),
  book: z.string().optional(),
  type: z.enum(["single", "parlay"]),
  header: z.object({
    sport: z.string().optional(),
    league: z.string().optional()
  }),
  main: z.object({
    eventName: z.string().optional(),
    market: z.string().optional(),
    selection: z.string().optional(),
    line: z.string().optional(),
    postedOdds: z.string().optional()
  }),
  legs: z.array(cardLegSchema).optional(),
  compare: z.array(compareEntrySchema).optional(),
  notes: z.array(z.string()).optional(),
  stake: z.string().optional(),
  payout: z.string().optional()
});

export type CardInput = z.infer<typeof cardInputSchema>;
export type CardLeg = z.infer<typeof cardLegSchema>;
export type CompareEntry = z.infer<typeof compareEntrySchema>;

export function validateCardInput(input: CardInput): CardInput {
  return cardInputSchema.parse(input);
}

