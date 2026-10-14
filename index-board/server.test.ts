import { describe, expect, test } from "bun:test";
import source from "./fixtures/yahoo-gspc.json";
import { INDICES, createQuoteCache } from "./quotes";
import { createHandler } from "./server";

function chartAt(updatedAt: string) {
  return {
    chart: {
      result: [{
        ...source.chart.result[0],
        meta: {
          ...source.chart.result[0].meta,
          regularMarketPrice: 125,
          previousClose: 100,
          regularMarketTime: Date.parse(updatedAt) / 1000,
        },
      }],
      error: null,
    },
  };
}

const request = (path: string, method = "GET") => new Request(`http://localhost${path}`, { method });

describe("request handler", () => {
  test("cold health returns 503 without warming the cache", async () => {
    let calls = 0;
    const cache = createQuoteCache({ fetcher: async () => {
      calls++;
      return chartAt("2026-10-14T12:00:00.000Z");
    } });
    const handle = createHandler(cache);
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await handle(request("/healthz"));
      expect(response.status).toBe(503);
      expect(response.headers.get("Content-Type")).toBe("application/json");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect(await response.json()).toEqual({
        ok: false, symbols: 6, fresh: 0, stale: 0, oldestUpdatedAt: null,
      });
      expect(calls).toBe(0);
    }
    const response = await handle(request("/api/quotes"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ quotes: INDICES.map(index => ({
      ...index,
      status: "fresh",
      data: {
        price: 125, previousClose: 100, change: 25, changePercent: 25,
        updatedAt: "2026-10-14T12:00:00.000Z", series: [7753.8701171875],
      },
    })) });
    expect(calls).toBe(6);
  });

  test("health counts two fresh, one stale and three unavailable without refreshing expired entries", async () => {
    let time = 0;
    let calls = 0;
    const cache = createQuoteCache({ now: () => time, fetcher: async symbol => {
      calls++;
      if (symbol === "^GSPC") return chartAt("2026-10-14T12:00:00.000Z");
      if (symbol === "^DJI" && time === 0) return chartAt("2026-10-12T09:00:00.000Z");
      if (symbol === "^IXIC") return chartAt("2026-10-13T15:00:00.000Z");
      throw new Error("upstream offline");
    } });
    const handle = createHandler(cache);
    await cache.getQuotes();
    time = 60_000;
    await cache.getQuotes();
    expect(calls).toBe(12);
    time = 86_400_000;
    const response = await handle(request("/healthz"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true, symbols: 6, fresh: 2, stale: 1,
      oldestUpdatedAt: "2026-10-12T09:00:00.000Z",
    });
    const head = await handle(request("/healthz", "HEAD"));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(calls).toBe(12);
  });

  test("all stale returns 503 and retains the oldest cached quote timestamp", async () => {
    let time = 0;
    let calls = 0;
    const cache = createQuoteCache({ now: () => time, fetcher: async symbol => {
      calls++;
      if (time !== 0) throw new Error("upstream offline");
      return chartAt(symbol === "^N225" ? "2026-10-10T01:00:00.000Z" : "2026-10-14T12:00:00.000Z");
    } });
    const handle = createHandler(cache);
    await cache.getQuotes();
    time = 60_000;
    await cache.getQuotes();
    expect(calls).toBe(12);
    time = 120_000;
    const response = await handle(request("/healthz"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      ok: false, symbols: 6, fresh: 0, stale: 6,
      oldestUpdatedAt: "2026-10-10T01:00:00.000Z",
    });
    expect(calls).toBe(12);
  });

  test("preserves page, HEAD, method rejection and unknown-route behavior without upstream I/O", async () => {
    let calls = 0;
    const handle = createHandler(createQuoteCache({ fetcher: async () => {
      calls++;
      return source;
    } }));
    const page = await handle(request("/"));
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
    expect(await page.text()).toBe(await Bun.file(`${import.meta.dir}/index.html`).text());
    for (const path of ["/", "/api/quotes", "/healthz"]) {
      const head = await handle(request(path, "HEAD"));
      expect(head.status).toBe(path === "/healthz" ? 503 : 200);
      expect(await head.text()).toBe("");
      expect(head.headers.get("Cache-Control")).toBe("no-store");
      expect(head.headers.get("Content-Type")).toBe(path === "/" ? "text/html; charset=utf-8" : "application/json");
      const post = await handle(request(path, "POST"));
      expect(post.status).toBe(405);
      expect(post.headers.get("Allow")).toBe("GET, HEAD");
      expect(post.headers.get("Cache-Control")).toBe("no-store");
      expect(await post.text()).toBe("Method not allowed");
    }
    for (const method of ["GET", "POST"]) {
      const missing = await handle(request("/missing", method));
      expect(missing.status).toBe(404);
      expect(missing.headers.get("Cache-Control")).toBe("no-store");
      expect(await missing.text()).toBe("Not found");
    }
    expect(calls).toBe(0);
  });
});
