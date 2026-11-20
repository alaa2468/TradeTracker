# Trading Agent stages

## Current free market extension

The Agent now has **Crypto / Gold / Forex** categories. Crypto uses its original panel and adapters. Gold uses Gold API spot snapshots plus optional backend-provided daily averages. Forex uses Frankfurter daily reference rates for EUR/USD, USD/EUR, GBP/USD and USD/JPY; USD/EUR is explicitly inverse-derived from EUR/USD. No Twelve Data or Alpha Vantage integration is enabled. Gold history is a standalone free-compatible Cloudflare Worker with a server-only key and a SQLite-backed Durable Object for global caching/quota protection. A separate MarketAnalysis Durable Object now provides the optional genuine online AI integration. See [ai-testing.md](ai-testing.md) for activation, provider eligibility, indicators, limits and testing.

New source adapters and validation live in `services/referenceMarkets.ts`; `services/referenceFeed.ts` manages cached snapshots, request cancellation, late-result protection and provider cooldowns. Daily observations retain source dates, receipt times, price kind and derivation metadata. They are never represented as OHLC candles. The mobile SQLite database is unchanged. The backend stores only a public Gold-history cache and retry deadline; no journal or psychology data is uploaded.

See [the beginner market guide](market-testing.md) and [online AI guide](ai-testing.md) for setup, limitations and physical-device checks. Online AI implementation has been authorized; service activation still requires verified free account eligibility and server-only credentials. No paid services or automatic execution are allowed.

## Stage 1 — implemented market-data interface

Open **Dashboard → Open AI Trading Agent**. The screen is an Expo Router stack route (`src/app/agent.tsx`), so Dashboard, Journal, Analytics, Sessions, and Psychology Coach keep their existing tabs. Existing SQLite tables and saved journal/coaching data are unchanged by this stage. No dependencies, account connections, credentials, or order endpoints were added.

The exchange selector offers Binance (BTC/USDT and ETH/USDT) and Kraken (BTC/USD and ETH/USD). USD and USDT are separate quote currencies; no conversion is performed. The selected exchange controls pair labels, price units, chart labels and accessibility text, source attribution, cached data, errors, and cooldowns.

The existing `services/binance.ts` integration is unchanged. Four parallel, unauthenticated GET requests fetch each pair's latest price and 24 hourly klines from `https://data-api.binance.vision`:

- `/api/v3/ticker/price?symbol=BTCUSDT` (and `ETHUSDT`).
- `/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24` (and `ETHUSDT`).

`services/kraken.ts` uses `https://api.kraken.com` with four public GET requests:

- `/0/public/Ticker?pair=XBTUSD` (and `ETHUSD`). The displayed price is the last completed trade, `c[0]`, rather than bid or ask.
- `/0/public/OHLC?pair=XBTUSD&interval=60&since=<start-of-current-hour-minus-23-hours>` (and `ETHUSD`). Only the latest 24 hourly entries are displayed. Kraken timestamps are converted from seconds to milliseconds and cursor metadata is excluded. The last OHLC entry is still forming. Live verification showed that an unbounded response can include 720 committed rows plus this forming row, so the bounded parser accepts up to 721 input rows.

Kraken's internal Bitcoin code `XBT` is displayed as BTC/USD. The parsers match known pair keys (including `XXBTZUSD` and `XETHZUSD`) and reject a response for another market. Missing/invalid prices, malformed OHLC rows, or missing/unordered hourly intervals are reported rather than plotted as valid data. Kraken's HTTP-200 `error` arrays are failures too. Rate-limit and throttled-until errors trigger a cooldown; HTTP 429 honors Retry-After. Both adapters apply ten-second timeouts and explain service/access failures.

The price card shows each resource's actual successful receipt time on the device, not an invented exchange trade timestamp. Polling runs every 30 seconds only while the Agent screen is focused and the app is active. Refresh prevents overlapping requests. Backgrounding, leaving the screen, or switching exchange aborts outstanding requests; a generation check also discards late responses if a network implementation ignores abort. An old Binance response cannot be committed as Kraken/USD data.

`services/markets.ts` provides exchange metadata and adapts responses into separate asset records. `services/marketFeed.ts` keeps independent per-exchange snapshots, so switching back can reuse only that exchange's last successful data. Each quote and chart succeeds or fails independently. Failed refreshes retain and mark the previous resource stale; successful retries clear its error. Data also becomes stale after 60 seconds or device-clock rollback. Cooldowns survive screen reopening in app memory and affect only the relevant host. No credentials are used.

Data is held only in screen memory; a cold start offline shows unavailable data, not demo prices. The app cannot distinguish a device disconnection from network filtering solely through fetch errors. Polling and manual Refresh retry after connectivity returns. This extension changes no SQLite schema or data and adds no dependencies.

The dependency-free chart uses native Views for up to 24 hourly close prices. It labels the minimum/maximum scale, device-local candle start times, and the possibly incomplete latest candle. This is a chart of closes, not candlestick OHLC geometry or an exact rolling 24-hour return.

The original empty proposals panel has been replaced by the optional Stage 2 Analyze Market panel described below. Public market display remains independent of AI setup. There is no trade execution code or active Approve button.

## Stage 2 — genuine online analysis implemented, setup required

The existing free-compatible Cloudflare Worker now routes authenticated `POST /v1/analysis` to a separate SQLite-backed Durable Object. It fetches trusted exchange/reference history, computes RSI(14), SMA/EMA(20,50) and MACD(12,26,9), then calls Groq's hosted GPT-OSS 20B through its free tier after operator verification. Keys never enter the mobile bundle. A manual Analyze Market panel displays validated model proposals with market provenance, timestamps, explanations, conflicting signals, uncertainty and risks.

Crypto analysis uses additional closed hourly candles without changing the display adapters. Forex uses at least 100 actual daily reference observations, with inverse-derived USD/EUR indicators recomputed from inverse rates. Gold analysis is unavailable because its current daily-average adapter supplies insufficient history. Missing/stale/invalid data and provider errors never produce fallback indicators or recommendations.

The backend requires a demo access code, applies bounded allowlisted input, global persistent quotas, cache/expiry checks and strict output validation. Its setup switch defaults to disabled until the owner verifies free plans and configures secrets. Gemini was not enabled because its current EEA client-distribution terms do not establish a no-billing arrangement for this app. See [the complete setup/test guide](ai-testing.md), including the distinction between mocked automated tests and a genuine provider call.

## Trade execution — not implemented

TradeTrack is an educational analysis application. No exchange account connection, trading credentials, Approve/Execute buttons or order endpoint exist. Neither a model proposal nor pressing Analyze Market can execute a trade.

## Testing and manual verification

Run `npm test`, `npm run lint`, and `npm run typecheck`. Tests cover both exchanges’ public endpoint/method restrictions, Kraken response envelopes and pair aliases, payload validation, timestamp conversion, partial failures, stale data retention/recovery, network disconnection, timeout/cancellation, per-exchange rate-limit deadlines, access errors, and clock/age boundaries. Controller tests cover normal and rapid exchange switching, cached-data isolation, delayed obsolete responses, request deduplication, and background/resume cancellation. If the generated route types are missing or stale, run `npx expo start` first, as documented by Expo Router.

Manual checks still required on iOS, Android, and web:

1. Start the app with `npm run web` (or reload the existing browser session), then open **Dashboard → Open AI Trading Agent**.
2. Select **Kraken**. Verify BTC/USD and ETH/USD prices and timestamps, then switch between their hourly charts. Every price and chart scale must say USD.
3. Use Refresh and verify updated timestamps. Switch to Binance and check BTC/USDT and ETH/USDT, then switch back to Kraken. USD and USDT labels must follow the exchange, including during slow or failed requests.
4. Disconnect the network during a request and after successful data; verify loading ends, last snapshots are marked stale, and a later refresh recovers.
5. Leave the screen and background/relaunch the app; confirm polling stops in the background and resumes on return.
6. Check narrow screens, enlarged fonts, screen readers, browser CORS, and Binance access from the intended deployment regions.
7. Confirm all five existing tabs and saved journal/coaching entries still work. No native-device or interactive browser test is implied by passing a JavaScript bundle export.

## Primary references

- [Kraken public ticker](https://docs.kraken.com/api-reference/market-data/get-ticker-information) — last-trade prices and pair naming.
- [Kraken public OHLC](https://docs.kraken.com/api-reference/market-data/get-ohlc-data) — hourly candles, seconds, and the forming final row.
- [Kraken rate-limit errors](https://docs.kraken.com/exchange/guides/rest/ratelimits) — rate-limit and throttled-until responses.

- [Binance market-data-only URLs](https://developers.binance.com/en/docs/products/spot/faqs/market_data_only) — public host and no authentication requirement.
- [Binance Spot market endpoints](https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market) — price and kline response contracts.
- [Binance Spot REST behavior and limits](https://developers.binance.com/en/docs/products/spot/rest-api) — HTTP errors and rate-limit behavior.
- [Express production security](https://expressjs.com/en/advanced/best-practice-security/) — backend security baseline.
- [Expo Router typed routes](https://docs.expo.dev/router/reference/typed-routes/) — generated navigation types.
