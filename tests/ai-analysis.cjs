const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-service.cjs');
const indicators = load('utils/indicators.ts');
const contract = load('services/analysisContract.ts');
const data = load('backend/analysisData.ts');
const provider = load('backend/aiProvider.ts');
const worker = load('backend/analysis-worker.ts');
const client = load('services/analysisClient.ts');
const explanationValidation = load('backend/explanationValidation.ts');
const HOUR = 3600000, DAY = 86400000;
const now = Date.parse('2026-11-05T12:30:00Z');
const market = { source: 'binance', pair: 'BTC/USDT' };
const modelText = { action: 'WAIT', explanation: 'Experimental analysis based only on the supplied indicators.',
  conflictingSignals: ['Momentum and trend can disagree.'], uncertainty: 'high', uncertaintyExplanation: 'No news or order book information was supplied.', risks: ['Historical behavior may not persist.'] };
function candles(clock = now, count = 201) {
  const hour = Math.floor(clock / HOUR) * HOUR;
  return Array.from({ length: count }, (_, i) => {
    const start = hour - (count - 1 - i) * HOUR;
    return [start, '100', '200', '50', String(100 + i), '1', start + HOUR - 1, '1', 1, '1', '1', '0'];
  });
}
function forex(clock = now, count = 181) {
  return Array.from({ length: count }, (_, i) => ({ date: new Date(clock - (count - 1 - i) * DAY).toISOString().slice(0, 10), base: 'EUR', quote: 'USD', rate: 1 + i / 1000 }));
}
const response = (payload, status = 200, headers) => new Response(JSON.stringify(payload), { status, headers });
const envelope = (proposal = modelText) => ({ id: 'chatcmpl-real-provider-id', model: provider.AI_MODEL, choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(proposal) } }] });
function storage() {
  const map = new Map(); return { map, get: async key => map.get(key), put: async (key, value) => { map.set(key, value); } };
}
const request = (body = market, code = 'university-demo-access-123456') => new Request('https://worker.test/v1/analysis', {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${code}` }, body: JSON.stringify(body),
});
function proposal(clock = Date.now(), selection = market) {
  const daily = selection.source === 'frankfurter';
  return { ...modelText, version: 1, market: selection, provider: 'Groq', model: provider.AI_MODEL, providerRequestId: 'provider-id-123',
    generatedAt: clock, expiresAt: clock + 60000, dataAsOf: clock - (daily ? DAY : HOUR), fetchedAt: clock - 1000,
    interval: daily ? '1d' : '1h', observationKind: daily ? 'daily-reference' : 'closed-candle',
    ...(selection.pair === 'USD/EUR' ? { derivedFrom: 'EUR/USD' } : {}), observations: 200, lastValue: 300,
    indicators: indicators.calculateIndicators(Array.from({ length: 200 }, (_, i) => i + 100)) };
}

test('Wilder RSI matches an independently published example and handles flat/up/down histories', () => {
  const example = [44.34,44.09,44.15,43.61,44.33,44.83,45.1,45.42,45.84,46.08,45.89,46.03,45.61,46.28,46.28];
  assert.ok(Math.abs(indicators.rsi(example) - 70.464135) < 0.00001);
  assert.equal(indicators.rsi(Array(100).fill(10)), 50);
  assert.equal(indicators.rsi(Array.from({ length: 100 }, (_, i) => i + 1)), 100);
  assert.equal(indicators.rsi(Array.from({ length: 100 }, (_, i) => 100 - i)), 0);
  assert.throws(() => indicators.rsi([1,2,3]));
});
test('SMA-seeded EMA and MACD align their periods, with analytic linear/constant reference values', () => {
  assert.deepEqual(indicators.emaSeries([1,2,3,4,5], 3), [2,3,4]);
  const result = indicators.calculateIndicators(Array.from({ length: 200 }, (_, i) => i + 1));
  assert.equal(result.sma20, 190.5); assert.equal(result.sma50, 175.5);
  assert.equal(result.ema20, 190.5); assert.equal(result.ema50, 175.5);
  assert.ok(Math.abs(result.macd.line - 7) < 1e-10);
  assert.ok(Math.abs(result.macd.signal - 7) < 1e-10); assert.ok(Math.abs(result.macd.histogram) < 1e-10);
  const flat = indicators.calculateIndicators(Array(150).fill(100));
  assert.equal(flat.macd.histogram, 0); assert.equal(flat.rsi14, 50);
});
test('Indicator calculation refuses short, nonfinite, zero and negative price data', () => {
  for (const values of [Array(99).fill(10), [...Array(100).fill(10), NaN], [...Array(100).fill(10), 0], Array(100).fill(-1), Array(100).fill(Infinity)]) {
    assert.throws(() => indicators.calculateIndicators(values));
  }
});
test('Crypto analysis uses real closed hourly candles and discards forming candles', () => {
  const result = data.parseCryptoHistory(candles(), market, now);
  assert.equal(result.values.length, 200); assert.equal(result.values.at(-1), 299);
  assert.equal(result.dataAsOf, Math.floor(now / HOUR) * HOUR); assert.equal(result.interval, '1h');
  const kraken = { source: 'kraken', pair: 'BTC/USD' };
  const rows = candles().map(row => [row[0] / 1000, row[1], row[2], row[3], row[4], '100', '1', 1]);
  assert.deepEqual(data.parseCryptoHistory({ error: [], result: { XXBTZUSD: rows, last: 123 } }, kraken, now).values, result.values);
  assert.throws(() => data.parseCryptoHistory({ error: ['EGeneral:error'], result: {} }, kraken, now));
  assert.throws(() => data.parseCryptoHistory({ error: [], result: { XETHZUSD: rows } }, kraken, now));
});
test('Crypto analysis rejects short, gapped, stale, unordered, future, malformed and invalid-price history', () => {
  for (const rows of [candles().slice(0, 50), candles().filter((_, i) => i !== 50), candles(now - 10 * HOUR), candles().reverse(), candles(now + 10 * HOUR)]) {
    assert.throws(() => data.parseCryptoHistory(rows, market, now));
  }
  for (const patch of [row => { row[4] = '0'; }, row => { row[6]++; }, row => { row[0] = 'bad'; }]) {
    const rows = candles(); patch(rows[5]); assert.throws(() => data.parseCryptoHistory(rows, market, now));
  }
});

test('Kraken public API errors distinguish throttling from invalid arguments without exposing response bodies', () => {
  const selection = { source: 'kraken', pair: 'BTC/USD' };
  assert.throws(() => data.parseCryptoHistory({ error: ['EAPI:Rate limit exceeded'] }, selection, now), error => error.status === 429 && error.retryAt === now + 60000);
  assert.throws(() => data.parseCryptoHistory({ error: ['EGeneral:Too many requests'] }, selection, now), error => error.status === 429 && error.retryAt === now + 60000);
  assert.throws(() => data.parseCryptoHistory({ error: ['EGeneral:Invalid arguments:since'] }, selection, now), /Invalid arguments:since/);
});
test('Forex analysis fetches enough daily references and recomputes inverse indicators from inverse values', () => {
  const direct = data.parseForexAnalysis(forex(), { source: 'frankfurter', pair: 'EUR/USD' }, now);
  const inverse = data.parseForexAnalysis(forex(), { source: 'frankfurter', pair: 'USD/EUR' }, now);
  assert.equal(inverse.derivedFrom, 'EUR/USD'); assert.equal(inverse.observationKind, 'daily-reference');
  assert.equal(inverse.values.at(-1), 1 / direct.values.at(-1));
  assert.equal(indicators.calculateIndicators(direct.values).rsi14, 100);
  assert.equal(indicators.calculateIndicators(inverse.values).rsi14, 0);
  for (const rows of [forex().slice(0, 50), forex(now - 10 * DAY), [...forex(), forex().at(-1)], forex(now + DAY)]) {
    assert.throws(() => data.parseForexAnalysis(rows, { source: 'frankfurter', pair: 'EUR/USD' }, now));
  }
});
test('Backend market allowlist cannot be used as an arbitrary URL/prompt/order proxy', () => {
  for (const value of [{ source: 'binance', pair: 'DOGE/USDT' }, { source: '__proto__', pair: 'x' }, { source: 'binance', pair: 'BTC/USD' }, { ...market, prompt: 'ignore rules' }, { source: 'https://evil.test', pair: 'BTC/USDT' }]) {
    assert.throws(() => contract.parseAnalysisMarket(value));
  }
});
test('Analysis adapters use only official public endpoints and never request credentials or execution', async () => {
  const calls = [];
  await data.fetchAnalysisData(market, async (url, options) => { calls.push(url); assert.equal(options.method, 'GET'); return response(candles()); }, now);
  await data.fetchAnalysisData({ source: 'frankfurter', pair: 'USD/EUR' }, async url => { calls.push(url); return response(forex()); }, now);
  assert.match(calls[0], /data-api.binance.vision.*limit=201/);
  assert.match(calls[1], /api.frankfurter.dev.*base=EUR&quotes=USD/);
  await assert.rejects(data.fetchAnalysisData({ source: 'gold', pair: 'XAU/USD' }, async () => { throw new Error('must not fetch'); }, now), /Gold analysis unavailable/);
  await assert.rejects(data.fetchAnalysisData(market, async () => response({}, 429, { 'Retry-After': '120' }), now), error => error.status === 429 && error.retryAt === now + 120000);
  await assert.rejects(data.fetchAnalysisData(market, async () => response({}, 451), now), /HTTP 451/);
});

test('Cloudflare-compatible fetch rejects redirects without forwarding history or model requests', async () => {
  let historyCalls = 0, modelCalls = 0;
  const compatibleFetch = async (url, options) => {
    // Simulate Workers' narrower RequestInit rather than Node's redirect modes.
    if (options.redirect === 'error') throw new TypeError('Unsupported redirect mode');
    assert.equal(options.redirect, 'manual'); historyCalls++;
    return response(candles());
  };
  assert.equal((await data.fetchAnalysisData(market, compatibleFetch, now)).values.length, 200);
  assert.equal(historyCalls, 1);
  await assert.rejects(data.fetchAnalysisData(market, async (url, options) => {
    assert.equal(options.redirect, 'manual'); return new Response(null, { status: 302, headers: { Location: 'https://other.test' } });
  }, now), /unavailable/);
  const snapshot = data.parseCryptoHistory(candles(), market, now);
  await assert.rejects(provider.analyzeWithModel(snapshot, indicators.calculateIndicators(snapshot.values), 'server-key', async (url, options) => {
    if (options.redirect === 'error') throw new TypeError('Unsupported redirect mode');
    assert.equal(options.redirect, 'manual'); modelCalls++;
    return new Response(null, { status: 307, headers: { Location: 'https://other.test' } });
  }), /unavailable/);
  assert.equal(modelCalls, 1);
});
test('Genuine model adapter sends server-calculated inputs to Groq with strict schema and no tools', async () => {
  const snapshot = data.parseCryptoHistory(candles(), market, now), calculated = indicators.calculateIndicators(snapshot.values);
  const result = await provider.analyzeWithModel(snapshot, calculated, 'server-only-secret', async (url, options) => {
    assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions'); assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, 'Bearer server-only-secret');
    const body = JSON.parse(options.body), supplied = JSON.parse(body.messages[1].content);
    assert.equal(body.model, 'openai/gpt-oss-20b'); assert.equal(body.response_format.json_schema.strict, true);
    assert.deepEqual(supplied.indicators, calculated); assert.equal(supplied.recentValues.length, 12);
    assert.equal(body.tools, undefined); assert.ok(!options.body.includes('server-only-secret'));
    assert.equal(supplied.journal, undefined); assert.equal(supplied.portfolio, undefined);
    return response(envelope());
  });
  assert.deepEqual(result.proposal, { ...modelText, ...explanationValidation.factualNarrative(calculated) });
  assert.equal(result.requestId, 'chatcmpl-real-provider-id');
});
test('Invalid/refused/truncated AI outputs and HTTP/network failures never produce fallback recommendations', async () => {
  const snapshot = data.parseCryptoHistory(candles(), market, now), calculated = indicators.calculateIndicators(snapshot.values);
  const bad = [response({ error: 'upstream-secret' }, 401), response({ error: 'upstream-secret' }, 500), response({ ...envelope(), model: 'paid-other-model' }),
    response({ ...envelope(), choices: [{ finish_reason: 'length', message: { content: JSON.stringify(modelText) } }] }),
    response(envelope({ ...modelText, action: 'EXECUTE' })), response(envelope({ ...modelText, risks: [] })),
    response(envelope({ ...modelText, secret: 'forbidden extra property' })), new Response('not-json')];
  for (const payload of bad) {
    await assert.rejects(provider.analyzeWithModel(snapshot, calculated, 'secret', async () => payload), error => {
      assert.equal(error.status, 503); assert.ok(!error.message.includes('upstream-secret')); return true;
    });
  }
  await assert.rejects(provider.analyzeWithModel(snapshot, calculated, 'secret', async () => response({}, 429, { 'Retry-After': '7200' })), e => e.status === 429 && e.retryAt > Date.now() + 7199000);
  await assert.rejects(provider.analyzeWithModel(snapshot, calculated, 'secret', async () => { throw new TypeError('offline'); }), /No substitute/);
});
test('Proposal contract enforces selected pair, dates, expiry, source kind and valid calculated indicators', () => {
  assert.equal(contract.parseAnalysisProposal(proposal(now), market, now).action, 'WAIT');
  for (const patch of [{ market: { source: 'kraken', pair: 'BTC/USD' } }, { expiresAt: now - 1 }, { dataAsOf: now - DAY }, { interval: '1d' },
    { observations: 24 }, { derivedFrom: 'EUR/USD' }, { lastValue: NaN }, { provider: 'Fake' }, { generatedAt: now + DAY }]) {
    assert.throws(() => contract.parseAnalysisProposal({ ...proposal(now), ...patch }, market, now));
  }
  assert.throws(() => contract.parseAnalysisProposal({ ...proposal(now), indicators: { ...proposal(now).indicators, rsi14: 101 } }, market, now));
});
test('AI endpoint is disabled until free plan and secrets are configured; auth, methods and body limits are enforced', async () => {
  const env = { AI_FREE_TIER_CONFIRMED: 'true', GROQ_API_KEY: 'server-secret', AI_ACCESS_CODE: 'university-demo-access-123456',
    ANALYSIS: { idFromName: x => x, get: () => ({ fetch: async req => { assert.equal(req.headers.get('Authorization'), null); return response({ okay: true }); } }) } };
  assert.equal((await worker.handleAnalysis(request(), {})).status, 503);
  assert.equal((await worker.handleAnalysis(request(market, 'wrong-code'), env)).status, 401);
  assert.equal((await worker.handleAnalysis(new Request('https://worker.test/v1/analysis'), env)).status, 405);
  assert.equal((await worker.handleAnalysis(request({ ...market, payload: 'x'.repeat(2000) }), env)).status, 413);
  assert.equal((await worker.handleAnalysis(request({ ...market, prompt: 'bad' }), env)).status, 400);
  assert.equal((await worker.handleAnalysis(request(), env)).status, 200);
  const preflight = await worker.handleAnalysis(new Request('https://worker.test/v1/analysis', { method: 'OPTIONS' }), env);
  assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
  assert.equal(preflight.headers.get('Access-Control-Expose-Headers'), 'Retry-After');
});

test('Readiness identifies invalid configuration without exposing keys, access codes or their values', async () => {
  const good = { AI_FREE_TIER_CONFIRMED: 'true', GROQ_API_KEY: 'private-provider-key', AI_ACCESS_CODE: 'private-demo-passphrase-with-entropy' };
  assert.equal((await (worker.analysisHealth(good)).json()).analysis, 'configured');
  for (const [patch, expected] of [[{ AI_FREE_TIER_CONFIRMED: ' true ' }, 'AI_FREE_TIER_CONFIRMED'],
    [{ GROQ_API_KEY: '' }, 'GROQ_API_KEY'], [{ AI_ACCESS_CODE: 'private-too-short' }, '24–128']]) {
    const body = await worker.analysisHealth({ ...good, ...patch }).json();
    assert.equal(body.analysis, 'configuration-required'); assert.ok(body.issue.includes(expected));
    assert.ok(!JSON.stringify(body).includes('private-provider-key'));
    assert.ok(!JSON.stringify(body).includes('private-demo-passphrase-with-entropy'));
    assert.ok(!JSON.stringify(body).includes('private-too-short'));
  }
});
test('End-to-end backend pipeline calculates indicators, calls model once, caches genuine proposal and persists quota', async t => {
  const state = { storage: storage() }; let marketCalls = 0, aiCalls = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (url.includes('api.groq.com')) { aiCalls++; return response(envelope()); }
    marketCalls++; return response(candles(Date.now()));
  });
  const env = { GROQ_API_KEY: 'server-only-secret', AI_FREE_TIER_CONFIRMED: 'true' };
  const instance = new worker.MarketAnalysis(state, env);
  const result = await instance.fetch(request()); assert.equal(result.status, 200);
  const body = await result.json(); assert.equal(body.cached, false); assert.equal(body.proposal.action, 'WAIT');
  assert.equal(body.proposal.observations, 200); assert.ok(!JSON.stringify(body).includes(env.GROQ_API_KEY));
  const cached = await new worker.MarketAnalysis(state, env).fetch(request());
  assert.equal((await cached.json()).cached, true); assert.equal(aiCalls, 1); assert.equal(marketCalls, 1);
  const other = await instance.fetch(request({ source: 'binance', pair: 'ETH/USDT' }));
  assert.equal(other.status, 429); assert.equal(aiCalls, 1);
  assert.equal(state.storage.map.get('quota').calls, 1);
});
test('Insufficient history, Gold and exhausted daily budgets do not invoke the model', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return response(candles().slice(0, 24)); });
  const env = { GROQ_API_KEY: 'secret', AI_FREE_TIER_CONFIRMED: 'true' }, state = { storage: storage() };
  assert.equal((await new worker.MarketAnalysis(state, env).fetch(request())).status, 422);
  assert.equal(calls, 1); assert.equal(state.storage.map.has('quota'), false);
  assert.equal((await new worker.MarketAnalysis(state, env).fetch(request({ source: 'gold', pair: 'XAU/USD' }))).status, 422);
  assert.equal(calls, 1);
  state.storage.map.set('quota', { date: new Date().toISOString().slice(0, 10), calls: 20, nextAttempt: 0 });
  assert.equal((await new worker.MarketAnalysis(state, env).fetch(request())).status, 429); assert.equal(calls, 1);
});
test('AI 429 backoff survives object restart and provider failures cannot generate cached success', async t => {
  const state = { storage: storage() }, env = { GROQ_API_KEY: 'secret', AI_FREE_TIER_CONFIRMED: 'true' };
  t.mock.method(globalThis, 'fetch', async url => url.includes('api.groq.com') ? response({}, 429, { 'Retry-After': '7200' }) : response(candles(Date.now())));
  const first = await new worker.MarketAnalysis(state, env).fetch(request()); assert.equal(first.status, 429);
  const quota = state.storage.map.get('quota'); assert.equal(quota.calls, 1); assert.ok(quota.nextAttempt > Date.now() + 7199000);
  const restarted = await new worker.MarketAnalysis(state, env).fetch(request()); assert.equal(restarted.status, 429);
  assert.equal(state.storage.map.has('proposal:binance:BTC/USDT'), false);
});
test('Mobile client requires HTTPS, only sends market selection plus demo auth, validates response and cooldown', async () => {
  const signal = new AbortController().signal;
  const result = await client.requestAnalysis(market, 'university-demo-access-123456', 'https://worker.test', signal, async (url, options) => {
    assert.equal(url, 'https://worker.test/v1/analysis'); assert.equal(options.credentials, 'omit');
    assert.deepEqual(JSON.parse(options.body), market); assert.equal(options.method, 'POST');
    return response({ proposal: proposal(), cached: false });
  });
  assert.equal(result.proposal.action, 'WAIT');
  for (const url of [undefined, 'http://worker.test', 'https://user:secret@worker.test', 'https://worker.test?key=secret']) {
    await assert.rejects(client.requestAnalysis(market, 'university-demo-access-123456', url, signal));
  }
  await assert.rejects(client.requestAnalysis(market, 'university-demo-access-123456', 'https://worker.test', signal, async () => response({ error: 'free quota exhausted' }, 429, { 'Retry-After': '60' })), e => e.retryAt > Date.now() + 59000);
});
test('Mobile analysis is manual, deduplicated and discards obsolete responses after leaving or switching markets', async () => {
  let calls = 0, finish, signal;
  const feed = new client.AnalysisFeed(market, () => {}, 'https://worker.test', async (selected, code, url, requestSignal) => {
    calls++; signal = requestSignal; return new Promise(resolve => { finish = resolve; });
  });
  feed.setActive(true); assert.equal(calls, 0);
  const pending = feed.analyze('university-demo-access-123456'); await feed.analyze('university-demo-access-123456');
  assert.equal(calls, 1); feed.setActive(false); assert.equal(signal.aborted, true);
  finish({ proposal: proposal(), cached: false }); await pending;
  assert.equal(feed.state.proposal, undefined); assert.equal(feed.state.loading, false);
});

test('AI model timeout aborts the upstream call and cannot produce a fallback recommendation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const snapshot = data.parseCryptoHistory(candles(), market, now);
  let signal;
  const pending = provider.analyzeWithModel(snapshot, indicators.calculateIndicators(snapshot.values), 'secret', async (url, options) => {
    signal = options.signal;
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  });
  t.mock.timers.tick(25000);
  await assert.rejects(pending, /timed out/); assert.equal(signal.aborted, true);
});

test('Mobile timeout ends loading even if a transport ignores abort; its late result is discarded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finish, signal;
  const feed = new client.AnalysisFeed(market, () => {}, 'https://worker.test', async (selected, code, url, requestSignal) => {
    signal = requestSignal; return new Promise(resolve => { finish = resolve; });
  });
  feed.setActive(true); const pending = feed.analyze('university-demo-access-123456');
  t.mock.timers.tick(45000);
  assert.equal(signal.aborted, true); assert.equal(feed.state.loading, false); assert.match(feed.state.error, /timed out/);
  finish({ proposal: proposal(), cached: false }); await pending;
  assert.equal(feed.state.proposal, undefined); assert.match(feed.state.error, /timed out/);
});

test('Blocked Binance history does not reserve Groq quota or block a healthy Forex analysis', async t => {
  const state = { storage: storage() }, env = { GROQ_API_KEY: 'test-only-key', AI_FREE_TIER_CONFIRMED: 'true' };
  let aiCalls = 0, binanceCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('binance')) { binanceCalls++; return response({}, 403); }
    if (url.includes('frankfurter')) return response(forex(Date.now()));
    aiCalls++; return response(envelope());
  });
  const blocked = await new worker.MarketAnalysis(state, env).fetch(request());
  assert.equal(blocked.status, 503); assert.ok(Number(blocked.headers.get('Retry-After')) >= 899);
  assert.equal(state.storage.map.has('quota'), false);
  const retry = await new worker.MarketAnalysis(state, env).fetch(request());
  assert.equal(retry.status, 503); assert.equal(binanceCalls, 1);
  const healthy = await new worker.MarketAnalysis(state, env).fetch(request({ source: 'frankfurter', pair: 'EUR/USD' }));
  assert.equal(healthy.status, 200); assert.equal(aiCalls, 1);
  assert.equal((await healthy.json()).proposal.market.source, 'frankfurter');
});
test('Failed model requests reuse valid real history after the model cooldown', async t => {
  const state = { storage: storage() }, env = { GROQ_API_KEY: 'test-only-key', AI_FREE_TIER_CONFIRMED: 'true' };
  let marketCalls = 0, aiCalls = 0;
  t.mock.method(globalThis, 'fetch', async url => {
    if (url.includes('api.groq.com')) { aiCalls++; return aiCalls === 1 ? response({}, 503) : response(envelope()); }
    marketCalls++; return response(candles(Date.now()));
  });
  assert.equal((await new worker.MarketAnalysis(state, env).fetch(request())).status, 503);
  const quota = state.storage.map.get('quota');
  state.storage.map.set('quota', { ...quota, nextAttempt: 0 }); // Simulate elapsed model cooldown, keeping original market timestamps.
  assert.equal((await new worker.MarketAnalysis(state, env).fetch(request())).status, 200);
  assert.equal(aiCalls, 2); assert.equal(marketCalls, 1);
});
