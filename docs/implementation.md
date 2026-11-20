# TradeTrack implementation guide

TradeTrack is the existing Expo / React Native application. It saves its data locally in SQLite. It does not connect to a broker or calculate instrument-specific profit formulas.

## Stage 1: Save personal sessions safely

`db/database.ts` now creates a `sessions` table with an ID, start time, end time, duration in seconds, and active/completed status. A database index allows only one active session. This protects the rule even if two start requests arrive together.

The migration adds `session_id` and `timestamp` to the existing trades table. It keeps the existing table, trade IDs, prices, P/L, notes, moods, dates, demo flags, and other fields. Older column names such as `entryPrice` remain to avoid an unnecessary table replacement. The database version is now 2.

Existing trades have no personal session or exact time because the old app never recorded these. They appear as **Unassigned legacy trade** and **time not recorded**. The app does not invent missing history.

Migration changes run in a transaction: either the whole migration succeeds or SQLite rolls it back. Database calls are asynchronous and run through one shared queue. The queue also survives development Fast Refresh, so an editor reload cannot start a second transaction over an existing one.

## Stage 2: Start and end sessions yourself

`src/app/(tabs)/sessions.tsx` calls `startSession()` when Start Session is pressed. The database records the current time. The screen shows elapsed time calculated from that saved start time.

The display clock runs only while the screen is focused and the app is in the foreground. It never changes a session's saved status. Closing the app, switching tabs, entering the background, weekends, and market hours do not end a session.

End Session asks for confirmation, then `endSession()` saves the end time and duration. Empty sessions are allowed and remain in history.

`src/app/session/[id].tsx` opens a saved session and shows its trades, duration, and results. Session statistics are calculated from linked trades rather than stored as duplicate totals. Editing or deleting a trade therefore updates the session's statistics while preserving the session itself.

## Stage 3: Record and manage trades

`src/app/(tabs)/journal.tsx` shows the journal, search, and delete confirmation. It uses React Native `FlatList` so long journals do not need to render every card at once.

`components/TradeEditor.tsx` contains the add/edit form. It supports an instrument, BUY/SELL, positive entry/exit prices, positive position size, manually entered signed P/L, local date/time, strategy, mood, notes, and optional individual trade duration. Profit and Loss buttons let mobile users choose the sign without needing a minus key.

New trades require an active personal session. The database chooses that session automatically when saving. When editing, the original session association is preserved, including when that session is already completed. A trade's time must be within its session. Leave a new trade's time blank to save the current time automatically. Enter a custom local time using `YYYY-MM-DD HH:mm:ss`.

Older date-only trades keep their unknown time when edited unless you explicitly supply one. Deleting a trade requires a second tap to confirm. Session history remains saved.

## Stage 4: Calculate real statistics

`utils/statistics.ts` is the shared calculation code for Dashboard, Analytics, and session details:

- Net P/L is the sum of the entered P/L values.
- A positive P/L is a win; negative is a loss; zero is breakeven.
- Win rate is winning trades divided by all trades, including breakeven trades.
- Average P/L is net P/L divided by the trade count.
- Empty lists return zero instead of dividing by zero.
- Trading time comes from personal sessions, including active elapsed time. Individual trade durations are not added together because trades can overlap.

Dashboard keeps All Time, 30 Days, and 7 Days. Day filters include today and use the device's local calendar. If a session crosses the start of the selected period, only the portion inside that period contributes to time. Legacy trades still contribute to P/L and counts, but have no invented personal-session duration.

Analytics keeps profit factor, average wins/losses, mood comparisons, and instrument comparisons. It also includes overall results, recent P/L bars, personal-session performance with detail links, and recent history. The full history is available in Sessions and Journal.

`hooks/JournalProvider.tsx` shares loaded data across screens. After a save, edit, delete, start, or end, refreshing this data updates every screen. It reloads saved data when returning to the app. `hooks/useTrades.ts` refreshes on screen focus; `hooks/useNow.ts` manages the foreground display clock.

## Stage 5: Keep examples separate

My trades is the default every time the app opens. Demo examples is a separate, clearly marked view shared across Dashboard, Journal, and Analytics. Demo examples are read-only. Refreshing demo examples replaces only rows marked as demo; it does not remove real trades or sessions. Demo examples do not create personal sessions or contribute to real statistics.

`src/app/(tabs)/_layout.tsx` keeps Dashboard, Journal, Analytics, and Sessions and now exposes the Coach tab described below. No AI service or API was added.

`components/TradingUI.tsx` provides shared dark cards, buttons, charts, and summaries. `src/app/_layout.tsx` supplies the shared data provider, dark navigation theme, and session detail route. The earlier Safari startup and SQLite web fixes in `metro.config.js` and `src/app/+html.tsx` remain in place.

## How to demonstrate it

1. Open Sessions and press Start Session.
2. Open Journal and log a trade with a P/L of `200`.
3. Log another trade with a P/L of `-150`.
4. Dashboard and Analytics should show $50 total, $25 average, and a 50% win rate.
5. Close and reopen the app. The session should still be active.
6. End the session manually, then open it in history to see both trades.
7. Edit or delete a trade in Journal and inspect the updated totals.
8. Switch to Demo examples and back to see that real results are kept separate.

## Validation

Run `npm test`, `npm run lint`, and `npm run typecheck`. The regression tests execute the application's SQL against a real in-memory SQLite database; they replace only the Expo connection boundary. They cover migration preservation, session persistence, concurrent starts, association rules, edits/deletion, demo refresh safety, failed writes, date validation, calendar filters, duration boundaries, and development reloads.

Browser interaction checks use a separate browser profile, so demonstration trades do not enter your normal browser's journal. Phone-width browser checks cover the controls and layout. Successful iOS/Android JavaScript bundle exports check platform compilation; they do not replace testing on a physical phone.

Verified for this update: all 21 regression tests, lint, and TypeScript checks passed. Browser checks covered session start/end, reopening an active session, journal add/edit/delete, statistics, filters, demo separation, and saved history. All four screens loaded in Safari and passed layout checks at 320px and 768px widths in Chrome. The final iOS, Android, and web export completed successfully. No physical-device test was performed.

SQLite data is local to each app installation or browser origin. Your desktop browser, Expo app on a phone, and a different browser do not share the same journal. On web, use one TradeTrack tab per browser origin to avoid SQLite's exclusive browser-storage lock.

## Trading Psychology Coach

Coach is now the fifth tab and reuses the existing Coach route and journal-summary helpers. Its copy explicitly identifies offline rules rather than an AI model. It provides reflection and discipline support without investment or buy/sell recommendations. No packages or external services were added.

SQLite schema version 3 adds `session_check_ins`, `coach_preferences`, and `coach_session_state`. Existing trade/session rows are not rewritten. Creating a session and its optional before-session check-in is atomic. Ending a session is saved before the after-session form opens; skipping or failing that form does not undo the session end. A missed after-session reflection can be added from Coach or any completed session's detail screen. Recorded-at dates distinguish later reflections. Missing before-session feelings are never backfilled.

Check-ins record one of the journal's six moods, stress from 1 (relaxed) to 5 (very stressed), and optional notes of up to 1000 characters. Both phases are optional. Check-ins appear in session details.

`utils/coach.ts` implements the behavior rules independently of the UI. Defaults are five trades within a sliding 30-minute window, three consecutive losses within one personal session, and 120 elapsed session minutes. Users can save different thresholds or restore defaults from Coach. A breakeven or winning trade resets a loss streak. Live coaching uses the trailing frequency window and current loss streak; weekly summaries consider patterns occurring in that reporting period. Stress of 4–5 or a reported stressed/frustrated mood prompts reflection. Losses alone are not treated as evidence of an emotion. Demo trades, unknown timestamps, future timestamps, and trades outside a personal session do not trigger intraday behavior signals.

Sessions and Coach display evidence for possible patterns, a dismiss action, and an optional five-minute break. Break deadlines and dismissals persist across navigation and app restarts. Breaks do not end sessions or block journal entry. Dismissed duration reminders do not reappear merely because another minute passed. This version schedules no background notifications; expired timers are acknowledged when the screen is viewed.

Weekly insights cover today and the preceding six device-local calendar dates. They compare trade counts with the preceding seven dates when both periods contain activity, summarize flagged sessions, show paired mood/stress changes, and suggest a discipline goal based on recorded patterns. Session time is clipped to the reporting period. These reports are recomputed from current data, so editing/deleting trades changes the observations. Legacy trades contribute to counts without invented intraday times. Small or missing samples are explicitly described.

Automated coverage includes schema migration preservation/rollback, check-in/session atomicity, optional check-ins, duplicate post-session saves, preferences and break persistence, demo refresh isolation, rule thresholds, unsorted timestamps, sliding windows, breakeven resets, unknown/future data, emotion signals, paired check-ins, and local weekly boundaries. Run `npm test`, `npm run lint`, and `npm run typecheck`.

Manual device testing is still needed for touch and keyboard behavior, screen-reader flow, small screens and enlarged fonts, app background/relaunch during a break, and upgrading a real installed app with existing journal data. Bundle exports validate compilation rather than these device interactions.
