function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function findFirstArrayWithObjects(input: unknown, depth = 0): Array<Record<string, unknown>> | null {
  if (depth > 10) return null;

  if (Array.isArray(input) && input.length > 0 && input.every((item) => isRecord(item))) {
    return input as Array<Record<string, unknown>>;
  }

  if (Array.isArray(input)) {
    for (const item of input) {
      const nested = findFirstArrayWithObjects(item, depth + 1);
      if (nested) return nested;
    }
    return null;
  }

  if (!isRecord(input)) {
    return null;
  }

  for (const value of Object.values(input)) {
    const nested = findFirstArrayWithObjects(value, depth + 1);
    if (nested) return nested;
  }

  return null;
}

export function extractJsonFromNextData(html: string): unknown | null {
  const nextDataMatch = html.match(/<script[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch?.[1]) {
    return null;
  }

  try {
    return JSON.parse(nextDataMatch[1]);
  } catch {
    return null;
  }
}

export function extractJsonScriptBlocks(html: string): unknown[] {
  const scripts: unknown[] = [];
  const regex = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(regex)) {
    const payload = match[1];
    if (!payload) continue;
    try {
      scripts.push(JSON.parse(payload));
    } catch {
      // ignore malformed JSON blocks
    }
  }

  return scripts;
}

export function extractBestEffortLegCandidates(input: unknown): Array<Record<string, unknown>> {
  const fromArray = findFirstArrayWithObjects(input);
  return fromArray ?? [];
}

export function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toUrlOrNull(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function buildHostAllowlist(hostname: string): Set<string> {
  const host = hostname.toLowerCase();
  const allow = new Set<string>([host]);

  const parts = host.split(".");
  if (parts.length >= 2) {
    allow.add(parts.slice(-2).join("."));
  }

  return allow;
}

export async function fetchHtmlWithDomainGuard(url: URL, timeoutMs: number): Promise<string | null> {
  const allowlist = buildHostAllowlist(url.hostname);

  const response = await fetch(url.toString(), {
    method: "GET",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "text/html,application/xhtml+xml"
    }
  });

  const finalUrl = toUrlOrNull(response.url);
  if (!finalUrl) {
    return null;
  }

  const finalHost = finalUrl.hostname.toLowerCase();
  const finalBase = finalHost.split(".").slice(-2).join(".");
  if (!allowlist.has(finalHost) && !allowlist.has(finalBase)) {
    throw new Error("Redirected to unsupported domain");
  }

  const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
  if (!contentType.includes("text/html")) {
    return null;
  }

  return response.text();
}

