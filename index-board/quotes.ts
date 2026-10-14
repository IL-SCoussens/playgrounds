export const INDICES = [
  { symbol: "^GSPC", name: "S&P 500", region: "US" },
  { symbol: "^DJI", name: "Dow Jones", region: "US" },
  { symbol: "^IXIC", name: "Nasdaq Composite", region: "US" },
  { symbol: "^FTSE", name: "FTSE 100", region: "UK" },
  { symbol: "^GDAXI", name: "DAX", region: "Germany" },
  { symbol: "^N225", name: "Nikkei 225", region: "Japan" },
];

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Expected a quote object");
  }
  return Object.fromEntries(Object.entries(value));
}

function positiveNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error("Expected a finite positive quote value");
  }
  return value;
}

export function parseQuote(payload: unknown) {
  const chart = object(object(payload).chart);
  if (chart.error != null) throw new Error("Quote provider returned an error");
  if (!Array.isArray(chart.result) || chart.result.length === 0) {
    throw new Error("Quote provider returned no results");
  }
  const result = object(chart.result[0]);
  const meta = object(result.meta);
  const price = positiveNumber(meta.regularMarketPrice);
  const previousClose = positiveNumber(
    meta.previousClose === undefined ? meta.chartPreviousClose : meta.previousClose,
  );
  const time = positiveNumber(meta.regularMarketTime);
  const date = new Date(time * 1000);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid quote timestamp");
  const change = price - previousClose;
  const changePercent = (change / previousClose) * 100;
  if (!Number.isFinite(changePercent)) throw new Error("Invalid quote change");
  const indicators = object(result.indicators ?? {});
  const candle = Array.isArray(indicators.quote) ? indicators.quote[0] : undefined;
  const close = object(candle ?? {}).close;
  const closes = Array.isArray(close)
    ? close.filter((value: unknown): value is number => typeof value === "number" && Number.isFinite(value))
    : [];
  const series = closes.length <= 32
    ? closes
    : Array.from({ length: 32 }, (_, index) => closes[Math.round(index * (closes.length - 1) / 31)]);
  return { price, previousClose, change, changePercent, updatedAt: date.toISOString(), series };
}

type Quote = ReturnType<typeof parseQuote>;
type Index = (typeof INDICES)[number];
type Row = Index & (
  | { status: "fresh" | "stale"; data: Quote }
  | { status: "unavailable"; data: null }
);
type Entry = {
  attemptedAt: number;
  row: Row;
  inFlight: Promise<Row> | null;
};

async function fetchQuote(symbol: string): Promise<unknown> {
  const response = await fetch(
    `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=15m`,
    {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; IndexBoard/1.0)" },
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!response.ok) throw new Error(`Quote provider HTTP ${response.status}`);
  return response.json();
}

export function createQuoteCache({
  fetcher = fetchQuote,
  now = Date.now,
}: {
  fetcher?: (symbol: string) => Promise<unknown>;
  now?: () => number;
} = {}) {
  const entries = new Map<string, Entry>();

  function getQuote(index: Index): Promise<Row> {
    let entry = entries.get(index.symbol);
    if (entry?.inFlight) return entry.inFlight;
    const timestamp = now();
    if (entry && timestamp - entry.attemptedAt < 60_000) {
      return Promise.resolve(entry.row);
    }
    if (!entry) {
      entry = {
        attemptedAt: timestamp,
        row: { ...index, status: "unavailable", data: null },
        inFlight: null,
      };
      entries.set(index.symbol, entry);
    }
    const current = entry;
    current.attemptedAt = timestamp;
    current.inFlight = Promise.resolve().then(async () => {
      try {
        const data = parseQuote(await fetcher(index.symbol));
        current.row = { ...index, status: "fresh", data };
      } catch {
        current.row = current.row.data === null
          ? { ...index, status: "unavailable", data: null }
          : { ...index, status: "stale", data: current.row.data };
      } finally {
        current.inFlight = null;
      }
      return current.row;
    });
    return current.inFlight;
  }

  return { getQuotes: () => Promise.all(INDICES.map(getQuote)) };
}
