import { type AnalysisMarket } from '../services/analysisContract';
import { AnalysisUnavailable, fetchAnalysisData, type AnalysisData } from './analysisData';

export interface HistoryStorage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
interface ProviderState { failures: number; retryAt: number; status: number; message: string }
const HOUR = 3600000, DAY = 86400000;

function reusable(data: AnalysisData | undefined, market: AnalysisMarket, now: number): data is AnalysisData {
  const daily = market.source === 'frankfurter';
  return !!data && data.market?.source === market.source && data.market?.pair === market.pair
    && data.interval === (daily ? '1d' : '1h') && data.observationKind === (daily ? 'daily-reference' : 'closed-candle')
    && data.derivedFrom === (market.pair === 'USD/EUR' ? 'EUR/USD' : undefined)
    && Array.isArray(data.values) && data.values.length >= 100 && data.values.length <= 200
    && data.values.every(value => typeof value === 'number' && Number.isFinite(value) && value > 0)
    && Number.isSafeInteger(data.fetchedAt) && Number.isSafeInteger(data.dataAsOf)
    && data.dataAsOf > 0 && data.dataAsOf <= data.fetchedAt && data.fetchedAt <= now
    && now - data.fetchedAt < (daily ? HOUR : 5 * 60000)
    && now - data.dataAsOf <= (daily ? 5 * DAY : 2 * HOUR)
    // Refresh after an hourly close even if the five-minute TTL has not elapsed.
    && (daily || data.dataAsOf === Math.floor(now / HOUR) * HOUR);
}

// Called inside the serialized MarketAnalysis Durable Object. Public observations
// are cached separately from AI output, so model failures do not refetch candles.
export async function cachedAnalysisData(storage: HistoryStorage, market: AnalysisMarket,
  fetcher: typeof fetch = fetch, now = Date.now()): Promise<AnalysisData> {
  const key = `history:v1:${market.source}:${market.pair}`;
  const cached = await storage.get<AnalysisData>(key);
  if (reusable(cached, market, now)) return cached;
  const providerKey = `history-provider:v1:${market.source}`;
  const previous = await storage.get<ProviderState>(providerKey);
  const failures = Number.isInteger(previous?.failures) && previous!.failures > 0 ? Math.min(previous!.failures, 6) : 0;
  if (previous && Number.isFinite(previous.retryAt) && previous.retryAt > now) {
    throw new AnalysisUnavailable(previous.message, previous.status, previous.retryAt);
  }
  // Persist before networking to cover object restarts and interrupted requests.
  await storage.put<ProviderState>(providerKey, { failures, retryAt: now + 60000,
    status: 429, message: 'Market history request cooldown. Retry shortly.' });
  try {
    const result = await fetchAnalysisData(market, fetcher, now);
    await storage.put(key, result);
    await storage.put<ProviderState>(providerKey, { failures: 0, retryAt: 0, status: 429, message: '' });
    return result;
  } catch (error) {
    const issue = error instanceof AnalysisUnavailable ? error : new AnalysisUnavailable('Market history temporarily unavailable.', 503);
    const retryAt = Math.max(now + Math.min(HOUR, 60000 * 2 ** failures), issue.retryAt ?? 0);
    const message = issue.message.slice(0, 400);
    await storage.put<ProviderState>(providerKey, { failures: Math.min(6, failures + 1), retryAt, status: issue.status, message });
    throw new AnalysisUnavailable(message, issue.status, retryAt);
  }
}
