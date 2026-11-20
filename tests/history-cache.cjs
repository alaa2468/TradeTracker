const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-service.cjs');
const { cachedAnalysisData } = load('backend/historyCache.ts');
const HOUR = 3600000;
const now = Date.parse('2026-11-08T12:30:00Z');
const market = { source: 'binance', pair: 'BTC/USDT' };
function storage() {
  const map = new Map();
  return { map, get: async key => map.get(key), put: async (key, value) => map.set(key, value) };
}
function candles(clock = now) {
  const hour = Math.floor(clock / HOUR) * HOUR;
  return Array.from({ length: 201 }, (_, i) => {
    const start = hour - (200 - i) * HOUR;
    return [start, '100', '200', '50', '150', '1', start + HOUR - 1, '1', 1, '1', '1', '0'];
  });
}
const response = (body, status = 200, headers) => new Response(JSON.stringify(body), { status, headers });

test('History survives object restart, preserves original timestamps and separates pairs', async () => {
  const state = storage(); let calls = 0;
  const fetcher = async () => { calls++; return response(candles()); };
  const first = await cachedAnalysisData(state, market, fetcher, now);
  const second = await cachedAnalysisData(state, market, fetcher, now + 1000);
  assert.deepEqual(second, first); assert.equal(calls, 1);
  await cachedAnalysisData(state, { source: 'binance', pair: 'ETH/USDT' }, fetcher, now + 1000);
  assert.equal(calls, 2);
});
test('History refreshes on TTL expiry and the next hourly close, without inventing freshness', async () => {
  const state = storage(); let calls = 0;
  const fetcher = async () => { calls++; return response(candles()); };
  await cachedAnalysisData(state, market, fetcher, now);
  await cachedAnalysisData(state, market, fetcher, now + 300000);
  assert.equal(calls, 2);
  const boundary = Date.parse('2026-11-08T12:59:30Z');
  await cachedAnalysisData(state, market, async () => response(candles(boundary)), boundary);
  const fresh = await cachedAnalysisData(state, market, async () => { calls++; return response(candles(boundary + 60000)); }, boundary + 60000);
  assert.equal(calls, 3); assert.equal(fresh.dataAsOf, Date.parse('2026-11-08T13:00:00Z'));
});
test('429 cooldown survives restart, doubles after failure and honors longer Retry-After', async () => {
  const state = storage(); let calls = 0;
  const limited = async () => { calls++; return response({}, 429); };
  await assert.rejects(cachedAnalysisData(state, market, limited, now), e => e.retryAt === now + 60000);
  await assert.rejects(cachedAnalysisData(state, market, limited, now + 1000), e => e.retryAt === now + 60000);
  assert.equal(calls, 1);
  await assert.rejects(cachedAnalysisData(state, market, limited, now + 60000), e => e.retryAt === now + 180000);
  assert.equal(calls, 2);
  await assert.rejects(cachedAnalysisData(state, market, async () => response({}, 429, { 'Retry-After': '7200' }), now + 180000), e => e.retryAt === now + 7380000);
});
test('Provider restriction does not block another exchange and never returns stale history', async () => {
  const state = storage();
  await cachedAnalysisData(state, market, async () => response(candles()), now);
  await assert.rejects(cachedAnalysisData(state, market, async () => response({}, 403), now + 300000), e => e.status === 503 && e.retryAt === now + 1200000);
  let blockedCalls = 0;
  await assert.rejects(cachedAnalysisData(state, market, async () => { blockedCalls++; return response(candles()); }, now + 400000));
  assert.equal(blockedCalls, 0);
  let krakenUrl;
  const result = await cachedAnalysisData(state, { source: 'kraken', pair: 'BTC/USD' }, async url => {
    krakenUrl = url;
    return response({ error: [], result: { XXBTZUSD: candles().map(row => [row[0] / 1000, '100', '200', '50', '150', '150', '1', 1]) } });
  }, now + 400000);
  assert.equal(result.market.source, 'kraken'); assert.equal(new URL(krakenUrl).searchParams.has('since'), false);
});
test('Corrupt cache and wrong-market data cannot reach indicator calculation', async () => {
  const state = storage(), key = 'history:v1:binance:BTC/USDT';
  const valid = await cachedAnalysisData(state, market, async () => response(candles()), now);
  for (const patch of [{ values: [NaN] }, { market: { source: 'kraken', pair: 'BTC/USD' } }, { fetchedAt: now + 60000 }, { dataAsOf: now + HOUR }]) {
    state.map.set(key, { ...valid, ...patch });
    let fetched = false;
    await cachedAnalysisData(state, market, async () => { fetched = true; return response(candles()); }, now);
    assert.equal(fetched, true);
  }
});
