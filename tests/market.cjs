const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const ts = require('typescript');
const moduleCode = ts.transpileModule(fs.readFileSync('services/binance.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const marketModule = { exports: {} };
new Function('module', 'exports', moduleCode)(marketModule, marketModule.exports);
const market = marketModule.exports;
const timestamp = new Date(2026, 10, 4, 14).getTime();
function historyRows() {
  return Array.from({ length: 24 }, (_, i) => {
    const start = timestamp - (23 - i) * 3600000;
    return [start, '100', '200', '50', String(100 + i), '1000', start + 3599999, '100000', 10, '500', '50000', '0'];
  });
}
function validPayload(url) {
  const parsed = new URL(url), symbol = parsed.searchParams.get('symbol');
  return parsed.pathname.endsWith('/klines') ? historyRows() : { symbol, price: symbol === 'BTCUSDT' ? '68000.12000000' : '2500.34000000' };
}
const okFetch = async url => new Response(JSON.stringify(validPayload(url)), { status: 200 });

test('market requests only two allowlisted Spot symbols using public GET endpoints without credentials', async () => {
  const requests = [];
  const results = await market.fetchMarketData({ fetcher: async (url, options) => {
    requests.push({ url, options });
    return okFetch(url);
  }, now: () => timestamp });
  assert.equal(requests.length, 4);
  for (const { url, options } of requests) {
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://data-api.binance.vision');
    assert.ok(['/api/v3/ticker/price', '/api/v3/klines'].includes(parsed.pathname));
    assert.ok(['BTCUSDT', 'ETHUSDT'].includes(parsed.searchParams.get('symbol')));
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(options.body, undefined);
    if (parsed.pathname.endsWith('/klines')) {
      assert.equal(parsed.searchParams.get('limit'), '24');
      assert.equal(parsed.searchParams.get('interval'), '1h');
    }
  }
  assert.equal(results.filter(r => 'value' in r).length, 4);
  const data = market.mergeMarketResults({ BTCUSDT: {}, ETHUSDT: {} }, results);
  assert.equal(data.BTCUSDT.quote.price, 68000.12);
  assert.equal(data.ETHUSDT.quote.price, 2500.34);
  assert.equal(data.BTCUSDT.quote.fetchedAt, timestamp);
  assert.equal(data.BTCUSDT.history.candles.length, 24);
});

test('quote validation rejects mismatched symbols, partial numbers, non-finite and non-positive prices', () => {
  for (const price of ['', '1oops', '-1', '0', 'NaN', 'Infinity', '1e100', '9'.repeat(400), 100, null]) {
    assert.throws(() => market.parseQuote({ symbol: 'BTCUSDT', price }, 'BTCUSDT', timestamp));
  }
  assert.throws(() => market.parseQuote({ symbol: 'ETHUSDT', price: '123' }, 'BTCUSDT', timestamp), /unexpected/);
});

test('chart validation rejects malformed, empty, duplicate, reversed or missing hourly intervals', () => {
  for (const input of [null, [], [historyRows()[0]], [1, 2], historyRows().reverse()]) {
    assert.throws(() => market.parseHistory(input, timestamp));
  }
  const duplicate = historyRows(); duplicate[1] = duplicate[0];
  assert.throws(() => market.parseHistory(duplicate, timestamp), /unordered/);
  const missing = historyRows(); missing.splice(1, 1);
  assert.throws(() => market.parseHistory(missing, timestamp), /missing/);
  const invalid = historyRows(); invalid[0][4] = 'not a price';
  assert.throws(() => market.parseHistory(invalid, timestamp), /invalid price/);
  const wrongInterval = historyRows(); wrongInterval[0][6] += 60000;
  assert.throws(() => market.parseHistory(wrongInterval, timestamp), /invalid hourly/);
});

test('partial chart or pair failure keeps successful quotes and the last successful history', async () => {
  const initial = market.mergeMarketResults({ BTCUSDT: {}, ETHUSDT: {} }, await market.fetchMarketData({ fetcher: okFetch, now: () => timestamp }));
  const results = await market.fetchMarketData({ now: () => timestamp + 10000, fetcher: async url => {
    if (url.includes('ETHUSDT')) throw new TypeError('Network request failed');
    if (url.includes('/klines')) return new Response('{}', { status: 503 });
    return new Response(JSON.stringify({ symbol: 'BTCUSDT', price: '69000' }));
  } });
  const next = market.mergeMarketResults(initial, results);
  assert.equal(next.BTCUSDT.quote.price, 69000);
  assert.equal(next.BTCUSDT.history, initial.BTCUSDT.history);
  assert.match(next.BTCUSDT.historyError, /503/);
  assert.equal(next.ETHUSDT.quote, initial.ETHUSDT.quote);
  assert.match(next.ETHUSDT.quoteError, /internet connection/);
  assert.equal(initial.BTCUSDT.historyError, undefined, 'previous state is not mutated');
});

test('a successful retry replaces the cached resource and clears its error', async () => {
  const previous = { BTCUSDT: { quoteError: 'Offline', historyError: 'Offline' }, ETHUSDT: { quoteError: 'Offline' } };
  const next = market.mergeMarketResults(previous, await market.fetchMarketData({ fetcher: okFetch, now: () => timestamp }));
  assert.equal(next.BTCUSDT.quoteError, undefined);
  assert.equal(next.BTCUSDT.historyError, undefined);
  assert.equal(next.ETHUSDT.quoteError, undefined);
});

test('disconnections and unreadable JSON become user-facing errors rather than fabricated data', async () => {
  const disconnected = await market.fetchMarketData({ fetcher: async () => { throw new TypeError('Failed to fetch'); } });
  assert.equal(disconnected.length, 4);
  assert.ok(disconnected.every(r => r.error.includes('internet connection') && !('value' in r)));
  const invalidJson = await market.fetchMarketData({ fetcher: async () => new Response('<html>Error</html>') });
  assert.ok(invalidJson.every(r => r.error.includes('unreadable')));
});

test('rate limits honor Retry-After and fall back to a cooldown for bans or missing headers', async () => {
  for (const status of [429, 418]) {
    const results = await market.fetchMarketData({ now: () => timestamp,
      fetcher: async () => new Response('{}', { status, headers: { 'Retry-After': '120' } }) });
    assert.ok(results.every(r => r.retryAt === timestamp + 120000 && r.error.includes('cooldown')));
  }
  assert.equal(market.retryDeadline(null, timestamp), timestamp + 60000);
  assert.equal(market.retryDeadline(new Date(timestamp + 90000).toUTCString(), timestamp), timestamp + 90000);
  assert.equal(market.retryDeadline('invalid', timestamp), timestamp + 60000);
  assert.ok(market.retryDeadline('0', timestamp) > timestamp);
});

test('regional access failures are explained without switching to an unofficial data host', async () => {
  for (const status of [403, 451]) {
    const urls = [];
    const results = await market.fetchMarketData({ fetcher: async url => { urls.push(url); return new Response('{}', { status }); } });
    assert.ok(results.every(r => r.error.includes('location or network')));
    assert.ok(urls.every(url => url.startsWith(market.BINANCE_DATA_ORIGIN)));
    assert.equal(urls.length, 4);
  }
});

const abortingFetch = (_url, options) => new Promise((_resolve, reject) => {
  if (options.signal.aborted) reject(new Error('aborted'));
  else options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
});

test('a stalled connection times out and surfaces a retryable error', async () => {
  const results = await market.fetchMarketData({ fetcher: abortingFetch, timeoutMs: 10 });
  assert.ok(results.every(r => r.error.includes('timed out')));
});

test('cancelling requests rejects the refresh so stale asynchronous results cannot be committed', async () => {
  const controller = new AbortController();
  const pending = market.fetchMarketData({ signal: controller.signal, fetcher: abortingFetch });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  // A fetch implementation that resolves after abort must also be discarded.
  const lateController = new AbortController();
  const late = market.fetchMarketData({ signal: lateController.signal, fetcher: async url => {
    lateController.abort(); return okFetch(url);
  } });
  await assert.rejects(late, { name: 'AbortError' });
});

test('stale status covers failed refreshes, clock rollback and the exact age boundary', () => {
  assert.equal(market.marketIsStale(undefined, timestamp), true);
  assert.equal(market.marketIsStale(timestamp, timestamp), false);
  assert.equal(market.marketIsStale(timestamp, timestamp + 59999), false);
  assert.equal(market.marketIsStale(timestamp, timestamp + 60000), true);
  assert.equal(market.marketIsStale(timestamp, timestamp, 'Offline'), true);
  assert.equal(market.marketIsStale(timestamp, timestamp - 1), true);
});
