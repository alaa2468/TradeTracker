// Provenance-aware observations for display and future analysis.
// Daily averages/reference rates are not OHLC candles.
import { MarketDataError, retryDeadline } from './binance';

export const FOREX_PAIRS = ['EUR/USD', 'USD/EUR', 'GBP/USD', 'USD/JPY'] as const;
export type ReferencePair = typeof FOREX_PAIRS[number] | 'XAU/USD';
export interface Observation { date: string; value: number }
export interface ReferenceQuote {
  value: number; asOf: string; fetchedAt: number; kind: 'spot' | 'daily-reference';
}
export interface ReferenceHistory {
  points: Observation[]; fetchedAt: number; kind: 'daily-average' | 'daily-reference';
}
export interface ReferenceSnapshot {
  quote?: ReferenceQuote; history?: ReferenceHistory; quoteError?: string; historyError?: string;
}
export interface ReferenceResult extends ReferenceSnapshot { retryAt: number; quoteRetryAt?: number }
export interface ReferenceOptions {
  signal?: AbortSignal; fetcher?: typeof fetch; now?: () => number; timeoutMs?: number;
  backendUrl?: string; previous?: ReferenceSnapshot;
}
export function pairMetadata(pair: ReferencePair) {
  return {
    pair, base: pair.split('/')[0], currency: pair.split('/')[1],
    source: pair === 'XAU/USD' ? 'Gold API' : 'Frankfurter blended reference rates',
    historyInterval: '1d' as const, derivedFrom: pair === 'USD/EUR' ? 'EUR/USD' : undefined,
    derivation: pair === 'USD/EUR' ? 'Inverse-derived: 1 / EUR/USD (euros per US dollar)' : undefined,
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid market response.');
  return value as Record<string, unknown>;
}
function price(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error('Invalid market price.');
  return value;
}
export function validDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error('Invalid observation date.');
  return value;
}
function observations(rows: Observation[]): Observation[] {
  if (!rows.length || rows.length > 100) throw new Error('Daily history is unavailable or too large.');
  const sorted = rows.sort((a, b) => a.date.localeCompare(b.date));
  if (sorted.some((row, index) => index > 0 && row.date === sorted[index - 1].date)) throw new Error('Duplicate daily observations.');
  return sorted; // Missing weekends/holidays stay missing.
}
export function parseForex(value: unknown, pair: ReferencePair): Observation[] {
  if (!FOREX_PAIRS.includes(pair as typeof FOREX_PAIRS[number])) throw new Error('Unsupported Forex pair.');
  if (!Array.isArray(value)) throw new Error('Invalid Forex response.');
  const sourcePair = pair === 'USD/EUR' ? 'EUR/USD' : pair;
  const [base, quote] = sourcePair.split('/');
  return observations(value.map(item => {
    const row = object(item);
    if (row.base !== base || row.quote !== quote) throw new Error('Forex response belongs to a different pair.');
    const rate = price(row.rate);
    return { date: validDate(row.date), value: pair === 'USD/EUR' ? price(1 / rate) : rate };
  }));
}
export function parseGoldQuote(value: unknown, fetchedAt: number): ReferenceQuote {
  const row = object(value);
  if (row.symbol !== 'XAU' || (row.currency !== undefined && row.currency !== 'USD')
    || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))
    || Date.parse(row.updatedAt) > fetchedAt + 60000) throw new Error('Invalid XAU/USD spot response.');
  return { value: price(row.price), asOf: row.updatedAt, fetchedAt, kind: 'spot' };
}
export function parseGoldHistory(value: unknown): Observation[] {
  if (!Array.isArray(value)) throw new Error('Invalid Gold history response.');
  return observations(value.map(item => {
    const row = object(item);
    return { date: validDate(row.day), value: price(row.avg_price) };
  }));
}
export function referenceIsStale(quote: ReferenceQuote, now: number, error?: string) {
  const sourceTime = Date.parse(quote.asOf);
  return !!error || now < quote.fetchedAt || now < sourceTime || now - quote.fetchedAt > (quote.kind === 'spot' ? 60000 : 86400000)
    || now - sourceTime > (quote.kind === 'spot' ? 120000 : 5 * 86400000);
}
export async function requestPublicJson(url: string, options: ReferenceOptions = {}): Promise<unknown> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort);
  if (options.signal?.aborted) abort();
  const timer = setTimeout(abort, options.timeoutMs ?? 10000);
  try {
    const response = await (options.fetcher ?? fetch)(url, {
      method: 'GET', signal: controller.signal, headers: { Accept: 'application/json' }, credentials: 'omit', cache: 'no-store',
    });
    if (!response.ok) {
      if (response.status === 429) throw new MarketDataError('Market service rate limit reached. Wait before refreshing.',
        retryDeadline(response.headers.get('Retry-After'), (options.now ?? Date.now)()));
      if (response.status === 503) throw new Error('Gold history is not configured or temporarily unavailable. Spot prices still work.');
      throw new Error(`Market service unavailable (HTTP ${response.status}). Try again later.`);
    }
    return await response.json();
  } catch (error) {
    if (options.signal?.aborted) throw Object.assign(new Error('Request cancelled'), { name: 'AbortError' });
    if (controller.signal.aborted) throw new Error('Market request timed out. Check your connection and retry.');
    if (error instanceof MarketDataError || error instanceof SyntaxError) throw error;
    if (error instanceof Error && (error.message.startsWith('Market service') || error.message.startsWith('Gold history'))) throw error;
    throw new Error('Cannot reach the market service. Check your internet connection and refresh.');
  } finally { clearTimeout(timer); options.signal?.removeEventListener('abort', abort); }
}
export async function fetchReferenceMarket(pair: ReferencePair, options: ReferenceOptions = {}): Promise<ReferenceResult> {
  if (pair !== 'XAU/USD' && !FOREX_PAIRS.includes(pair)) throw new Error('Unsupported market pair.');
  const now = options.now ?? Date.now;
  const result: ReferenceResult = { retryAt: 0 };
  const sourcePair = pair === 'USD/EUR' ? 'EUR/USD' : pair;
  const [base, quote] = sourcePair.split('/');
  const end = new Date(now()).toISOString().slice(0, 10);
  const start = new Date(now() - 45 * 86400000).toISOString().slice(0, 10);
  const forexUrl = `https://api.frankfurter.dev/v2/rates?base=${base}&quotes=${quote}`;
  await Promise.all((['quote', 'history'] as const).map(async resource => {
    try {
      if (resource === 'quote') {
        const payload = await requestPublicJson(pair === 'XAU/USD' ? 'https://api.gold-api.com/price/XAU' : forexUrl, options);
        if (pair === 'XAU/USD') result.quote = parseGoldQuote(payload, now());
        else {
          const rows = parseForex(payload, pair);
          if (rows.length !== 1 || rows[0].date > end) throw new Error('Invalid latest daily reference rate.');
          result.quote = { value: rows[0].value, asOf: rows[0].date, fetchedAt: now(), kind: 'daily-reference' };
        }
      } else {
        const previous = options.previous?.history;
        if (previous && now() >= previous.fetchedAt && now() - previous.fetchedAt < 3600000) {
          result.history = previous; return;
        }
        let url = `${forexUrl}&from=${start}&to=${end}`;
        if (pair === 'XAU/USD') {
          if (!options.backendUrl) throw new Error('Daily Gold averages need the optional free backend. Spot prices are available without setup. See docs/market-testing.md.');
          const backend = new URL(options.backendUrl);
          if (backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/') {
            throw new Error('Gold history backend must be an HTTPS origin without credentials, a path, or query parameters.');
          }
          url = `${backend.origin}/v1/gold/history`;
        }
        const payload = await requestPublicJson(url, options);
        const points = pair === 'XAU/USD' ? parseGoldHistory(payload) : parseForex(payload, pair);
        if (points.some(point => point.date > end || point.date < new Date(now() - 100 * 86400000).toISOString().slice(0, 10))) {
          throw new Error('History dates are outside the supported recent daily range.');
        }
        result.history = { points, fetchedAt: now(), kind: pair === 'XAU/USD' ? 'daily-average' : 'daily-reference' };
      }
    } catch (error) {
      if (options.signal?.aborted) throw error;
      result[resource === 'quote' ? 'quoteError' : 'historyError'] = error instanceof Error ? error.message : 'Market data unavailable.';
      if (error instanceof MarketDataError) {
        result.retryAt = Math.max(result.retryAt, error.retryAt ?? 0);
        if (resource === 'quote') result.quoteRetryAt = error.retryAt;
      }
    }
  }));
  return result;
}
