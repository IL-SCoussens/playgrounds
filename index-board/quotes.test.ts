import { describe, expect, test } from "bun:test";
import source from "./fixtures/yahoo-gspc.json";
import { INDICES, createQuoteCache, parseQuote } from "./quotes";

// Yahoo chart response captured 2026-10-14 with unrelated metadata removed.
// Its candle close is intentionally distinct from the authoritative meta price.
function payload(
  meta: Record<string, unknown> = {},
  indicators: unknown = source.chart.result[0].indicators,
) {
  return {
    chart: {
      result: [{
        ...source.chart.result[0],
        meta: { ...source.chart.result[0].meta, ...meta },
        indicators,
      }],
      error: null,
    },
  };
}

const quote = {
  price: 125,
  previousClose: 100,
  change: 25,
  changePercent: 25,
  updatedAt: "2026-10-14T14:37:39.000Z",
  series: [7753.8701171875],
};
const good = () => payload({ regularMarketPrice: 125, previousClose: 100 });
const recovered = () => payload({ regularMarketPrice: 80, previousClose: 100 });
const recoveredQuote = { ...quote, price: 80, change: -20, changePercent: -20 };
const freshRows = () => INDICES.map(index => ({ ...index, status: "fresh", data: quote }));

describe("parseQuote", () => {
  test("reads source metadata, not the intraday candle, with missing-close fallback", () => {
    const parsed = parseQuote(source);
    expect(parsed.price).toBe(7753.87);
    expect(parsed.previousClose).toBe(7805.45);
    expect(parsed.change).toBeCloseTo(-51.58, 8);
    expect(parsed.changePercent).toBeCloseTo(-0.6608203242606119, 10);
    expect(parsed.updatedAt).toBe("2026-10-14T14:37:39.000Z");
    expect(parsed.series).toEqual([7753.8701171875]);
  });

  test("prefers previousClose and calculates percentage against it", () => {
    expect(parseQuote(good())).toEqual(quote);
    expect(parseQuote(recovered())).toEqual(recoveredQuote);
  });

  test("samples 100 closes at evenly spaced positions after dropping nulls", () => {
    const closes = Array.from({ length: 100 }, (_, index) => index);
    const expected = [
      0, 3, 6, 10, 13, 16, 19, 22, 26, 29, 32, 35, 38, 42, 45, 48,
      51, 54, 57, 61, 64, 67, 70, 73, 77, 80, 83, 86, 89, 93, 96, 99,
    ];
    for (const close of [closes, [null, ...closes.flatMap(value => [value, null]), null]]) {
      const parsed = parseQuote(payload({}, { quote: [{ close }] }));
      expect(parsed.series).toEqual(expected);
      expect(parsed.price).toBe(7753.87);
    }
  });

  test("retains every valid close when there are at most 32", () => {
    const close = [null, 12, 3, null, 25, null];
    expect(parseQuote(payload({}, { quote: [{ close }] })).series).toEqual([12, 3, 25]);
    const boundary = Array.from({ length: 32 }, (_, index) => index + 10);
    expect(parseQuote(payload({}, { quote: [{ close: boundary }] })).series).toEqual(boundary);
  });

  test("keeps metadata usable without candle data", () => {
    const { meta } = good().chart.result[0];
    const expected = { ...quote, series: [] };
    expect(parseQuote({ chart: { result: [{ meta }], error: null } })).toEqual(expected);
    for (const indicators of [null, {}, { quote: [] }, { quote: [{}] },
      { quote: [{ close: [] }] }, { quote: [{ close: [null, null] }] }]) {
      expect(parseQuote(payload(meta, indicators))).toEqual(expected);
    }
  });

  test("rejects source errors, malformed metadata and invalid numeric fields", () => {
    const invalid: unknown[] = [
      null, {}, { chart: { result: [], error: null } },
      { chart: { result: [{ meta: null }], error: null } },
      { chart: { result: source.chart.result, error: { code: "Not Found", description: "No data" } } },
      ...[0, -1, NaN, Infinity, "125", null].map(regularMarketPrice => payload({ regularMarketPrice })),
      ...[0, -1, NaN, Infinity, "100", null].map(previousClose => payload({ previousClose })),
      payload({ chartPreviousClose: 0 }),
      ...[NaN, Infinity, "1791988659", null, 1e20].map(regularMarketTime => payload({ regularMarketTime })),
    ];
    for (const value of invalid) expect(() => parseQuote(value)).toThrow();
  });
});

describe("createQuoteCache", () => {
  test("returns all six rows, throttles within a minute, and refreshes at exact TTL", async () => {
    let time = 0;
    const calls: string[] = [];
    const cache = createQuoteCache({ now: () => time, fetcher: async symbol => {
      calls.push(symbol);
      return good();
    } });
    expect(INDICES).toHaveLength(6);
    expect(await cache.getQuotes()).toEqual(freshRows());
    expect(calls.toSorted()).toEqual(INDICES.map(index => index.symbol).toSorted());
    time = 59_999;
    expect(await cache.getQuotes()).toEqual(freshRows());
    expect(calls).toHaveLength(6);
    time = 60_000;
    expect(await cache.getQuotes()).toEqual(freshRows());
    expect(calls.toSorted()).toEqual(INDICES.flatMap(index => [index.symbol, index.symbol]).toSorted());
  });

  test("isolates a failure, retains last good data, throttles failures, and recovers", async () => {
    let time = 0;
    let fail = false;
    let calls = 0;
    const symbol = INDICES[0].symbol;
    const cache = createQuoteCache({ now: () => time, fetcher: async requested => {
      calls++;
      if (requested === symbol && fail) throw new Error("upstream offline");
      return time === 0 ? good() : recovered();
    } });
    expect(await cache.getQuotes()).toEqual(freshRows());
    time = 60_000;
    fail = true;
    const staleRows = INDICES.map(index => index.symbol === symbol
      ? { ...index, status: "stale", data: quote }
      : { ...index, status: "fresh", data: recoveredQuote });
    expect(await cache.getQuotes()).toEqual(staleRows);
    time = 119_999;
    fail = false;
    expect(await cache.getQuotes()).toEqual(staleRows);
    expect(calls).toBe(12);
    time = 120_000;
    expect(await cache.getQuotes()).toEqual(INDICES.map(index => ({ ...index, status: "fresh", data: recoveredQuote })));
    expect(calls).toBe(18);
  });

  test("first failure is unavailable and cannot retry before the cooldown", async () => {
    let time = 0;
    let calls = 0;
    const cache = createQuoteCache({ now: () => time, fetcher: async () => {
      calls++;
      if (time === 0) throw new Error("upstream offline");
      return good();
    } });
    const unavailable = INDICES.map(index => ({ ...index, status: "unavailable", data: null }));
    expect(await cache.getQuotes()).toEqual(unavailable);
    time = 59_999;
    expect(await cache.getQuotes()).toEqual(unavailable);
    expect(calls).toBe(6);
    time = 60_000;
    expect(await cache.getQuotes()).toEqual(freshRows());
    expect(calls).toBe(12);
  });

  test("concurrent callers share in-flight fetches even past TTL measured from attempt start", async () => {
    let time = 0;
    let calls = 0;
    const releases: Array<() => void> = [];
    const cache = createQuoteCache({ now: () => time, fetcher: () => {
      calls++;
      if (time !== 0) return Promise.resolve(recovered());
      return new Promise<unknown>(resolve => releases.push(() => resolve(good())));
    } });
    const first = cache.getQuotes();
    const second = cache.getQuotes();
    await Promise.resolve();
    time = 60_000;
    const afterTTL = cache.getQuotes();
    await Promise.resolve();
    expect(calls).toBe(6);
    for (const release of releases) release();
    expect(await Promise.all([first, second, afterTTL])).toEqual([freshRows(), freshRows(), freshRows()]);
    // Slow fetch completion does not move the cooldown's start forward.
    expect(await cache.getQuotes()).toEqual(INDICES.map(index => ({ ...index, status: "fresh", data: recoveredQuote })));
    expect(calls).toBe(12);
  });
});
