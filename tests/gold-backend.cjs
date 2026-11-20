const test = require('node:test');
const assert = require('node:assert/strict');
const load = require('./helpers/load-service.cjs');
const { GoldHistory, default: worker } = load('backend/gold-worker.ts');
function storage() {
  const data = new Map();
  return { data, get: async key => data.get(key), put: async (key, value) => { data.set(key, value); } };
}
const date = offset => new Date(Date.now() - offset * 86400000).toISOString().slice(0, 10);

test('Backend restricts methods, paths, queries and does not return the secret', async () => {
  const env = { GOLD_API_KEY: 'test-server-only-key', GOLD_HISTORY: { idFromName: x => x, get: () => ({ fetch: async () => new Response('[]') }) } };
  for (const [path, method, status] of [['/orders', 'GET', 404], ['/v1/gold/history?url=https://evil.test', 'GET', 404], ['/v1/gold/history', 'POST', 405]]) {
    const response = await worker.fetch(new Request('https://worker.test' + path, { method }), env);
    assert.equal(response.status, status); assert.ok(!(await response.text()).includes(env.GOLD_API_KEY));
  }
  const missing = await worker.fetch(new Request('https://worker.test/v1/gold/history'), {});
  assert.equal(missing.status, 503); assert.match(await missing.text(), /server-only free API key/);
  const preflight = await worker.fetch(new Request('https://worker.test/v1/gold/history', { method: 'OPTIONS' }), env);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal((await worker.fetch(new Request('https://worker.test/v1/gold/history'), env)).status, 200);
});
test('Gold backend requests only free daily averages, excludes today, caches persistently and deduplicates', async t => {
  const state = { storage: storage() }; let calls = 0;
  const rows = [{ day: date(2), avg_price: 3900 }, { day: date(1), avg_price: 4000 }];
  t.mock.method(globalThis, 'fetch', async (raw, options) => {
    calls++;
    const url = new URL(raw);
    assert.equal(url.origin, 'https://api.gold-api.com'); assert.equal(url.pathname, '/history');
    assert.equal(url.searchParams.get('groupBy'), 'day'); assert.equal(url.searchParams.get('aggregation'), 'avg');
    assert.equal(url.searchParams.get('symbol'), 'XAU');
    assert.equal(options.headers['x-api-key'], 'test-secret'); assert.equal(options.method, 'GET');
    assert.ok(Number(url.searchParams.get('endTimestamp')) * 1000 < new Date(date(0)).getTime());
    return new Response(JSON.stringify(rows));
  });
  const instance = new GoldHistory(state, { GOLD_API_KEY: 'test-secret' });
  const results = await Promise.all([instance.fetch(), instance.fetch()]);
  assert.equal(calls, 1);
  for (const result of results) assert.deepEqual(await result.json(), rows);
  const restarted = new GoldHistory(state, { GOLD_API_KEY: 'test-secret' });
  assert.deepEqual(await (await restarted.fetch()).json(), rows); assert.equal(calls, 1);
});
test('Backend failures persist a quota deadline across restarts and never expose upstream errors or keys', async t => {
  const state = { storage: storage() }; let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; throw new Error('upstream echoed test-secret'); });
  const env = { GOLD_API_KEY: 'test-secret' };
  const failed = await new GoldHistory(state, env).fetch();
  assert.equal(failed.status, 503); assert.ok(!(await failed.text()).includes('test-secret'));
  const retry = await new GoldHistory(state, env).fetch();
  assert.equal(retry.status, 429); assert.ok(Number(retry.headers.get('Retry-After')) >= 3599); assert.equal(calls, 1);
});
test('Backend honors long Retry-After and rejects non-average or incomplete-day data', async t => {
  const state = { storage: storage() };
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 429, headers: { 'Retry-After': '7200' } }));
  const result = await new GoldHistory(state, { GOLD_API_KEY: 'test-secret' }).fetch();
  assert.equal(result.status, 429); assert.equal(result.headers.get('Retry-After'), '7200');
  for (const rows of [[{ day: date(1), max_price: 5000 }], [{ day: date(0), avg_price: 5000 }]]) {
    mock.mock.mockImplementation(async () => new Response(JSON.stringify(rows)));
    const invalid = await new GoldHistory({ storage: storage() }, { GOLD_API_KEY: 'test-secret' }).fetch();
    assert.equal(invalid.status, 503);
  }
});
