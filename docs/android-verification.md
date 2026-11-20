# Android MVP verification — 5 November 2026

For the subsequent backend fixes, 108-test result and current provider availability, see [8 November presentation checks](presentation-checks.md). The results below record the original APK build and genuine model test.

## Completed checks

| Check | Result |
| --- | --- |
| Automated regression suite | 101 tests passed |
| TypeScript | Passed |
| ESLint | Passed |
| Expo Doctor after SDK-compatible updates | All 20 checks passed |
| Android JavaScript/Hermes export | Passed; configured backend URL is bundled |
| EAS native Android release build | Finished successfully on the Free plan; signed installable APK available |
| Downloaded APK archive | ZIP integrity passed; Android manifest, DEX, ARM64 libraries and bundled JavaScript present |
| Bundle security audit | No provider endpoint/key-variable or Firebase markers found |
| Local `.env` | Correct public backend URL; Git ignored; no credentials added |
| Deployed Worker configuration | `/health` reports configured after owner's private code update |
| Dashboard, Journal, Analytics, Sessions, Coach | Loaded in an isolated browser at mobile dimensions, without changing user data |
| Binance and Kraken market display | Real BTC/ETH prices and hourly charts rendered with correct USD/USDT labels |
| Gold display | Real XAU/USD spot snapshot rendered |
| Forex display | Real daily rates/charts rendered for EUR/USD, USD/EUR, GBP/USD, USD/JPY; inverse label verified |
| Genuine online AI | Uncached Groq GPT-OSS 20B response rendered for EUR/USD using 181 actual daily observations |
| Genuine response caching | Repeat request returned the same original model response with `cached: true` |

The genuine provider response ID is `chatcmpl-3bf7acdf-16eb-41ed-b032-c2f8a3841805`. The model returned WAIT. This records a functional test, not a recommendation or proof of predictive quality. The existing app login was reused without reading or recording its access-code field. Automated model tests use mocks separately and do not replace this genuine-provider check.

The downloaded APK is `dist/TradeTrack-android.apk` (99,656,609 bytes), ignored by Git. Its SHA-256 is `8ae4a56b0867a66bc644ca2c9b73e024ab5307264c498c1e18a73e62e71067c9`.

## Fixed during live deployment testing

* Configuration errors now identify missing/invalid settings without revealing their values. The owner corrected the access code privately to satisfy the 24–128-character requirement.
* Cloudflare Workers rejects `redirect: 'error'` before making a request. Both public-history and Groq requests now use `manual` and reject redirect responses without forwarding credentials. A regression test simulates the Workers behavior rather than relying only on Node's fetch.
* Kraken HTTP-200 error envelopes now classify both rate-limit and “Too many requests” messages as HTTP 429 with a persistent cooldown.
* Browser CORS exposes Retry-After so the browser can observe the same rate-limit deadline as Android.
* Expo-supported SDK 58 dependency versions were installed; no database schema or personal data was changed by this deployment/build work.

## External limits and remaining checks

* Crypto display works directly from the device, but AI history requests from the current backend encountered Binance HTTP 403 and Kraken “Too many requests.” These provider/network restrictions are surfaced honestly. The backend does not silently substitute another exchange, bypass restrictions, or invent indicators/proposals. Forex is the verified working genuine-AI demonstration market on this deployment.
* Gold daily history is optional and still requires its separate free server-side `GOLD_API_KEY`. Gold spot does not require it. Gold AI remains unavailable because its current adapter supplies insufficient daily-average history.
* The EAS account was verified as Free with 15 unused Android builds before submission. Build `46893d76-7899-49ab-869c-5749f049711a` finished successfully and produced a signed internal-distribution APK; its artifact is on the [build page](https://expo.dev/accounts/alaa24680-tradetrack/projects/TradeTrack/builds/46893d76-7899-49ab-869c-5749f049711a).
* Physical Android installation and interaction remain manual checks. No Android device or emulator was connected to this workspace. See [installation instructions](android-install.md).

No Firebase, paid upgrade, automatic trading, store publication, GitHub push, user-data reset or credential disclosure was performed.
