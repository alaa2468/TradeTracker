# Deterministic AI explanation validation

Deployed Worker version: `4dd92ad2-67b6-4dd3-952d-c24096916a6a`.

The EUR/USD report exposed a model explanation that reversed SMA20 and SMA50 despite receiving correct server-calculated values. Supplying the numbers in a prompt is not enough to make prose factual.

## Backend behavior

`backend/explanationValidation.ts` renders canonical wording directly from the calculated indicators:

* SMA20 compared with SMA50, and EMA20 compared with EMA50.
* MACD line compared with its signal line and zero, plus the actual histogram sign. An inconsistent histogram (`line - signal`) is rejected.
* RSI14 compared with 30, 50 and 70, including exact equality at each boundary.
* Opposite comparison directions among the two moving-average pairs and MACD line/signal, without interpreting them as an instruction to trade.

Comparisons use full precision, not the rounded app display. A current-value comparison does not establish a crossover or forecast future prices.

Natural-language claims can be paraphrased, negated or hidden in any field. A regex list cannot prove arbitrary prose accurate. The backend therefore accepts only exact canonical wording and conservatively replaces all other narrative fields with server-rendered facts, high uncertainty and explicit limitations. This includes seemingly correct or generic model prose that cannot be deterministically verified. The prompt supplies the canonical wording to reduce mismatches.

The UI text explicitly identifies the server-generated summary. The genuine Groq action and response ID remain unchanged; the server does not invent BUY, SELL or WAIT, or claim that comparisons justify the model's action. This deliberately limits the explanation to verified facts; it does not preserve unrestricted model reasoning. There is no automatic model retry or extra quota consumption for a correction.

The guard runs after a successful, schema-valid model response and before new proposals are cached. Valid cached proposals from older deployments are checked and corrected on read, retaining their original generation/data/fetch/expiry timestamps and `cached: true`. Expired or malformed results do not become valid through correction. Provider failures, refusals and invalid output still produce Analysis Unavailable rather than a fabricated proposal.

## Regression coverage

The regression fixture uses the reported SMA20 1.120350, SMA50 1.126236, EMA20 1.121238 and EMA50 1.127559. Both comparisons must say below. Additional fixture values are isolated test inputs, not production market observations.

Tests cover reversed/equal/full-precision comparisons, MACD line/signal versus histogram signs, exact RSI thresholds, paraphrases/negations/invented numeric claims across narrative fields, invalid indicators, one-call correction, and legacy cached-response correction without networking, quota use or timestamp changes. The full suite has 116 tests; TypeScript and ESLint also pass.

No frontend, API response schema, SQLite migration or secret value changed. No new Android APK is required. After backend deployment, press Analyze Market again to fetch the corrected response; already displayed text from a previous request cannot change retroactively. Use the existing private demo code, and never provide it in chat.

A fresh authenticated Groq call was not made during this fix because the private rotated code was not requested or read. Provider-adapter tests use clearly isolated fixtures; the application never serves those as real AI output.
