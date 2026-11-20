# TradeTrack Android APK

## Configured project

* Expo project: https://expo.dev/accounts/alaa24680-tradetrack/projects/TradeTrack
* Android package: `com.alaa.tradetrack`
* Backend: https://tradetrack-market-data.alaa-tradetrack.workers.dev
* Current build (1.0.1, Android versionCode 2): https://expo.dev/accounts/alaa24680-tradetrack/projects/TradeTrack/builds/e05ae9c7-8875-4bf6-9ed1-2d4b629f277e
* Completed APK download: https://expo.dev/artifacts/eas/8pYfGvBbW9NgXJR69qUmEYmHDUcRaV8OSmY8ah2DC2s.apk

The Expo account was checked on 5 November 2026: Free plan, with unused Android build allowance before this build. No paid upgrade, Firebase service, store submission or GitHub push is required. `preview` produces an installable APK with its JavaScript included; it does not need Expo Go or the development computer running.

## Install the completed build

1. Open the completed APK download link above on your Android phone, or open the build page and select **Install** or **Download**.
2. Save the `.apk` file. Do not download an `.aab`; that is a different format.
3. Open the downloaded APK and select **Update** if TradeTrack is already installed. Do not uninstall the existing app or clear its storage. If Android blocks installation, allow **Install unknown apps** temporarily for the browser or Files app you used, then return and select **Update** (or **Install** for a first installation).
4. Open **TradeTrack** and keep an internet connection for market data and AI. Journal, sessions and Psychology Coach use local SQLite storage.
5. Open **Dashboard → Open AI Trading Agent → Forex**. Select **EUR/USD**, enter your existing private demo access code, confirm adult eligibility and press **Analyze Market**. This is the market verified with a genuine Groq response. Never enter the Groq API key in the app. Binance AI still encounters a backend restriction. Kraken's history retrieval was verified after the 8 November backend fixes; see [presentation-checks.md](presentation-checks.md) for current results and phone test steps.
6. Verify a proposal shows its market, source, interval, calculated indicators, uncertainty, risks and provider response ID. Nothing in this app places an order.
7. Disable the temporary unknown-app installation permission when finished.

## Preserve your existing data

Do not uninstall the existing app, clear its storage or reset SQLite. An Android update with the same package and signing key normally retains the app's data. If Android reports a signing/version conflict, stop and keep the existing installation; do not uninstall it as a workaround. This build uses the EAS-managed signing key for this project.

Expo Go and a standalone APK have separate application storage. Data recorded inside Expo Go remains there and is not automatically copied into this APK. A first standalone installation may therefore show an empty personal journal without deleting the Expo Go journal. No migration between those app sandboxes is implemented here.

## Configuration and diagnostics

The local `.env` contains only the public backend URL and is ignored by Git. EAS receives that URL explicitly from `eas.json`, because ignored `.env` files are excluded from the build upload. `.easignore` also excludes backend files, tests, local environment files and database/signing files. Provider keys and demo access codes are not bundled in the APK.

The backend's `/health` endpoint reports configuration readiness without secret values. “Configured” does not prove model access, quota, free billing status or a successful AI response. The demo access code must be 24–128 characters; update it privately in Cloudflare if necessary. Gold's optional daily history still requires its separate free server-side key; Gold spot prices do not.

Android physical-device behavior must be checked after installation. Browser tests at mobile dimensions and a successful Android build do not replace device testing. See [ai-testing.md](ai-testing.md) for model limits and [market-testing.md](market-testing.md) for each market's source/units/freshness checks.
