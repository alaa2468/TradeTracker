const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-service.cjs');
const service = () => load('services/referenceMarkets.ts');
const clock = Date.parse('2026-11-04T12:00:00Z');
const fx = (date = '2026-11-03', rate = 1.25, base = 'EUR', quote = 'USD') => ({ date, base, quote, rate });
const response = (data, status = 200, headers) => new Response(JSON.stringify(data), { status, headers });

test('Forex parsing preserves pair direction and computes inverse prices and history exactly once', () => {
  const s = service();
  assert.equal(s.parseForex([fx()], 'EUR/USD')[0].value, 1.25);
  assert.equal(s.parseForex([fx()], 'USD/EUR')[0].value, 0.8);
  assert.equal(s.parseForex([fx('2026-11-03', 155, 'USD', 'JPY')], 'USD/JPY')[0].value, 155);
  assert.equal(s.parseForex([fx('2026-11-03', 1.3, 'GBP', 'USD')], 'GBP/USD')[0].value, 1.3);
  assert.equal(s.pairMetadata('USD/EUR').derivedFrom, 'EUR/USD');
  assert.equal(s.pairMetadata('USD/EUR').currency, 'EUR');
  assert.match(s.pairMetadata('USD/EUR').derivation, /euros per US dollar/);
});
test('Forex rejects wrong markets, malformed rates, impossible dates, duplicates and empty data', () => {
  const s = service();
  for (const value of [[], {}, [fx('2026-02-30')], [fx(), fx()], [fx('2026-11-03', 0)], [fx('2026-11-03', Infinity)],
    [fx('2026-11-03', '1.2')], [fx('2026-11-03', 1, 'USD', 'EUR')]]) {
    assert.throws(() => s.parseForex(value, 'USD/EUR'));
  }
  assert.throws(() => s.parseForex([fx()], 'XAU/USD'));
});
test('Daily history sorts genuine observations and leaves missing weekends missing', () => {
  const s = service();
  assert.deepEqual(s.parseForex([fx('2026-11-03'), fx('2026-10-30')], 'EUR/USD').map(r => r.date), ['2026-10-30', '2026-11-03']);
  assert.deepEqual(s.parseGoldHistory([{ day: '2026-11-03', avg_price: 4100 }, { day: '2026-11-02', avg_price: 4000 }]),
    [{ date: '2026-11-02', value: 4000 }, { date: '2026-11-03', value: 4100 }]);
  assert.throws(() => s.parseGoldHistory([{ day: '2026-11-03', max_price: 4200 }]));
  assert.throws(() => s.parseGoldHistory([{ day: '2026-11-03', avg_price: -1 }]));
});
test('Gold spot validates units, market, source timestamps and prices', () => {
  const s = service();
  const valid = { symbol: 'XAU', currency: 'USD', price: 4000, updatedAt: '2026-11-04T11:59:45Z' };
  assert.equal(s.parseGoldQuote(valid, clock).kind, 'spot');
  for (const patch of [{ symbol: 'XAG' }, { currency: 'EUR' }, { price: null }, { updatedAt: 'yesterday' }, { updatedAt: '2026-11-05T00:00:00Z' }]) {
    assert.throws(() => s.parseGoldQuote({ ...valid, ...patch }, clock));
  }
});
test('Daily reference freshness is distinct from spot freshness and failed fetches', () => {
  const s = service();
  const daily = { value: 1.2, fetchedAt: clock, asOf: '2026-11-03', kind: 'daily-reference' };
  assert.equal(s.referenceIsStale(daily, clock), false);
  assert.equal(s.referenceIsStale(daily, clock, 'offline'), true);
  assert.equal(s.referenceIsStale(daily, clock - 1), true);
  assert.equal(s.referenceIsStale(daily, clock + 86400001), true);
  assert.equal(s.referenceIsStale({ ...daily, asOf: '2026-10-20' }, clock), true);
  assert.equal(s.referenceIsStale({ ...daily, kind: 'spot', asOf: '2026-11-04T11:00:00Z' }, clock), true);
});
test('Forex requests only keyless official GET daily endpoints and derives inverse history', async () => {
  const s = service(), calls = [];
  const result = await s.fetchReferenceMarket('USD/EUR', { now: () => clock, fetcher: async (url, options) => {
    calls.push(url);
    assert.equal(options.method, 'GET'); assert.equal(options.credentials, 'omit');
    assert.equal(new URL(url).host, 'api.frankfurter.dev');
    assert.equal(new URL(url).searchParams.get('base'), 'EUR');
    assert.equal(new URL(url).searchParams.get('quotes'), 'USD');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    return response(url.includes('&from=') ? [fx('2026-11-02', 2), fx()] : [fx()]);
  } });
  assert.equal(calls.length, 2);
  assert.equal(result.quote.value, 0.8); assert.equal(result.quote.kind, 'daily-reference');
  assert.deepEqual(result.history.points.map(p => p.value), [0.5, 0.8]);
  assert.equal(result.quoteError, undefined);
});
test('Gold spot works without backend configuration; no secret or fabricated history is used', async () => {
  const s = service(), calls = [];
  const result = await s.fetchReferenceMarket('XAU/USD', { now: () => clock, fetcher: async (url, options) => {
    calls.push(url); assert.deepEqual(options.headers, { Accept: 'application/json' });
    return response({ symbol: 'XAU', price: 4000, updatedAt: '2026-11-04T12:00:00Z' });
  } });
  assert.deepEqual(calls, ['https://api.gold-api.com/price/XAU']);
  assert.equal(result.quote.value, 4000); assert.equal(result.history, undefined);
  assert.match(result.historyError, /optional free backend/);
});
test('Gold history uses only an HTTPS backend origin and rejects secret-bearing URL configuration', async () => {
  const s = service();
  const fetcher = async url => url.includes('/v1/gold/history') ? response([{ day: '2026-11-03', avg_price: 3900 }])
    : response({ symbol: 'XAU', price: 4000, updatedAt: '2026-11-04T12:00:00Z' });
  const result = await s.fetchReferenceMarket('XAU/USD', { now: () => clock, backendUrl: 'https://example.workers.dev', fetcher });
  assert.equal(result.history.kind, 'daily-average');
  for (const backendUrl of ['http://example.test', 'https://user:secret@example.test', 'https://example.test?key=secret', 'https://example.test/path']) {
    const bad = await s.fetchReferenceMarket('XAU/USD', { now: () => clock, backendUrl, fetcher });
    assert.match(bad.historyError, /HTTPS origin/); assert.equal(bad.history, undefined);
  }
});
test('Future source dates and malformed responses do not become valid latest rates or history', async () => {
  const s = service();
  const result = await s.fetchReferenceMarket('EUR/USD', { now: () => clock, fetcher: async () => response([fx('2026-11-05')]) });
  assert.equal(result.quote, undefined); assert.equal(result.history, undefined);
  assert.match(result.quoteError, /Invalid latest/); assert.match(result.historyError, /outside/);
});
test('API errors, HTTP 429, disconnects, malformed JSON and timeouts are visible with partial success', async () => {
  const s = service();
  const result = await s.fetchReferenceMarket('EUR/USD', { now: () => clock, fetcher: async url => url.includes('&from=')
    ? response({}, 429, { 'Retry-After': '120' }) : response([fx()]) });
  assert.equal(result.quote.value, 1.25); assert.equal(result.history, undefined);
  assert.match(result.historyError, /rate limit/); assert.equal(result.retryAt, clock + 120000);
  for (const fetcher of [async () => { throw new TypeError('offline'); }, async () => new Response('not JSON'), async () => response({}, 503)]) {
    const failed = await s.fetchReferenceMarket('EUR/USD', { now: () => clock, fetcher });
    assert.ok(failed.quoteError); assert.ok(failed.historyError); assert.equal(failed.quote, undefined);
  }
  await assert.rejects(s.requestPublicJson('https://example.test', { timeoutMs: 1, fetcher: async (url, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) }), /timed out/);
});
test('Cancellation propagates, while fresh daily history is cached without fetching it again', async () => {
  const s = service(), controller = new AbortController(); controller.abort();
  await assert.rejects(s.fetchReferenceMarket('EUR/USD', { signal: controller.signal, fetcher: async () => { throw new Error('aborted'); } }), /cancelled/);
  let calls = 0;
  const previous = { history: { points: [{ date: '2026-11-03', value: 1.25 }], fetchedAt: clock - 1000, kind: 'daily-reference' } };
  const result = await s.fetchReferenceMarket('EUR/USD', { now: () => clock, previous, fetcher: async () => { calls++; return response([fx()]); } });
  assert.equal(calls, 1); assert.equal(result.history, previous.history);
});

test('Pair switching discards obsolete requests even when the transport ignores abort', async () => {
  const { ReferenceFeed } = load('services/referenceFeed.ts');
  let now = clock, finish;
  const feed = new ReferenceFeed('EUR/USD', () => {}, { now: () => now }, async pair => {
    if (pair === 'EUR/USD') return new Promise(resolve => { finish = resolve; });
    return { quote: { value: 155, asOf: '2026-11-03', fetchedAt: now, kind: 'daily-reference' }, retryAt: 0 };
  });
  const first = feed.setActive(true); now += 100;
  await feed.selectPair('USD/JPY');
  finish({ quote: { value: 1.25 }, retryAt: 0 }); await first;
  assert.equal(feed.state.pair, 'USD/JPY'); assert.equal(feed.state.quote.value, 155);
});
test('Failed refresh keeps and marks the successful snapshot, then recovery clears the error', async () => {
  const { ReferenceFeed } = load('services/referenceFeed.ts');
  let now = clock, call = 0;
  const quote = { value: 1.25, asOf: '2026-11-03', fetchedAt: clock, kind: 'daily-reference' };
  const feed = new ReferenceFeed('EUR/USD', () => {}, { now: () => now }, async () => {
    call++; return call === 2 ? { quoteError: 'offline', historyError: 'offline', retryAt: 0 } : { quote, retryAt: 0 };
  });
  await feed.setActive(true); now += 11000; await feed.refresh();
  assert.equal(feed.state.quote, quote); assert.equal(feed.state.quoteError, 'offline');
  now += 11000; await feed.refresh(); assert.equal(feed.state.quoteError, undefined);
});
test('Background/unmount aborts, refresh deduplicates and Forex/Gold rate limits stay isolated', async () => {
  const { ReferenceFeed } = load('services/referenceFeed.ts');
  let finish, signal, calls = 0, now = clock;
  const feed = new ReferenceFeed('EUR/USD', () => {}, { now: () => now }, async (pair, options) => {
    calls++; signal = options.signal; return new Promise(resolve => { finish = resolve; });
  });
  const pending = feed.setActive(true); await feed.refresh(); assert.equal(calls, 1);
  await feed.setActive(false); assert.equal(signal.aborted, true);
  finish({ quote: { value: 5 }, retryAt: 0 }); await pending;
  assert.equal(feed.state.quote, undefined); assert.equal(feed.state.loading, false);
  now += 11000;
  const limited = new ReferenceFeed('EUR/USD', () => {}, { now: () => now }, async () => ({ quoteError: 'rate limit', retryAt: now + 120000 }));
  await limited.setActive(true);
  let goldCalls = 0;
  const gold = new ReferenceFeed('XAU/USD', () => {}, { now: () => now }, async () => { goldCalls++; return { retryAt: 0 }; });
  await gold.setActive(true); assert.equal(goldCalls, 1);
  let otherCalls = 0;
  const other = new ReferenceFeed('GBP/USD', () => {}, { now: () => now }, async () => { otherCalls++; return { retryAt: 0 }; });
  await other.setActive(true); assert.equal(otherCalls, 0); assert.equal(other.state.retryAt, now + 120000);
});

test('Gold history cooldown does not block keyless spot; spot Retry-After is honored across screens', async () => {
  const { ReferenceFeed } = load('services/referenceFeed.ts');
  let now = clock, calls = 0;
  const feed = new ReferenceFeed('XAU/USD', () => {}, { now: () => now }, async () => {
    calls++;
    return calls === 1 ? { historyError: 'history limited', retryAt: now + 3600000 }
      : { quoteError: 'spot limited', retryAt: now + 120000, quoteRetryAt: now + 120000 };
  });
  await feed.setActive(true); assert.equal(feed.state.retryAt, now + 30000);
  now += 30001; await feed.refresh(); assert.equal(calls, 2);
  let reopenedCalls = 0;
  const reopened = new ReferenceFeed('XAU/USD', () => {}, { now: () => now }, async () => { reopenedCalls++; return { retryAt: 0 }; });
  await reopened.setActive(true); assert.equal(reopenedCalls, 0); assert.equal(reopened.state.retryAt, now + 120000);
});
