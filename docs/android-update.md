# TradeTrack 1.0.1 Android update

This update hides the AI analysis panel, demo-code field and Analyze Market button for Binance and Gold. Binance BTC/ETH prices and hourly charts are preserved. Gold spot and its existing history panel/adapter are preserved; its optional history provider remains unconfigured/unavailable in the tested deployment. Kraken BTC/USD and ETH/USD and all four Forex pairs retain the original AI analysis component.

The hidden AI components, contracts and backend code are retained for future restoration. No backend deployment, secret rotation, SQLite migration, user-data reset or GitHub push is part of this update.

Verification: all 116 automated tests, TypeScript, ESLint and Android Hermes bundle export passed. Isolated mobile-width web checks verified Binance and Gold AI controls are absent; Kraken and Forex AI controls are present; real Binance/Kraken charts, Forex charts and Gold spot still render; Dashboard, Journal, Analytics, Sessions and Psychology Coach load. The latest genuine three-market AI checks are in the earlier web test report; this UI-only change does not modify the analysis request, response or backend logic.

Application ID remains `com.alaa.tradetrack`. Version is `1.0.1` with Android versionCode `2`, above the previous APK's versionCode `1`. EAS confirmed reuse of the existing remote Android keystore. The account was checked as Free with 1 of 15 Android builds used before submission, no add-ons and zero estimated charges.

Build: https://expo.dev/accounts/alaa24680-tradetrack/projects/TradeTrack/builds/e05ae9c7-8875-4bf6-9ed1-2d4b629f277e

The native release build finished successfully. APK: https://expo.dev/artifacts/eas/8pYfGvBbW9NgXJR69qUmEYmHDUcRaV8OSmY8ah2DC2s.apk

The downloaded APK passed ZIP integrity checks. Its binary Android manifest confirms `com.alaa.tradetrack`, versionName `1.0.1`, versionCode `2`. Its APK signing-block certificate matches the previous 1.0.0 APK exactly (SHA-256 `3ac6508edb83f87e1d10ea2e2e6dbb4468d8a42fbb68ad53bb90718038151d6b`). The APK file SHA-256 is `4a531c1a414601261ff8d559cec3c3a3e0195b5d9a1034b1ba7fc84445238d03`. The local copy is `dist/TradeTrack-1.0.1-android.apk`, ignored by Git.

After downloading the completed APK, open it on the same phone and select **Update**. Do not uninstall TradeTrack or clear its storage. If Android reports a signing conflict, retain the existing app and report the error instead of uninstalling. Physical phone update/data-retention checks require installation on the owner's device; no phone is connected here.
