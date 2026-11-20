# Genuine online AI: free setup and mobile testing

## What is implemented, and what is not yet activated

The app now has a manual **Analyze Market** panel for Binance BTC/USDT and ETH/USDT, Kraken BTC/USD and ETH/USD, and all four Forex pairs. The backend fetches its own historical market data, computes RSI(14), SMA(20/50), EMA(20/50), and MACD(12,26,9), then requests a genuine hosted language-model response. BUY, SELL and WAIT are model-generated hypothetical research proposals. No predefined-rule recommendation or sample model response is used in the running app.

**A genuine online response was verified on 5 November 2026** through the deployed Worker and the app's existing authenticated browser session: EUR/USD, Frankfurter, 181 daily observations, Groq `openai/gpt-oss-20b`, HTTP 200, uncached WAIT proposal rendered in the app. Provider response ID: `chatcmpl-3bf7acdf-16eb-41ed-b032-c2f8a3841805`. No access code or provider key was read or logged for that test. This confirms the real request flow, not predictive quality. Automated tests still mock the model API for repeatable success/error tests; those fixtures never appear as live results. Physical Android behavior remains to be checked after APK installation.

The deployed Worker is `https://tradetrack-market-data.alaa-tradetrack.workers.dev`; `/health` checks configuration without revealing values. Live deployment testing found and fixed a Workers compatibility error: Workers rejects `redirect: 'error'` before networking, so outbound calls now use `manual` and reject non-success redirect responses without forwarding credentials. A regression test covers this difference from Node's fetch.

Gold prices/history remain available, but Gold **Analysis Unavailable** is deliberate: its current free history adapter supplies approximately 45 daily averages, below the required 100 observations. It does not provide the closed-candle history used for Crypto analysis. This version does not request additional Gold data or consume its history quota for AI.

## Why Groq instead of enabling Gemini

Verified against official sources on **5 November 2026**:

* [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) lists free API quotas, and its [billing FAQ](https://ai.google.dev/gemini-api/docs/billing/) says free access exists in supported European regions. However, the current [Gemini API terms](https://ai.google.dev/gemini-api/terms), effective 23 March 2026, separately restrict distributing API clients to EEA/UK/Swiss users to Paid Services. They define paid Gemini API access as a project with active billing. Personal/developer free access therefore does not establish permission for this distributed mobile project. Gemini has not been enabled, no Google billing account is required by this implementation, and no workaround is attempted. Revisit Gemini only with clear provider confirmation of a no-billing arrangement for the intended audience.
* [Groq's free-plan limits](https://console.groq.com/docs/rate-limits) explicitly list `openai/gpt-oss-20b`; the current published summary lists 30 requests/minute, 1,000 requests/day, 8,000 tokens/minute and 200,000 tokens/day. **The exact limits shown in your account take precedence and may change.** [Groq billing documentation](https://console.groq.com/docs/billing-faqs) distinguishes Free from the paid Developer upgrade. Remain on Free, without payment details. A quota failure must remain unavailable, never trigger an upgrade.
* The [Groq Services Agreement](https://console.groq.com/docs/legal/services-agreement) allows integrating models into customer applications for end users and requires adult users. Check your account's country/model availability and applicable terms during registration. The app includes an age confirmation; this is self-declaration, not verified identity. Give the university demo code only to adult testers.
* [GPT-OSS 20B](https://developers.openai.com/api/docs/models/gpt-oss-20b) is an OpenAI open-weight model. **Groq hosts and serves it here.** An OpenAI API account, OpenAI API key, ChatGPT subscription or self-hosted GPU is not required. Groq supports [strict structured output](https://console.groq.com/docs/structured-outputs) for this model. The backend pins that model; no automatic paid/model/provider fallback is configured.
* Hosting uses the existing Cloudflare backend on **Workers Free**, with SQLite-backed Durable Objects available on Free. [Workers Free](https://developers.cloudflare.com/workers/platform/pricing/) has finite limits, including 100,000 requests/day and 10 ms CPU per invocation. [Durable Objects Free](https://developers.cloudflare.com/durable-objects/platform/pricing/) also has compute/storage/request limits. Network wait time differs from CPU time; actual deployed CPU/runtime behavior still needs verification. If the free runtime limits are insufficient, disable analysis and investigate; do not enable paid hosting.

No free service promises permanent availability or unlimited capacity. We cannot inspect your account's plan or eligibility without you configuring it. `AI_FREE_TIER_CONFIRMED` is an explicit operator confirmation, **not an automated billing audit**. Never set it for a paid account/key.

## 1. Create and verify a free Groq account

1. Open [Groq Console](https://console.groq.com/), sign up, and verify your account if requested.
2. Check account **Billing** and confirm **Free**. Do not add a card, bank account, SEPA payment method or paid subscription, and do not select the Developer upgrade.
3. Open the account **Limits** page. Confirm that `openai/gpt-oss-20b` is available with a nonzero free allowance. Check model permissions if necessary. If the model requires a paid plan in your account/region, stop; leave analysis disabled and report that limitation.
4. Create a dedicated API key for this project. Keep it private. Do not put it in the mobile app, Expo `.env`, Git, screenshots or chat messages. You will paste it only into the Cloudflare secret prompt below.
5. Optionally enable Zero Data Retention in Groq's Data Controls. [Groq's data policy](https://console.groq.com/docs/your-data) describes temporary reliability/abuse retention and controls. This application sends only public market context and calculated indicators to the model, never your journal, coaching notes, account details or portfolio.

## 2. Deploy or update the existing free backend

These commands run from the TradeTrack root folder:

```sh
cd /Users/alaa/Documents/Student/MSA/TradeTrack
npx --yes wrangler@4 login
npx --yes wrangler@4 deploy --config backend/wrangler.jsonc
```

Use a **Cloudflare Workers Free** account and the generated HTTPS `workers.dev` URL. No GitHub connection or custom domain is needed. If a paid upgrade is requested, stop. The CLI may download its development tools; it adds no mobile dependency. On this workspace's older macOS, Wrangler warns that local runtime emulation is unsupported; packaging can still be checked, and the hosted runtime is separate. The owner has now completed account/secret setup, and the backend fixes have been deployed to the Worker listed above; these commands are for future redeployment, not a request to repeat setup.

Existing deployments retain the GoldHistory `v1` migration. The added `v2` migration creates a separate MarketAnalysis object. Keep both migration entries; do not reset the existing namespace or local app SQLite database.

Then set three backend secrets, one command at a time:

```sh
npx --yes wrangler@4 secret put GROQ_API_KEY --config backend/wrangler.jsonc
npx --yes wrangler@4 secret put AI_ACCESS_CODE --config backend/wrangler.jsonc
npx --yes wrangler@4 secret put AI_FREE_TIER_CONFIRMED --config backend/wrangler.jsonc
```

* At `GROQ_API_KEY`, paste your dedicated **Free** Groq API key.
* At `AI_ACCESS_CODE`, create a separate, random **24–128 character** demo passphrase using a password manager. This is the code you enter in the app and share only with authorized adult university testers. **It must not be the Groq key, a trading key, or an account password.** Rotate it with the same command if it is exposed. For this small demo it is a shared access code, not a full individual-user authentication system.
* Set `AI_FREE_TIER_CONFIRMED` to exactly `true` **only after** verifying that both the Groq account and Cloudflare hosting remain Free without paid billing. This switch enables model requests. Without it the backend fails closed.

Do not put secret values directly into shell commands; the prompts keep them out of command history. Do not change observability to log authorization headers, requests or secrets. Gold's existing `GOLD_API_KEY` is independent and optional; AI analysis does not need it.

To disable AI later, set `AI_FREE_TIER_CONFIRMED` to `false` with the same secret command. Public market prices and Gold history remain independent.

## 3. Point the mobile app at the online backend

Create or update `.env` in the TradeTrack project root, preserving any existing settings:

```dotenv
EXPO_PUBLIC_MARKET_BACKEND_URL=https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev
```

Use only the HTTPS origin, without a path, query, username or password. This URL is public and safe to bundle. **No secret belongs in any `EXPO_PUBLIC_*` variable.** The existing Gold-history configuration uses the same URL.

Stop Expo with **Ctrl+C**, then run:

```sh
npm start -- --clear
```

Open your existing Expo SDK 58 compatible client on Android/iPhone and scan the QR code. For the development preview, keep phone and computer on the same Wi-Fi. The installed standalone app would call the hosted backend directly without the personal computer; Expo's development preview itself still requires the development server. This implementation does not create signed Android/iOS installers or publish to stores.

## 4. Test a genuine AI response on Android/iPhone

1. Open **Dashboard → Open AI Trading Agent → Crypto → Binance**.
2. Select **BTC/USDT** in the hourly-chart selector. The analysis panel must refer to the same pair and exchange.
3. Enter your separate demo access code, confirm you are 18 or older, and press **Analyze Market**. Never enter the provider key.
4. Wait for the loading state. The backend requests up to 201 hourly candles, excludes the forming hour, uses up to 200 closed observations, computes the indicators and calls Groq. No AI call happens just because the screen opens or market prices refresh.
5. A successful result shows BUY, SELL or WAIT; the exact source/pair/interval; calculated indicators; the AI's explanation, conflicting signals, uncertainty and risks; generation/source/fetch/expiry times; model name; and provider response ID. It must not show Approve/Execute controls. Cross-check the provider's usage console to confirm the dedicated key's activity; valid responses are not proof of predictive accuracy.
6. Repeat Analyze on that market after the short client cooldown. A cached genuine response should retain its original generation/expiry timestamps and say it is cached. Crypto proposals last at most 15 minutes; Forex at most one hour. Expired/stale results must not remain displayed as current actions.
7. Wait at least 60 seconds before analyzing another market, then test Binance ETH/USDT and Kraken BTC/USD/ETH/USD. If Binance is blocked from the backend's deployment region, its analysis must remain unavailable; explicitly select Kraken instead. It must never silently replace the exchange or currency.
8. Test **Forex → EUR/USD**, then **USD/EUR**, **GBP/USD**, and **USD/JPY**, respecting the shared cooldown. The backend requests approximately 180 calendar days and requires at least 100 actual daily observations. Forex results must say daily reference data, not live/hourly trading candles. USD/EUR must show inverse-derived provenance; its indicators are recomputed on reciprocal observations, not inverted from EUR/USD indicators.
9. Open **Gold**. Verify **Analysis Unavailable** explains the insufficient daily-average history. Spot prices and any configured daily-history chart must continue working.

The shared demo protection allows at most **one new analysis attempt per minute and 20 model calls per UTC day**, including failed model calls. UTC midnight is 02:00 in Bucharest on 5 November 2026; daylight-saving offsets change seasonally. Cached genuine proposals do not consume new model calls. Provider limits may be lower; 429 honors Retry-After and persists backoff across backend restarts. There is no paid overflow, automatic retry storm, quota bypass, or fabricated WAIT result on failure.

## 5. Verify error handling and data preservation

* Enter an incorrect demo code: expect an authentication error, no market/model request and no proposal.
* Leave secrets/confirmation unconfigured: expect Analysis Unavailable, while market display still works.
* Use airplane mode during analysis: expect a network/timeout error. Backgrounding/leaving the screen cancels the request locally; a backend request already accepted may still complete and consume its reserved quota. Returning never displays an obsolete response under a different selection. The demo code clears when the app backgrounds and must be entered again.
* Switch pair/exchange/category while loading: late responses must be discarded. No automatic analysis should start on the new selection.
* Free quota/model unavailability, malformed/refused/truncated output, stale history, missing intervals or fewer than 100 observations: expect Analysis Unavailable, never a replacement recommendation. Use automated mocks to test 429 instead of intentionally exhausting the real free account.
* Verify Journal, Sessions, Analytics, Dashboard and Psychology Coach, including existing saved trades/check-ins/preferences. No app SQLite schema change or user-data upload was added. Do not uninstall/reset app storage to perform these checks.

## Indicator and security details

RSI uses Wilder smoothing over 14 changes; completely flat input is represented as RSI 50. EMA uses an initial SMA seed and multiplier `2 / (period + 1)`. MACD uses aligned EMA12 minus EMA26, a 9-period SMA-seeded EMA signal, and their difference as histogram. At least 100 observations are required; up to 200 are used. Seeds and history length can produce differences from other chart platforms. Crypto must have uninterrupted hourly intervals and recent closed data; Forex can omit weekends/holidays, but duplicate/future dates, long gaps and stale source dates are rejected. No missing prices are filled.

Formula references: [Fidelity RSI](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/RSI), [Fidelity EMA](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/ema), [Fidelity MACD](https://www.fidelity.com/learning-center/trading-investing/technical-analysis/technical-indicator-guide/macd), and [StockCharts RSI calculation](https://chartschool.stockcharts.com/table-of-contents/technical-indicators-and-overlays/technical-indicators/relative-strength-index-rsi).

`POST /v1/analysis` accepts only an allowlisted source/pair JSON body, bounded to 1 KiB. No caller-supplied URL, prompt, model name, price history, API key, journal or order details are accepted. HTTPS, a server-side access-code comparison, strict model schema, independent output validation, timeouts, persistent quotas and separate public market-data fetching protect the demo. CORS supports web access but is not authentication. Numeric indicators are computed by our code; model narrative can still be wrong, and no schema can guarantee factual investment analysis. No real-money trading path exists.

The server stores only public market proposals, indicator snapshots and quota counters. It does not persist the demo code on the phone. All provider secrets stay in Cloudflare bindings, and upstream error bodies are not forwarded. Before any public production release, replace the shared demo code with individual authentication and access controls, review provider/distribution terms and deployment security, and evaluate model quality. No Firebase is involved.

## Automated checks and remaining verification

```sh
npm test
npm run typecheck
npm run lint
npx expo export --platform all --output-dir /tmp/tradetrack-ai-export
npx --yes wrangler@4 deploy --dry-run --config backend/wrangler.jsonc --outdir /tmp/tradetrack-ai-worker-export
```

Tests use analytic/published indicator references, real-shaped historical fixtures, mocked provider success/failure, payload validation, server secrets/authentication, persistent quotas/cache behavior and canceled mobile requests, plus the existing market/journal/coaching regression suite. JavaScript/Hermes and web bundle exports do not test physical phone interaction or signed native installers. The Worker packaging dry run does not test a running Durable Object, deployed CPU limits, account eligibility or a genuine model call. Those remain explicit manual checks after setup.
