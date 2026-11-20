const assert = require('node:assert/strict');
const { test } = require('node:test');
const load = require('./helpers/load-service.cjs');
const kraken = load('services/kraken.ts');
const markets = load('services/markets.ts');
const { MarketFeed } = load('services/marketFeed.ts');
const now = Date.UTC(2026, 10, 4, 14, 30);
const hour = Math.floor(now / 3600000) * 3600;
const ticker = (key = 'XXBTZUSD', price = '78000.50') => ({ error: [], result: { [key]: { a: ['78010'], b: ['77990'], c: [price, '0.01'] } } });
const ohlc = (key = 'XXBTZUSD', length = 24) => ({ error: [], result: {
  [key]: Array.from({ length }, (_, i) => [hour - (length - i - 1) * 3600, '100', '130', '90', String(100 + i), '110', '30.5', 20]), last: hour,
} });
function payload(url) {
  const parsed = new URL(url);
  const key = parsed.searchParams.get('pair') === 'XBTUSD' ? 'XXBTZUSD' : 'XETHZUSD';
  return parsed.pathname.endsWith('/Ticker') ? ticker(key) : ohlc(key);
}
const validFetch = async url => new Response(JSON.stringify(payload(url)));
const quote = (price, resource = 'quote') => [{ asset: 'BTC', resource, value: { price, fetchedAt: now } }];
function feed(fetcher, time = () => now, cooldowns = { binance: 0, kraken: 0 }) {
  return new MarketFeed(() => {}, fetcher, time, cooldowns);
}

test('Kraken ticker reads the last trade rather than bid/ask, and recognizes exact pair aliases', () => {
  for (const key of ['XXBTZUSD', 'XBTUSD', 'BTCUSD', 'BTC/USD']) {
    assert.deepEqual(kraken.parseKrakenQuote(ticker(key), 'BTCUSD', now), { price: 78000.5, fetchedAt: now });
  }
  for (const key of ['XETHZUSD', 'ETHUSD', 'ETH/USD']) {
    assert.equal(kraken.parseKrakenQuote(ticker(key, '2300.25'), 'ETHUSD', now).price, 2300.25);
  }
});

test('Kraken cannot silently parse a different market or substitute USDT for USD', () => {
  for (const key of ['BTCUSDT', 'XETHZUSD', 'XXBTZEUR', 'last']) {
    assert.throws(() => kraken.parseKrakenQuote(ticker(key), 'BTCUSD', now), /unexpected market pair/);
  }
  const ambiguous = ticker(); ambiguous.result.XBTUSD = ambiguous.result.XXBTZUSD;
  assert.throws(() => kraken.parseKrakenQuote(ambiguous, 'BTCUSD', now), /unexpected market pair/);
});

test('Kraken rejects malformed ticker envelopes and invalid prices', () => {
  for (const value of [null, {}, { error: null }, { error: [1] }, { error: [], result: {} }, { error: [], result: [] }]) {
    assert.throws(() => kraken.parseKrakenQuote(value, 'BTCUSD', now));
  }
  for (const price of ['', '0', '-1', 'NaN', 'Infinity', '1e3', '100oops', 50, null, '9'.repeat(400)]) {
    assert.throws(() => kraken.parseKrakenQuote(ticker('XXBTZUSD', price), 'BTCUSD', now), /invalid price/);
  }
});

test('Kraken HTTP-200 API errors are failures, including rate limits and throttled-until timestamps', () => {
  assert.throws(() => kraken.parseKrakenQuote({ error: ['EQuery:Unknown asset pair'] }, 'BTCUSD', now), /could not provide/);
  for (const error of ['EAPI:Rate limit exceeded', 'EGeneral:Too many requests']) {
    assert.throws(() => kraken.parseKrakenQuote({ error: [error] }, 'BTCUSD', now), e => e.retryAt === now + 60000);
  }
  const until = now + 180000;
  assert.throws(() => kraken.parseKrakenHistory({ error: [`EService:Throttled: ${until / 1000}`] }, 'ETHUSD', now), e => e.retryAt === until);
});

test('Kraken hourly chart uses seconds-to-ms conversion, excludes cursor metadata and takes the latest 24 rows', () => {
  const input = ohlc('XXBTZUSD', 721);
  const history = kraken.parseKrakenHistory(input, 'BTCUSD', now);
  assert.equal(history.candles.length, 24);
  assert.equal(history.candles[0].close, 797);
  assert.equal(history.candles.at(-1).close, 820);
  assert.equal(history.candles.at(-1).openTime, hour * 1000);
  assert.equal(history.candles.at(-1).closeTime, hour * 1000 + 3599999);
  assert.ok(history.candles.at(-1).closeTime > now, 'current uncommitted hour is preserved for the labeled chart');
  assert.equal(history.fetchedAt, now);
});

test('Kraken hourly parsing rejects bad shapes, prices, timestamp units, gaps and reversed data', () => {
  for (const change of [
    p => { p.result.XXBTZUSD = []; },
    p => { p.result.XXBTZUSD[0][0] *= 1000; },
    p => { p.result.XXBTZUSD[0][4] = 'oops'; },
    p => { p.result.XXBTZUSD.splice(4, 1); },
    p => { p.result.XXBTZUSD.reverse(); },
    p => { p.result.XXBTZUSD[1] = p.result.XXBTZUSD[0]; },
    p => { p.result.XXBTZUSD[0][0] += 60; },
  ]) {
    const value = ohlc(); change(value);
    assert.throws(() => kraken.parseKrakenHistory(value, 'BTCUSD', now));
  }
});

test('Kraken requests only official public GET endpoints for XBTUSD/ETHUSD and hourly intervals', async () => {
  const requests = [];
  const results = await kraken.fetchKrakenMarketData({ now: () => now, fetcher: async (url, options) => {
    requests.push({ url: new URL(url), options }); return validFetch(url);
  } });
  assert.equal(requests.length, 4);
  assert.ok(results.every(r => 'value' in r));
  for (const { url, options } of requests) {
    assert.equal(url.origin, 'https://api.kraken.com');
    assert.ok(['/0/public/Ticker', '/0/public/OHLC'].includes(url.pathname));
    assert.ok(['XBTUSD', 'ETHUSD'].includes(url.searchParams.get('pair')));
    assert.equal(options.method, 'GET');
    assert.equal(options.credentials, 'omit');
    assert.deepEqual(options.headers, { Accept: 'application/json' });
    assert.equal(options.body, undefined);
    if (url.pathname.endsWith('/OHLC')) {
      assert.equal(url.searchParams.get('interval'), '60');
      assert.equal(Number(url.searchParams.get('since')), hour - 23 * 3600);
    }
  }
});

test('Kraken handles HTTP cooldowns, service/access failures, unreadable JSON and disconnections', async () => {
  for (const status of [429, 403, 451, 503]) {
    const rows = await kraken.fetchKrakenMarketData({ now: () => now,
      fetcher: async () => new Response('{}', { status, headers: { 'Retry-After': '120' } }) });
    assert.ok(rows.every(r => 'error' in r));
    if (status === 429) assert.ok(rows.every(r => r.retryAt === now + 120000));
    if ([403, 451].includes(status)) assert.ok(rows.every(r => /location or network/.test(r.error)));
  }
  const invalid = await kraken.fetchKrakenMarketData({ fetcher: async () => new Response('<html>oops</html>') });
  assert.ok(invalid.every(r => /unreadable/.test(r.error)));
  const offline = await kraken.fetchKrakenMarketData({ fetcher: async () => { throw new Error('offline'); } });
  assert.ok(offline.every(r => /internet connection/.test(r.error)));
});

test('Kraken supports partial success, request timeout and cancellation', async () => {
  const partial = await kraken.fetchKrakenMarketData({ fetcher: async url => url.includes('/Ticker')
    ? validFetch(url) : new Response(JSON.stringify({ error: ['EService:Unavailable'] })) });
  assert.equal(partial.filter(r => 'value' in r).length, 2);
  const stalled = (_url, options) => new Promise((_resolve, reject) => {
    if (options.signal.aborted) reject(new Error('aborted'));
    else options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  const timeouts = await kraken.fetchKrakenMarketData({ fetcher: stalled, timeoutMs: 10 });
  assert.ok(timeouts.every(r => /timed out/.test(r.error)));
  const controller = new AbortController();
  const request = kraken.fetchKrakenMarketData({ fetcher: stalled, signal: controller.signal });
  controller.abort();
  await assert.rejects(request, { name: 'AbortError' });
});

test('exchange adapter keeps Binance requests intact and labels USD and USDT independently', async () => {
  assert.equal(markets.pairLabel('binance', 'BTC'), 'BTC/USDT');
  assert.equal(markets.pairLabel('binance', 'ETH'), 'ETH/USDT');
  assert.equal(markets.pairLabel('kraken', 'BTC'), 'BTC/USD');
  assert.equal(markets.pairLabel('kraken', 'ETH'), 'ETH/USD');
  const requests = [];
  const rows = await markets.fetchExchangeData('binance', { now: () => now, fetcher: async url => {
    requests.push(new URL(url));
    const symbol = new URL(url).searchParams.get('symbol');
    const value = url.includes('/price') ? { symbol, price: '99.5' } : Array.from({ length: 24 }, (_, i) => {
      const start = (hour - (23 - i) * 3600) * 1000;
      return [start, '100', '200', '50', '100', '1000', start + 3599999, '1', 1, '1', '1', '0'];
    });
    return new Response(JSON.stringify(value));
  } });
  assert.ok(requests.every(url => url.origin === 'https://data-api.binance.vision'));
  assert.deepEqual(new Set(requests.map(url => url.searchParams.get('symbol'))), new Set(['BTCUSDT', 'ETHUSDT']));
  assert.ok(rows.every(row => ['BTC', 'ETH'].includes(row.asset) && 'value' in row));
  assert.equal(rows.find(r => r.resource === 'quote').value.price, 99.5);
  const krakenRows = await markets.fetchExchangeData('kraken', { fetcher: validFetch });
  assert.ok(krakenRows.every(row => 'value' in row));
});

test('switching exchanges aborts an in-flight request and discards its late result', async () => {
  const requests = [];
  const f = feed((exchange, options) => new Promise(resolve => requests.push({ exchange, signal: options.signal, resolve })));
  const first = f.setActive(true);
  const switched = f.selectExchange('kraken');
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(f.state.exchange, 'kraken');
  assert.equal(f.state.snapshots.kraken.data.BTC.quote, undefined);
  requests[1].resolve(quote(78000)); await switched;
  requests[0].resolve(quote(99999)); await first;
  assert.equal(f.state.snapshots.kraken.data.BTC.quote.price, 78000);
  assert.equal(f.state.snapshots.binance.data.BTC.quote, undefined);
  assert.equal(f.state.snapshots.kraken.loading, false);
});

test('switching back preserves separate cached prices, timestamps and errors with no currency conversion', async () => {
  let failKraken = false;
  const f = feed(async exchange => failKraken && exchange === 'kraken'
    ? [{ asset: 'BTC', resource: 'quote', error: 'Kraken offline' }] : quote(exchange === 'binance' ? 99.5 : 98.25));
  await f.setActive(true);
  await f.selectExchange('kraken');
  assert.equal(f.state.snapshots.kraken.data.BTC.quote.price, 98.25);
  await f.selectExchange('binance');
  assert.equal(f.state.snapshots.binance.data.BTC.quote.price, 99.5);
  failKraken = true;
  await f.selectExchange('kraken');
  assert.equal(f.state.snapshots.kraken.data.BTC.quote.price, 98.25);
  assert.equal(f.state.snapshots.kraken.data.BTC.quoteError, 'Kraken offline');
  assert.equal(f.state.snapshots.binance.data.BTC.quoteError, undefined);
  failKraken = false;
  await f.refresh();
  assert.equal(f.state.snapshots.kraken.data.BTC.quoteError, undefined);
});

test('cooldowns are independent per exchange and survive reopening the feed', async () => {
  const cooldowns = { binance: 0, kraken: 0 };
  const calls = [];
  let time = now;
  const fetcher = async exchange => {
    calls.push(exchange);
    return exchange === 'binance' ? [{ asset: 'BTC', resource: 'quote', error: 'Rate limited', retryAt: now + 60000 }] : quote(98);
  };
  const f = feed(fetcher, () => time, cooldowns);
  await f.setActive(true);
  await f.refresh();
  assert.deepEqual(calls, ['binance']);
  await f.selectExchange('kraken');
  assert.deepEqual(calls, ['binance', 'kraken']);
  await f.selectExchange('binance');
  assert.equal(f.state.snapshots.binance.retryAt, now + 60000);
  const reopened = feed(fetcher, () => time, cooldowns);
  await reopened.setActive(true);
  assert.deepEqual(calls, ['binance', 'kraken']);
  time += 60000;
  await reopened.refresh();
  assert.deepEqual(calls, ['binance', 'kraken', 'binance']);
});

test('rapid Binance/Kraken/Binance switching cannot commit any obsolete response', async () => {
  const pending = [];
  const f = feed((exchange, options) => new Promise(resolve => pending.push({ exchange, resolve, signal: options.signal })));
  const a = f.setActive(true), b = f.selectExchange('kraken'), c = f.selectExchange('binance');
  pending[2].resolve(quote(101)); await c;
  pending[1].resolve(quote(98)); await b;
  pending[0].resolve(quote(99)); await a;
  assert.equal(f.state.exchange, 'binance');
  assert.equal(f.state.snapshots.binance.data.BTC.quote.price, 101);
  assert.equal(f.state.snapshots.kraken.data.BTC.quote, undefined);
});

test('paused feeds do not fetch, backgrounding aborts work, and duplicate refreshes do not overlap', async () => {
  const pending = [];
  const f = feed((_exchange, options) => new Promise(resolve => pending.push({ resolve, signal: options.signal })));
  await f.refresh(); assert.equal(pending.length, 0);
  const first = f.setActive(true);
  await f.refresh(); assert.equal(pending.length, 1);
  await f.setActive(false);
  assert.equal(pending[0].signal.aborted, true);
  pending[0].resolve(quote(99)); await first;
  assert.equal(f.state.snapshots.binance.data.BTC.quote, undefined);
  await f.selectExchange('kraken'); assert.equal(pending.length, 1);
  const resumed = f.setActive(true);
  pending[1].resolve(quote(98)); await resumed;
  assert.equal(f.state.snapshots.kraken.data.BTC.quote.price, 98);
});
