import { MarketDataError, retryDeadline, type MarketQuote, type MarketHistory, type MarketCandle } from './binance';

export const KRAKEN_DATA_ORIGIN = 'https://api.kraken.com';
export const KRAKEN_SYMBOLS = ['BTCUSD', 'ETHUSD'] as const;
export type KrakenSymbol = typeof KRAKEN_SYMBOLS[number];
export type KrakenResult = { symbol: KrakenSymbol; resource: 'quote'; value: MarketQuote }
  | { symbol: KrakenSymbol; resource: 'history'; value: MarketHistory }
  | { symbol: KrakenSymbol; resource: 'quote' | 'history'; error: string; retryAt?: number };
export interface KrakenRequestOptions { signal?: AbortSignal; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number }
const pairs = {
  BTCUSD: { request: 'XBTUSD', keys: ['XXBTZUSD', 'XBTUSD', 'BTCUSD', 'BTC/USD'] },
  ETHUSD: { request: 'ETHUSD', keys: ['XETHZUSD', 'ETHUSD', 'ETH/USD'] },
};
function price(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new MarketDataError('Kraken returned an invalid price. Try refreshing later.');
  }
  return Number(value);
}
function pairResult(payload: unknown, symbol: KrakenSymbol, now: number): unknown {
  if (!KRAKEN_SYMBOLS.includes(symbol)) throw new MarketDataError('Unsupported Kraken market pair.');
  if (!payload || typeof payload !== 'object' || !('error' in payload) || !Array.isArray(payload.error)
    || payload.error.some(e => typeof e !== 'string')) throw new MarketDataError('Kraken returned an unexpected response.');
  if (payload.error.length) {
    const errors = payload.error as string[];
    if (errors.some(e => /rate limit|too many requests|throttled/i.test(e))) {
      const deadlines = errors.map(e => /Throttled:\s*(\d+)/i.exec(e)?.[1])
        .map(seconds => seconds ? Number(seconds) * 1000 : 0)
        .filter(deadline => Number.isSafeInteger(deadline) && deadline > now);
      throw new MarketDataError('Kraken has temporarily limited market requests. Refresh will resume after the cooldown.',
        Math.max(now + 60000, ...deadlines));
    }
    throw new MarketDataError('Kraken could not provide market data. The pair or service may be unavailable. Try again later.');
  }
  if (!('result' in payload) || !payload.result || typeof payload.result !== 'object' || Array.isArray(payload.result)) {
    throw new MarketDataError('Kraken returned an unexpected market response.');
  }
  const result = payload.result as Record<string, unknown>;
  const keys = pairs[symbol].keys.filter(key => Object.prototype.hasOwnProperty.call(result, key));
  if (keys.length !== 1) throw new MarketDataError('Kraken returned an unexpected market pair.');
  return result[keys[0]];
}
export function parseKrakenQuote(payload: unknown, symbol: KrakenSymbol, fetchedAt: number): MarketQuote {
  const ticker = pairResult(payload, symbol, fetchedAt);
  if (!ticker || typeof ticker !== 'object' || !('c' in ticker) || !Array.isArray(ticker.c) || ticker.c.length < 1) {
    throw new MarketDataError('Kraken returned an unexpected ticker response.');
  }
  // c[0] is the last completed trade price; a/b are the ask and bid.
  return { price: price(ticker.c[0]), fetchedAt };
}
export function parseKrakenHistory(payload: unknown, symbol: KrakenSymbol, fetchedAt: number): MarketHistory {
  const rows = pairResult(payload, symbol, fetchedAt);
  if (!Array.isArray(rows) || rows.length < 2 || rows.length > 721) throw new MarketDataError('Kraken hourly chart data is unavailable or incomplete.');
  // Kraken can return 720 committed rows plus the current, forming candle.
  const candles = rows.slice(-24).map((row: unknown): MarketCandle => {
    if (!Array.isArray(row) || row.length !== 8 || !Number.isSafeInteger(row[0]) || row[0] <= 0
      || row[0] % 3600 !== 0 || row[0] > (8640000000000000 - 3600000) / 1000) {
      throw new MarketDataError('Kraken returned invalid hourly chart data.');
    }
    const openTime = row[0] * 1000;
    return { openTime, closeTime: openTime + 3599999, close: price(row[4]) };
  });
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].openTime - candles[i - 1].openTime !== 3600000) throw new MarketDataError('Kraken hourly chart data has missing or unordered intervals.');
  }
  return { candles, fetchedAt };
}
async function request(symbol: KrakenSymbol, resource: 'quote' | 'history', options: KrakenRequestOptions): Promise<unknown> {
  const now = options.now ?? Date.now;
  const pair = pairs[symbol].request;
  const since = Math.max(0, Math.floor(now() / 3600000) * 3600 - 23 * 3600);
  const path = resource === 'quote' ? `/0/public/Ticker?pair=${pair}` : `/0/public/OHLC?pair=${pair}&interval=60&since=${since}`;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel);
  if (options.signal?.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; cancel(); }, options.timeoutMs ?? 10000);
  try {
    const response = await (options.fetcher ?? fetch)(KRAKEN_DATA_ORIGIN + path, {
      method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 429) throw new MarketDataError('Kraken has temporarily limited market requests. Refresh will resume after the cooldown.',
        retryDeadline(response.headers.get('Retry-After'), now()));
      if ([403, 451].includes(response.status)) throw new MarketDataError('Kraken market data is unavailable from this location or network.');
      throw new MarketDataError(`Kraken market data is unavailable (HTTP ${response.status}). Try again later.`);
    }
    try { return await response.json(); }
    catch { if (controller.signal.aborted) throw new Error('aborted'); throw new MarketDataError('Kraken returned unreadable market data.'); }
  } catch (cause) {
    if (options.signal?.aborted) throw Object.assign(new Error('Market request cancelled'), { name: 'AbortError' });
    if (timedOut) throw new MarketDataError('Kraken market request timed out. Check your connection and try again.');
    if (cause instanceof MarketDataError) throw cause;
    throw new MarketDataError('Could not reach Kraken. Check your internet connection or try again later.');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', cancel); }
}
export async function fetchKrakenMarketData(options: KrakenRequestOptions = {}): Promise<KrakenResult[]> {
  return Promise.all(KRAKEN_SYMBOLS.flatMap(symbol => (['quote', 'history'] as const).map(async (resource): Promise<KrakenResult> => {
    try {
      const payload = await request(symbol, resource, options);
      if (options.signal?.aborted) throw Object.assign(new Error('Market request cancelled'), { name: 'AbortError' });
      const fetchedAt = (options.now ?? Date.now)();
      return resource === 'quote' ? { symbol, resource, value: parseKrakenQuote(payload, symbol, fetchedAt) }
        : { symbol, resource, value: parseKrakenHistory(payload, symbol, fetchedAt) };
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      return { symbol, resource, error: cause instanceof Error ? cause.message : 'Kraken market data is unavailable.',
        retryAt: cause instanceof MarketDataError ? cause.retryAt : undefined };
    }
  })));
}
