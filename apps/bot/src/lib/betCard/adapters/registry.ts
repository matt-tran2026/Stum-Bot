import { bet365ShareAdapter } from "./bet365.adapter.js";
import { exampleEmbeddedJsonAdapter } from "./example.adapter.js";
import type { ShareLinkAdapter } from "./types.js";

const adapters: ShareLinkAdapter[] = [bet365ShareAdapter, exampleEmbeddedJsonAdapter];

export function findAdapter(url: URL): ShareLinkAdapter | null {
  return adapters.find((adapter) => adapter.canHandle(url)) ?? null;
}

export { adapters };
