import { parseForex, type Observation, type ReferencePair } from '../services/referenceMarkets';
import { record, type AnalysisMarket } from '../services/analysisContract';

export class AnalysisUnavailable extends Error {
  constructor(message: string, readonly status = 422, readonly retryAt?: number) { super(message); }
}
export interface AnalysisData {
  market: AnalysisMarket; interval: '1h' | '1d'; observationKind: 'closed-candle' | 'daily-reference';
  derivedFrom?: 'EUR/USD'; values: number[]; dataAsOf: number; fetchedAt: number;
}
const HOUR = 3600000, DAY = 86400000;
function positive(value: unknown): number {
  if (typeof value !== 'string' || !/^\d+(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Number(value) <= 0) throw new AnalysisUnavailable('Invalid exchange closing price.');
  return Number(value);
}
export function parseCryptoHistory(raw: unknown, market: AnalysisMarket, now: number): AnalysisData {
  let rows: unknown[];
  if (market.source === 'kraken') {
    const envelope = record(raw);
    if (!Array.isArray(envelope.error)) throw new AnalysisUnavailable('Kraken returned an invalid history envelope.', 503);
    if (envelope.error.length) {
      const errors = envelope.error.filter((error): error is string => typeof error === 'string');
      if (errors.some(error => /rate limit|throttl|too many requests/i.test(error))) {
        const throttle = errors.map(error => error.match(/throttled:\s*(\d+)/i)?.[1]).find(Boolean);
        throw new AnalysisUnavailable('Kraken public history is rate limited from the backend location. Retry later.', 429,
          Math.max(now + 60000, throttle ? Number(throttle) * 1000 : 0));
      }
      // Only public API error codes, never upstream bodies or request headers.
      const codes = errors.slice(0, 2).map(error => error.replace(/[^A-Za-z0-9: _.-]/g, '').slice(0, 100)).join('; ');
      throw new AnalysisUnavailable(`Kraken history unavailable${codes ? ` (${codes})` : ''}.`, 503);
    }
    const result = record(envelope.result);
    const aliases = market.pair === 'BTC/USD' ? ['XXBTZUSD', 'XBTUSD'] : ['XETHZUSD', 'ETHUSD'];
    const key = Object.keys(result).find(key => aliases.includes(key));
    if (!key || !Array.isArray(result[key])) throw new AnalysisUnavailable('Kraken returned history for a different market.');
    rows = result[key] as unknown[];
  } else {
    if (!Array.isArray(raw)) throw new AnalysisUnavailable('Invalid Binance history.');
    rows = raw;
  }
  if (rows.length < 101 || rows.length > 1000) throw new AnalysisUnavailable('Insufficient historical candles for analysis.');
  const parsed = rows.map(row => {
    if (!Array.isArray(row) || row.length !== (market.source === 'kraken' ? 8 : 12)) throw new AnalysisUnavailable('Malformed exchange history.');
    const start = market.source === 'kraken' ? row[0] * 1000 : row[0];
    if (!Number.isSafeInteger(start) || start <= 0 || start % HOUR !== 0
      || (market.source === 'kraken' && typeof row[0] !== 'number')
      || (market.source === 'binance' && row[6] !== start + HOUR - 1)) throw new AnalysisUnavailable('Invalid candle timestamps.');
    return { time: start + HOUR, close: positive(row[4]) };
  });
  for (let i = 1; i < parsed.length; i++) if (parsed[i].time - parsed[i - 1].time !== HOUR) throw new AnalysisUnavailable('Historical candles have gaps or duplicate intervals.');
  if (parsed.some(row => row.time > Math.floor(now / HOUR) * HOUR + HOUR)) throw new AnalysisUnavailable('Future candle timestamps.');
  const closed = parsed.filter(row => row.time <= now).slice(-200);
  const dataAsOf = closed[closed.length - 1]?.time;
  if (closed.length < 100 || !dataAsOf || now - dataAsOf > 2 * HOUR) throw new AnalysisUnavailable('Insufficient or stale closed-candle history.');
  return { market, interval: '1h', observationKind: 'closed-candle', values: closed.map(row => row.close), dataAsOf, fetchedAt: now };
}
export function parseForexAnalysis(raw: unknown, market: AnalysisMarket, now: number): AnalysisData {
  if (!Array.isArray(raw) || raw.length > 400) throw new AnalysisUnavailable('Invalid daily reference history.');
  // Reuse the display adapter's strict currency/date/inverse checks in bounded chunks.
  const points: Observation[] = [];
  for (let i = 0; i < raw.length; i += 100) points.push(...parseForex(raw.slice(i, i + 100), market.pair as ReferencePair));
  points.sort((a, b) => a.date.localeCompare(b.date));
  const today = new Date(now).toISOString().slice(0, 10);
  if (points.some((point, i) => point.date > today || (i > 0 && point.date === points[i - 1].date)
    || (i > 0 && Date.parse(point.date) - Date.parse(points[i - 1].date) > 7 * DAY))) throw new AnalysisUnavailable('Daily reference dates are invalid, duplicated, or have long gaps.');
  const recent = points.slice(-200), dataAsOf = Date.parse(recent[recent.length - 1]?.date);
  if (recent.length < 100 || !Number.isFinite(dataAsOf) || now - dataAsOf > 5 * DAY) throw new AnalysisUnavailable('Insufficient or stale daily reference history. At least 100 observations are required.');
  return { market, interval: '1d', observationKind: 'daily-reference', derivedFrom: market.pair === 'USD/EUR' ? 'EUR/USD' : undefined,
    values: recent.map(point => point.value), dataAsOf, fetchedAt: now };
}
export async function fetchAnalysisData(market: AnalysisMarket, fetcher = fetch, now = Date.now()): Promise<AnalysisData> {
  if (market.source === 'gold') throw new AnalysisUnavailable('Gold analysis unavailable: the current free history adapter supplies fewer than 100 daily averages, not closed trading candles.');
  const symbol = market.pair.replace('/', '');
  let url: string;
  if (market.source === 'binance') url = `https://data-api.binance.vision/api/v3/klines?symbol=${symbol}&interval=1h&limit=201`;
  // Kraken returns up to 720 recent entries without `since`. A stable URL also
  // allows upstream caches to serve it rather than creating sliding cache keys.
  else if (market.source === 'kraken') url = `https://api.kraken.com/0/public/OHLC?pair=${market.pair.startsWith('BTC') ? 'XBTUSD' : 'ETHUSD'}&interval=60`;
  else {
    const [base, quote] = (market.pair === 'USD/EUR' ? 'EUR/USD' : market.pair).split('/');
    url = `https://api.frankfurter.dev/v2/rates?base=${base}&quotes=${quote}&from=${new Date(now - 180 * DAY).toISOString().slice(0, 10)}&to=${new Date(now).toISOString().slice(0, 10)}`;
  }
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  try {
    // Workers supports manual/follow, but throws before networking for "error".
    // Manual keeps redirects rejected by the HTTP status checks below.
    const response = await fetcher(url, { method: 'GET', headers: { Accept: 'application/json' }, signal: controller.signal, redirect: 'manual' });
    if (!response.ok) {
      if (response.status === 403 || response.status === 451 || response.status === 418) {
        throw new AnalysisUnavailable(`${market.source === 'binance' ? 'Binance' : 'Market'} history is blocked from this backend (HTTP ${response.status}). No other exchange was substituted.`,
          503, now + (response.status === 403 ? 15 * 60000 : HOUR));
      }
      if (response.status === 429) {
        const raw = response.headers.get('Retry-After');
        const delay = raw !== null && /^\d+$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw ?? '') - now;
        throw new AnalysisUnavailable('Market history is rate limited. Retry later.', 429, now + (Number.isFinite(delay) ? Math.max(60000, delay) : 60000));
      }
      throw new AnalysisUnavailable(`Market history is unavailable from the backend location or provider (HTTP ${response.status}).`, 503);
    }
    const raw: unknown = await response.json();
    return market.source === 'frankfurter' ? parseForexAnalysis(raw, market, now) : parseCryptoHistory(raw, market, now);
  } catch (error) {
    if (error instanceof AnalysisUnavailable) throw error;
    throw new AnalysisUnavailable('Cannot retrieve valid market history. No indicators or AI proposal were generated.', 503);
  } finally { clearTimeout(timer); }
}
