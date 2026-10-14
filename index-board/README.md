# Index board

A standalone Bun app for six stock indices, separate from the root Next.js app.
It requires Bun but no additional dependencies or API key.

## Run and test

Run these commands from the repository root:

```sh
bun run index-board/server.ts
```

The server defaults to port **3001**. To choose another port:

```sh
PORT=3002 bun run index-board/server.ts
```

To run the tests:

```sh
bun test index-board
```

## Indices

| Index | Yahoo symbol | Region |
| --- | --- | --- |
| S&P 500 | `^GSPC` | United States |
| Dow Jones | `^DJI` | United States |
| Nasdaq Composite | `^IXIC` | United States |
| FTSE 100 | `^FTSE` | United Kingdom |
| DAX | `^GDAXI` | Germany |
| Nikkei 225 | `^N225` | Japan |

## Source and limitations

The server fetches Yahoo Finance's free, unofficial chart endpoint with a
browser-like User-Agent:

```text
https://query2.finance.yahoo.com/v8/finance/chart/<symbol>?range=1d&interval=15m
```

The source requires no API key, but it may change, fail, or rate-limit requests.
Quotes may be delayed by up to 15 minutes. This app does not guarantee
trading-grade data.

The board uses the latest metadata price and quote time, and calculates change
against the previous close. Values are index points, not prices to compare
across currencies. The browser displays quote timestamps in the viewer's local
time zone; a timestamp can be old when a market is closed.

Intraday sparklines use up to 32 evenly sampled Yahoo closing values, green when
the last value is above the previous close and red otherwise.

## Refresh and failure behavior

- The browser refreshes every 60 seconds.
- Requests drive upstream fetches; the server does not poll in the background.
- Each process attempts an upstream fetch at most once per minute per symbol.
  Failed attempts also count toward this cooldown. Concurrent requests share
  the same in-flight fetch.
- Each upstream request has an 8-second timeout.
- On failure, the server returns the cached last-good quote marked `stale`.
  If no successful quote exists, including a cold-start failure, it returns
  `unavailable` with `data: null`.
- The cache lives in memory. It does not survive restarts and is not shared
  across server instances.

`fresh` describes successful source retrieval, not a guarantee that the quote
timestamp is recent or that the market is open.

## Health

`GET /healthz` reads the in-memory cache without fetching quotes or triggering a
refresh. To inspect the response and HTTP status on the default port:

```sh
curl -i http://localhost:3001/healthz
```

Example response with two fresh, one stale, and three unavailable indices:

```json
{
	"ok": true,
	"symbols": 6,
	"fresh": 2,
	"stale": 1,
	"oldestUpdatedAt": "2026-10-14T14:30:00.000Z"
}
```

`symbols` counts all six configured indices, including unavailable ones.
`fresh` and `stale` count stored statuses. Unavailable indices count in neither.
`ok` is `fresh > 0`: the server returns HTTP 200 when at least one index is fresh
and HTTP 503 otherwise. At cold start, `ok` is `false`, both status counts are
zero, and `oldestUpdatedAt` is `null`.

`oldestUpdatedAt` is the oldest cached source quote timestamp across fresh and
stale data, in ISO format, or `null` when no data exists. As above, `fresh`
reflects the last retrieval's success, not quote age. Health checks do not
refresh these statuses.

## Quote response

The quote endpoint returns this JSON shape:

```text
{
  quotes: [{
    symbol: string,
    name: string,
    region: string,
    status: "fresh" | "stale" | "unavailable",
    data: {
      price: number,
      previousClose: number,
      change: number,
      changePercent: number,
      series: number[],
      updatedAt: string // ISO quote timestamp
    } | null
  }]
}
```

`change` is `price - previousClose`; `changePercent` expresses that change as a
percentage of the previous close. `updatedAt` is the source quote time, not the
browser refresh time.
