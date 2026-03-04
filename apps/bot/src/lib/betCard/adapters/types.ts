export type EnrichedLeg = {
  eventName: string;
  market: string;
  selection: string;
  line?: string;
  odds?: string;
};

export type EnrichedSlip = {
  type: "single" | "parlay";
  legs: EnrichedLeg[];
  stake?: string;
  payout?: string;
  notes?: string[];
};

export interface ShareLinkAdapter {
  id: string;
  hostnames: string[];
  canHandle(url: URL): boolean;
  extractShareId(url: URL): string | null;
  fetchAndParse(shareId: string, url: URL): Promise<EnrichedSlip | null>;
}

