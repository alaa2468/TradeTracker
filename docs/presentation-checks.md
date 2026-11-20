# Presentation readiness — 8 November 2026

## Changes deployed

Backend version `18f78ee9-23d9-4940-b559-5f6ace241328` is deployed at
https://tradetrack-market-data.alaa-tradetrack.workers.dev.

* Kraken's OHLC request uses a stable pair/interval URL. Its documented endpoint returns up to 720 recent entries without a changing `since` parameter. The forming candle is still excluded.
* Validated public history is stored separately from AI proposals in the existing SQLite-backed Durable Object. Crypto history is reused for up to five minutes, refreshed at an hourly close; Forex history is reused for up to an hour. Original source/fetch times are retained. Expired, wrong-market or corrupt history is not used as a fallback.
* Provider failures have durable, source-specific backoff: one minute, then two, four, eight, etc., capped at an hour, respecting longer Retry-After deadlines. HTTP 403 has a minimum 15-minute backoff; 418/451 have a minimum hour. Restarting the Worker does not reset these deadlines.
* A failed history request does not consume a Groq call or extend its cooldown. Healthy Forex can still work while Binance history is blocked. Groq failures still consume the reserved model allowance and retain provider cooldowns. Existing genuine-proposal caching and 20-call daily cap remain.

No frontend/API-contract, SQLite schema, local trading record or secret value was changed. Deployment used `--keep-vars`; no secret put/delete/bulk commands were run. No Firebase, paid provider, trading execution or GitHub push was added.

## Verification

* 108 automated tests passed, including migrations/data preservation, Journal/Session/Coach logic, indicator reference examples, source validation, inverse rates, backoff/restart behavior, cache freshness, model quota handling and unavailable-data behavior.
* TypeScript and ESLint passed.
* Fresh isolated browser checks at a mobile viewport loaded Dashboard, Journal, Analytics, Sessions, Psychology Coach and AI Trading Agent without writing to the owner's app data.
* Real Binance and Kraken BTC/ETH display prices and hourly charts rendered. Gold XAU/USD spot rendered. All four Forex pairs displayed real reference-rate charts; USD/EUR's inverse-derived label was checked.
* A temporary Cloudflare Worker ran the actual production history parser and indicator code: Kraken BTC/USD and ETH/USD each yielded 200 closed hourly observations; all four Forex pairs yielded 181 daily reference observations. RSI, SMA, EMA and MACD were calculated from those responses. The temporary Worker had no secrets or storage bindings and was removed after testing.
* Production `/health` still reports configured. This is configuration readiness, not proof of a new model response or provider billing state.

There was **no new authenticated Groq call in this run**: the rotated access code was not requested or read. The previous genuine EUR/USD model response is recorded in `android-verification.md`. Model responses in automated tests are explicit test fixtures, never deployed fallback proposals.

## Remaining external limitations

### Binance AI

Both the official data-only host and the standard official API host returned HTTP 403 from Cloudflare; the same public API works from the development computer and the mobile-width browser. This isolates the failure to the provider/network path, not candle parsing or indicators. Binance documents 403 as a WAF/security block. Exact policy/reason was not disclosed in the response.

Caching/backoff prevents repeated blocked requests but cannot remove the provider restriction. No proxy, IP rotation, fabricated history, or silent exchange substitution was added. Select **Kraken** for Crypto analysis. BTC/USD is not BTC/USDT. Availability can still vary with provider limits.

### Gold AI

Gold API spot is free and keyless. Its free history/OHLC tier allows 10 combined requests per hour but requires a free server-side key, which is not configured on this deployment. The existing display adapter requests 45 daily averages; it cannot meet the AI's 100-observation requirement. A free key alone does not enable Gold AI in the existing APK.

Other examined sources do not provide a verified drop-in keyless solution: goldprice.dev's free daily history is limited to 30 days, and FreeGoldAPI's recent daily data is gold futures (GC=F), not XAU/USD spot. Futures and ETF prices must not be relabeled as spot. Gold analysis remains honestly unavailable. Optional future work is a free Gold API account/key, verified adequate history, an explicitly labeled daily-average analysis contract and a frontend update; no billing needs to be enabled. Do not buy a key or weaken validation to make the demo appear successful.

Sources checked:

* https://developers.binance.com/en/docs/products/spot/rest-api
* https://docs.kraken.com/api-reference/market-data/get-ohlc-data
* https://support.kraken.com/gb/articles/206548367-what-are-the-api-rate-limits-
* https://gold-api.com/pricing
* https://gold-api.com/llms.txt
* https://goldprice.dev/docs/historical
* https://freegoldapi.com/

## Test on your Android phone

No new APK is required for these backend-only changes. Keep the installed APK and its data.

1. Connect to the internet and open TradeTrack. Check Dashboard, Journal, Analytics, Sessions and Coach using your existing records; do not reset storage.
2. Open AI Trading Agent, select Crypto → Kraken → BTC/USD, enter your current private demo code, confirm eligibility and press Analyze Market. Check the exchange, pair, hourly data timestamps, indicators and genuine Groq response ID. Repeat with ETH/USD after any displayed shared cooldown.
3. Repeat Analyze Market on the same pair while its proposal is valid: it should show the cached genuine response, retaining its original generation time and provider ID. A cache is not a new model call.
4. Select Binance. Prices/charts should still work; AI can report the backend's HTTP 403 restriction and a retry deadline. This is expected, not a successful analysis.
5. Select Forex. Test EUR/USD, USD/EUR, GBP/USD and USD/JPY after any model cooldown. Verify daily-reference labels, and inverse-derived provenance for USD/EUR. These are not live trading quotes.
6. Select Gold. Check XAU/USD spot, its source update time and stale indication if applicable. History is unavailable without its optional server key, and AI remains unavailable. No proposal should appear.
7. Disable connectivity and refresh. Expect an error or retained data clearly marked stale, never a new invented value or proposal. Reconnect and retry after any cooldown.

Physical Android interactions and a new authenticated model response remain owner/device checks. No phone/emulator was connected during this run. Frontend changes in the future require a rebuilt APK unless an appropriate OTA-update setup is separately configured; none was added here.
