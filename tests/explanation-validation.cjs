const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-service.cjs');
const { factualNarrative, verifyExplanation } = load('backend/explanationValidation.ts');
const { MarketAnalysis } = load('backend/analysis-worker.ts');
const { analyzeWithModel, AI_MODEL } = load('backend/aiProvider.ts');
const { parseAnalysisProposal } = load('services/analysisContract.ts');
// Regression fixture from the reported EUR/USD values; no live quotes are invented.
const indicators = { sma20: 1.120350, sma50: 1.126236, ema20: 1.121238, ema50: 1.127559, rsi14: 48,
  macd: { line: -0.001, signal: 0.0005, histogram: -0.0015, fast: 12, slow: 26, signalPeriod: 9 } };
const model = { action: 'SELL', explanation: 'SMA20 is above SMA50, indicating a bullish crossover.',
  conflictingSignals: ['EMA20 exceeds EMA50.'], uncertainty: 'medium',
  uncertaintyExplanation: 'RSI14 is above 70.', risks: ['MACD histogram is positive.'] };

test('Reported EUR/USD reversed SMA claim is replaced with exact server facts, preserving model action', () => {
  const result = verifyExplanation(model, indicators);
  assert.match(result.explanation, /SMA20 is below SMA50/);
  assert.match(result.explanation, /EMA20 is below EMA50/);
  assert.match(result.explanation, /MACD line is below its signal line and below zero/);
  assert.match(result.explanation, /MACD histogram is negative/);
  assert.match(result.explanation, /RSI14 is above 30, below 50 and below 70/);
  assert.equal(result.action, 'SELL'); assert.equal(result.uncertainty, 'high');
  assert.match(result.explanation, /server-generated summary/);
  assert.ok(!JSON.stringify(result).includes('bullish crossover'));
  assert.deepEqual(model.risks, ['MACD histogram is positive.']); // No input mutation.
});
test('Every narrative field is checked, including negations, paraphrases and invented numeric claims', () => {
  const safe = { action: 'WAIT', ...factualNarrative(indicators) };
  const attacks = {
    explanation: ['The short average sits on top of the long average.', 'SMA20 is not below SMA50.', 'RSI14 is 99.99.', 'A guaranteed profit is available.'],
    conflictingSignals: [['The histogram is positive despite a negative MACD line.']],
    uncertaintyExplanation: ['EMA50 is smaller than EMA20.'], risks: [['The RSI is overbought at 80.']],
  };
  for (const [field, values] of Object.entries(attacks)) for (const value of values) {
    assert.deepEqual(verifyExplanation({ ...safe, [field]: value }, indicators), safe);
  }
  assert.equal(verifyExplanation(safe, indicators), safe); // Verified/idempotent.
});
test('Comparisons cover reversed operands, exact equality and full-precision differences', () => {
  const up = { ...indicators, sma20: 2, sma50: 1, ema20: 2, ema50: 1,
    macd: { ...indicators.macd, line: 2, signal: 1, histogram: 1 } };
  const text = factualNarrative(up).explanation;
  assert.match(text, /SMA20 is above SMA50/); assert.match(text, /EMA20 is above EMA50/);
  assert.match(text, /MACD line is above its signal line and above zero/); assert.match(text, /histogram is positive/);
  const equal = factualNarrative({ ...up, sma20: 1, ema20: 1, macd: { ...up.macd, line: 0, signal: 0, histogram: 0 } });
  assert.match(equal.explanation, /SMA20 is equal to SMA50/); assert.match(equal.explanation, /EMA20 is equal to EMA50/);
  assert.match(equal.explanation, /MACD line is equal to its signal line and equal to zero/); assert.match(equal.explanation, /histogram is zero/);
  assert.match(factualNarrative({ ...up, sma20: 1.00000000001 }).explanation, /SMA20 is above SMA50/);
});
test('MACD line sign, histogram sign and signal comparison are distinct facts', () => {
  const result = factualNarrative({ ...indicators, macd: { ...indicators.macd, line: -1, signal: -2, histogram: 1 } });
  assert.match(result.explanation, /line is above its signal line and below zero/);
  assert.match(result.explanation, /histogram is positive/);
  assert.ok(result.conflictingSignals.some(text => text.includes('opposite comparison directions')));
});
test('RSI uses exact 30/50/70 boundary comparisons rather than invented overbought/oversold signals', () => {
  for (const rsi14 of [0, 29.9, 30, 30.1, 49.9, 50, 50.1, 69.9, 70, 70.1, 100]) {
    const relation = threshold => rsi14 > threshold ? 'above' : rsi14 < threshold ? 'below' : 'equal to';
    assert.ok(factualNarrative({ ...indicators, rsi14 }).explanation.includes(`RSI14 is ${relation(30)} 30, ${relation(50)} 50 and ${relation(70)} 70`));
  }
});
test('Invalid indicators cannot become factual fallback text', () => {
  for (const patch of [{ rsi14: 101 }, { rsi14: NaN }, { sma20: 0 }, { ema50: Infinity },
    { macd: { ...indicators.macd, histogram: 9 } },
    { macd: { ...indicators.macd, line: 0, signal: 0, histogram: 1e-30 } }]) assert.throws(() => verifyExplanation(model, { ...indicators, ...patch }));
});
test('Provider adapter corrects contradictory output with one model request and retains genuine request ID', async () => {
  let calls = 0;
  const result = await analyzeWithModel({ market: { source: 'frankfurter', pair: 'EUR/USD' }, interval: '1d', observationKind: 'daily-reference',
    values: Array(100).fill(1), dataAsOf: Date.now() - 86400000, fetchedAt: Date.now() }, indicators, 'test-fixture-key', async (url, options) => {
    calls++;
    const prompt = JSON.parse(JSON.parse(options.body).messages[1].content);
    assert.deepEqual(prompt.verifiedNarrative, factualNarrative(indicators));
    return Response.json({ id: 'fixture-provider-response', model: AI_MODEL, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(model) } }] });
  });
  assert.equal(calls, 1); assert.equal(result.requestId, 'fixture-provider-response');
  assert.equal(result.proposal.action, model.action); assert.match(result.proposal.explanation, /SMA20 is below SMA50/);
});
test('Legacy cached contradictions are corrected without new history/model calls or timestamp/expiry changes', async t => {
  const now = Date.now(), market = { source: 'frankfurter', pair: 'EUR/USD' };
  const cached = { ...model, version: 1, market, provider: 'Groq', model: AI_MODEL, providerRequestId: 'fixture-original-provider-id',
    generatedAt: now - 10000, expiresAt: now + 60000, dataAsOf: now - 86400000, fetchedAt: now - 20000,
    interval: '1d', observationKind: 'daily-reference', observations: 181, lastValue: 1.12, indicators };
  const map = new Map([['proposal:frankfurter:EUR/USD', cached]]);
  const storage = { get: async key => map.get(key), put: async (key, value) => map.set(key, value) };
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('No networking allowed on cache correction'); });
  const response = await new MarketAnalysis({ storage }, { GROQ_API_KEY: 'test-fixture-key', AI_FREE_TIER_CONFIRMED: 'true' })
    .fetch(new Request('https://internal/v1/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(market) }));
  assert.equal(response.status, 200);
  const body = await response.json(); assert.equal(body.cached, true);
  const checked = parseAnalysisProposal(body.proposal, market, now);
  assert.match(checked.explanation, /SMA20 is below SMA50/);
  for (const field of ['action', 'providerRequestId', 'generatedAt', 'expiresAt', 'dataAsOf', 'fetchedAt']) assert.equal(checked[field], cached[field]);
  assert.equal(map.has('quota'), false); assert.equal(map.get('proposal:frankfurter:EUR/USD').explanation, checked.explanation);
});
