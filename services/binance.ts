// Public market data only. No account credentials or trading endpoints belong here.
export const MARKET_SYMBOLS = ['BTCUSDT', 'ETHUSDT'] as const;
export type MarketSymbol = typeof MARKET_SYMBOLS[number];
export type MarketResource = 'quote' | 'history';
export const BINANCE_DATA_ORIGIN = 'https://data-api.binance.vision';
export const MARKET_REFRESH_MS = 30000;
export const MARKET_STALE_MS = 60000;
export interface MarketQuote { price: number; fetchedAt: number }
export interface MarketCandle { openTime: number; closeTime: number; close: number }
export interface MarketHistory { candles: MarketCandle[]; fetchedAt: number }
export interface MarketPair {
  quote?: MarketQuote;
  history?: MarketHistory;
  quoteError?: string;
  historyError?: string;
}
export type MarketData = Record<MarketSymbol, MarketPair>;
export type MarketResult = { symbol: MarketSymbol; resource: 'quote'; value: MarketQuote }
  | { symbol: MarketSymbol; resource: 'history'; value: MarketHistory }
  | { symbol: MarketSymbol; resource: MarketResource; error: string; retryAt?: number };

export class MarketDataError extends Error {
  constructor(message: string, readonly retryAt?: number) { super(message); }
}
function positivePrice(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0) {
    throw new MarketDataError('Binance returned an invalid price. Try refreshing later.');
  }
  return Number(value);
}
export function parseQuote(value: unknown, symbol: MarketSymbol, fetchedAt: number): MarketQuote {
  if (!value || typeof value !== 'object' || !('symbol' in value) || value.symbol !== symbol || !('price' in value)) {
    throw new MarketDataError('Binance returned an unexpected price response.');
  }
  return { price: positivePrice(value.price), fetchedAt };
}
export function parseHistory(value: unknown, fetchedAt: number): MarketHistory {
  if (!Array.isArray(value) || value.length < 2 || value.length > 24) {
    throw new MarketDataError('Hourly chart data is unavailable or incomplete.');
  }
  const candles = value.map((row: unknown): MarketCandle => {
    if (!Array.isArray(row) || row.length !== 12 || !Number.isSafeInteger(row[0]) || row[0] <= 0
      || row[0] > 8640000000000000 - 3600000 || row[6] !== row[0] + 3599999) {
      throw new MarketDataError('Binance returned invalid hourly chart data.');
    }
    return { openTime: row[0], closeTime: row[6], close: positivePrice(row[4]) };
  });
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].openTime - candles[i - 1].openTime !== 3600000) {
      throw new MarketDataError('Hourly chart data has missing or unordered intervals.');
    }
  }
  return { candles, fetchedAt };
}
export function retryDeadline(header: string | null, now: number, fallbackMs = 60000): number {
  if (header !== null && /^\d+(?:\.\d+)?$/.test(header.trim())) {
    const seconds = Number(header);
    const deadline = now + Math.max(1000, seconds * 1000);
    if (Number.isFinite(seconds) && Number.isSafeInteger(deadline)) return deadline;
  }
  const date = header ? Date.parse(header) : NaN;
  return Number.isFinite(date) && date > now ? date : now + fallbackMs;
}

interface RequestOptions {
  signal?: AbortSignal;
  fetcher?: typeof fetch;
  now?: () => number;
  timeoutMs?: number;
}
// GET requests are fixed to two symbols and two public endpoints. A response's
// receipt time is not represented as an exchange event or a guaranteed live price.
async function request(symbol: MarketSymbol, resource: MarketResource, options: RequestOptions): Promise<unknown> {
  if (!MARKET_SYMBOLS.includes(symbol)) throw new MarketDataError('Unsupported market pair.');
  const endpoint = resource === 'quote' ? `/api/v3/ticker/price?symbol=${symbol}`
    : `/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  options.signal?.addEventListener('abort', cancel);
  if (options.signal?.aborted) cancel();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; cancel(); }, options.timeoutMs ?? 10000);
  try {
    const response = await (options.fetcher ?? fetch)(BINANCE_DATA_ORIGIN + endpoint, {
      method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store',
    });
    const now = (options.now ?? Date.now)();
    if (!response.ok) {
      if (response.status === 429 || response.status === 418) {
        throw new MarketDataError('Binance has temporarily limited market requests. Refresh will resume after the cooldown.',
          retryDeadline(response.headers.get('Retry-After'), now, response.status === 418 ? 120000 : 60000));
      }
      if ([403, 451].includes(response.status)) throw new MarketDataError('Binance market data is unavailable from this location or network.');
      throw new MarketDataError(`Binance market data is unavailable (HTTP ${response.status}). Try again later.`);
    }
    try { return await response.json(); }
    catch { if (controller.signal.aborted) throw new Error('aborted'); throw new MarketDataError('Binance returned unreadable market data.'); }
  } catch (cause) {
    if (options.signal?.aborted) throw Object.assign(new Error('Market request cancelled'), { name: 'AbortError' });
    if (timedOut) throw new MarketDataError('Market request timed out. Check your connection and try again.');
    if (cause instanceof MarketDataError) throw cause;
    throw new MarketDataError('Could not reach Binance. Check your internet connection or try again later.');
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}

export async function fetchMarketData(options: RequestOptions = {}): Promise<MarketResult[]> {
  const tasks = MARKET_SYMBOLS.flatMap(symbol => (['quote', 'history'] as const).map(async (resource): Promise<MarketResult> => {
    try {
      const payload = await request(symbol, resource, options);
      if (options.signal?.aborted) throw Object.assign(new Error('Market request cancelled'), { name: 'AbortError' });
      const fetchedAt = (options.now ?? Date.now)();
      return resource === 'quote' ? { symbol, resource, value: parseQuote(payload, symbol, fetchedAt) }
        : { symbol, resource, value: parseHistory(payload, fetchedAt) };
    } catch (cause) {
      if (options.signal?.aborted) throw cause;
      return { symbol, resource, error: cause instanceof Error ? cause.message : 'Market data is unavailable.',
        retryAt: cause instanceof MarketDataError ? cause.retryAt : undefined };
    }
  }));
  return Promise.all(tasks);
}

export function mergeMarketResults(previous: MarketData, results: MarketResult[]): MarketData {
  const next = { BTCUSDT: { ...previous.BTCUSDT }, ETHUSDT: { ...previous.ETHUSDT } };
  for (const result of results) {
    const pair = next[result.symbol];
    if ('error' in result) {
      if (result.resource === 'quote') pair.quoteError = result.error;
      else pair.historyError = result.error;
    } else if (result.resource === 'quote') { pair.quote = result.value; pair.quoteError = undefined; }
    else { pair.history = result.value; pair.historyError = undefined; }
  }
  return next;
}
export function marketIsStale(fetchedAt: number | undefined, now: number, error?: string) {
  return fetchedAt === undefined || !!error || now < fetchedAt || now - fetchedAt >= MARKET_STALE_MS;
}
