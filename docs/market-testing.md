# TradeTrack market MVP: run and test

## What works without accounts or keys

Crypto keeps the existing Binance and Kraken prices and hourly charts. Gold adds XAU/USD spot snapshots from Gold API, in USD per troy ounce. Forex adds EUR/USD, USD/EUR, GBP/USD and USD/JPY from Frankfurter's blended daily reference rates. Forex charts show daily observations, not hourly candles or live trading prices.

USD/EUR is calculated as `1 / EUR/USD` for both the latest rate and every historical observation. The screen labels it **inverse-derived**, in euros per US dollar. For example, an EUR/USD observation of 1.25 implies a USD/EUR observation of 0.80. Those numbers are an arithmetic example, never demo prices in the app. Different fetch times can have different source dates; compare matching dates.

Gold daily history is implemented but requires the optional hosted backend below. Without it, spot prices still work and history explains the missing setup. Market prices are never generated. The subsequent optional online AI extension is documented in [ai-testing.md](ai-testing.md); it requires server setup and uses genuine model responses. There are no trading endpoints, Firebase services, new app dependencies, or SQLite schema changes.

## 1. Start the application

1. Open Terminal in the TradeTrack project folder. If necessary run:

   ```sh
   cd /Users/alaa/Documents/Student/MSA/TradeTrack
   ```

2. Existing dependencies are already installed in this workspace. On a fresh copy run `npm ci` first.
3. Run:

   ```sh
   npm start
   ```

4. For a browser, press **w**, or run `npm run web` instead. Open the local URL printed by Expo.
5. For Android/iPhone, use an Expo Go version compatible with this project's **Expo SDK 58**, or your existing compatible development build. Put the phone and computer on the same Wi-Fi network. Scan the terminal QR code with Expo Go on Android or Camera on iPhone. If Expo reports an SDK mismatch, use a matching client; do not change this project's dependencies just to bypass that message.
6. Open **Dashboard → Open AI Trading Agent**. You should see **Crypto / Gold / Forex** above the existing screen.

Expo's development preview needs the development computer running. A separately installed application uses the public APIs and hosted backend directly; the backend described below does not run on your computer. This change validates JavaScript bundles; it does not create signed APK/IPA installers or publish the app.

## 2. Test Crypto

1. Select **Crypto**, then **Binance**. Check BTC/USDT and ETH/USDT prices, timestamps, Refresh and each hourly chart.
2. Select **Kraken**. Check BTC/USD and ETH/USD; prices and chart scales must use **USD**, not USDT.
3. Switch exchanges during loading. Old responses must not appear under the new exchange.
4. Change market category and return. Crypto mounts its original panel again; its original exchange/asset selection starts fresh. Its endpoints and charts are unchanged.

## 3. Test Gold spot

1. Select **Gold**. Check **XAU/USD**, **Current spot snapshot**, and **USD per troy ounce**.
2. Confirm the source update timestamp and device fetch timestamp are shown separately. A recently fetched old source price must be marked stale.
3. Wait for the 30-second refresh cooldown, then use **Refresh**. Repeated rapid requests are disabled. Automatic spot checks run every 30 seconds only while this screen is focused and the app is active.
4. Without backend configuration, the daily-history section explains what is missing. It must never display replacement sample prices.

## 4. Test Forex

1. Select **Forex**. Open each pair: **EUR/USD**, **USD/EUR**, **GBP/USD**, **USD/JPY**.
2. Verify every price says **daily reference rate**, with a source date and device fetch time. These are not executable live prices. The source may retain earlier dates on weekends/holidays.
3. Verify USD/EUR says **inverse-derived**, **not an independently sourced quote**, and **For 1 USD** with its value in **EUR**. EUR/USD instead shows USD for 1 EUR.
4. Check the daily reference history for each pair. The chart requests roughly 45 days, keeps the real observation dates, and does not invent missing days. Bars are equally spaced observations, not elapsed-time candlesticks.
5. Use Refresh after the short cooldown. An unchanged source date/value is normal for daily data. History is reused for one hour to reduce traffic; automatic Forex checks occur hourly while active.

## 5. Optional free online backend for Gold daily averages

Only this section needs account setup. **Do not put an API key in the Expo app, `.env`, `EXPO_PUBLIC_*`, app.json, or a Git-tracked file.** The app's only public configuration is a backend URL.

1. Get a free Gold API key at [Gold API](https://gold-api.com/). Choose the free plan only; do not enable paid billing. [Provider documentation](https://gold-api.com/llms.txt) permits commercial use and free daily history, with 10 history/OHLC requests per hour shared per key. Hour/minute aggregation is premium and is not requested.
2. Create or use a **Cloudflare Workers Free** account. Do not upgrade to Workers Paid or add payment details for this project. Workers Free supports SQLite-backed Durable Objects; the included migration specifically uses that free-compatible storage. Review [Workers limits](https://developers.cloudflare.com/workers/platform/pricing/) and [Durable Object free-plan limits](https://developers.cloudflare.com/durable-objects/platform/pricing/). Free allowances are finite; exceeding them can make history unavailable. This project does not enable paid overages.
3. From the TradeTrack project root, authenticate Cloudflare's development CLI:

   ```sh
   npx --yes wrangler@4 login
   ```

   This downloads a development tool and opens Cloudflare login; it does not install a mobile dependency or require a GitHub connection.

4. Deploy the included backend:

   ```sh
   npx --yes wrangler@4 deploy --config backend/wrangler.jsonc
   ```

   If the Worker name is unavailable, change only `name` in `backend/wrangler.jsonc` to a unique name and repeat. Stop if your account asks for a paid upgrade. No custom domain is needed; use the generated HTTPS `workers.dev` address.

5. Store the provider key using Cloudflare's secret prompt:

   ```sh
   npx --yes wrangler@4 secret put GOLD_API_KEY --config backend/wrangler.jsonc
   ```

   Paste the free key at the prompt. Do not include it in the command itself or send it to anyone. The backend forwards it only to `https://api.gold-api.com/history` in the `x-api-key` header.

6. Open `https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev/v1/gold/history` in a browser. A successful response is an array of `day` and `avg_price` observations. HTTP 503 means missing configuration or provider failure; HTTP 429 means wait for the cooldown. Provider error bodies and keys are never returned. A failed upstream fetch sets a persistent cooldown of at least one hour, so fix configuration then respect that wait.
7. Create a file named `.env` at the TradeTrack root (or add this line to your existing `.env`, preserving its other settings):

   ```dotenv
   EXPO_PUBLIC_MARKET_BACKEND_URL=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev
   ```

   Use just the HTTPS origin: no `/v1/gold/history` path, query parameters, username, password, or API key. `.env` is ignored by Git. A safe template is `.env.example`.

8. Stop Expo with **Ctrl+C**, restart with `npm start -- --clear`, and reload the phone/browser preview. Open **Gold** again. Check the **Daily historical averages** chart.
9. The backend requests approximately 45 completed UTC days using `groupBy=day` and `aggregation=avg`. It excludes today's incomplete day. It caches successful history for 24 hours and globally deduplicates provider requests using one persistent object. Failures have a one-hour minimum backoff. It does not fetch hourly data, return closes, or generate candles. Use a dedicated free key so unrelated apps cannot exhaust the same provider allowance.

The backend serves only this fixed public read endpoint. Wildcard CORS allows Android/iOS/web access to public observations and is not authentication. There is no arbitrary upstream URL, credentials endpoint, journal upload, AI endpoint, or trading route. Mobile SQLite stays on the device. No deployment or account creation was performed automatically during implementation.

## 6. Check errors and existing features

1. Load real prices, then turn off Wi-Fi/mobile data (browser: DevTools → Network → Offline).
2. After the cooldown, Refresh. Loading must end with a connection error. Previous successful observations remain visible and unverified. Restore the network and retry to recover.
3. Quickly switch category/pair during requests. A late result must not overwrite a different market. Background the phone or leave the Agent; requests are aborted and polling stops. Return to resume.
4. Test small phone screens, larger accessibility font sizes, VoiceOver/TalkBack, both orientations supported by the existing app, and browser CORS. Check rate-limit messages using the automated mock tests; do not spam real providers to provoke a 429.
5. Open Dashboard, Journal, Analytics, Sessions and Coach. Check your saved trades, sessions, check-ins and preferences. **Do not uninstall the app, clear browser site data, or reset SQLite** to test this feature; those actions can remove existing local data.

## 7. Automated checks

Run these from the project root:

```sh
npm test
npm run typecheck
npm run lint
npx expo export --platform all --output-dir /tmp/tradetrack-markets-export
npx --yes wrangler@4 deploy --dry-run --config backend/wrangler.jsonc --outdir /tmp/tradetrack-worker-export
```

The export checks Android/iOS JavaScript/Hermes bundles and web/server output; it does not run native applications or produce signed device binaries. Tests cover provider payloads, inverses, dates, staleness, request restrictions, partial failures, offline errors, timeouts, cancellation, pair switching, cache recovery, backend secret isolation and durable provider quotas, plus the existing Crypto/journal/session/coaching regressions. Test fixture prices are used only in automated tests and never shipped as fallback prices.

Wrangler's packaging dry run passed on this workspace. It warned that the current macOS 12.6 is below the recommended version for running Cloudflare's local runtime (13.5+). The dry run does not validate a running Durable Object or a live deployment. You can deploy the backend to Cloudflare without running its local emulator; deployment and a real keyed history response still require account setup and testing.

## 8. Optional genuine online AI

The online AI extension is now implemented and requires free-account verification and server-only credentials. Follow [ai-testing.md](ai-testing.md) for the provider decision, secure deployment, manual Analyze Market controls, indicator details, limitations and mobile checks. Existing prices/charts remain independent of AI setup.
