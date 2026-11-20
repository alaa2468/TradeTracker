// Standalone Cloudflare Worker, never imported by the mobile application.
// One SQLite-backed Durable Object coordinates the free provider quota globally.
import { parseGoldHistory } from '../services/referenceMarkets';
import { analysisHealth, handleAnalysis, type AIEnv } from './analysis-worker';
export { MarketAnalysis } from './analysis-worker';

interface Storage {
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T): Promise<void>;
}
interface ObjectState { storage: Storage }
interface Namespace { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
interface Env extends AIEnv { GOLD_API_KEY?: string; GOLD_HISTORY: Namespace }
interface Cached { fetchedAt: number; rows: { day: string; avg_price: number }[] }
const HOUR = 3600000;
const DAY = 86400000;
function json(body: unknown, status = 200, retryAfter?: number) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Accept',
    'Access-Control-Expose-Headers': 'Retry-After',
    'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store',
    ...(retryAfter ? { 'Retry-After': String(retryAfter) } : {}),
  } });
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health' && !url.search && request.method === 'GET') return analysisHealth(env);
    if (url.pathname === '/v1/analysis') return handleAnalysis(request, env);
    if (url.pathname !== '/v1/gold/history' || url.search) return json({ error: 'Not found' }, 404);
    if (request.method === 'OPTIONS') return json({ available: true });
    if (request.method !== 'GET') return json({ error: 'Only public GET requests are supported' }, 405);
    if (!env.GOLD_API_KEY) return json({ error: 'Gold daily history needs a server-only free API key. Spot prices do not.' }, 503);
    try {
      return await env.GOLD_HISTORY.get(env.GOLD_HISTORY.idFromName('xau-usd-daily-averages')).fetch(request);
    } catch { return json({ error: 'Gold history temporarily unavailable' }, 503); }
  },
};

export class GoldHistory {
  private pending?: Promise<{ body: unknown; status: number; retry?: number }>;
  constructor(private state: ObjectState, private env: Env) {}
  async fetch(): Promise<Response> {
    // In-flight deduplication, plus a durable deadline before every upstream call.
    this.pending ??= this.read().finally(() => { this.pending = undefined; });
    const result = await this.pending;
    return json(result.body, result.status, result.retry);
  }
  private async read() {
    const now = Date.now();
    const cached = await this.state.storage.get<Cached>('daily');
    if (cached && now >= cached.fetchedAt && now - cached.fetchedAt < DAY) return { body: cached.rows, status: 200 };
    const nextAttempt = await this.state.storage.get<number>('nextAttempt') ?? 0;
    if (nextAttempt > now) return { body: { error: 'Gold history cooldown; try later' }, status: 429, retry: Math.ceil((nextAttempt - now) / 1000) };
    await this.state.storage.put('nextAttempt', now + HOUR); // <=1 call/hour globally, including failures/restarts.
    if (!this.env.GOLD_API_KEY) return { body: { error: 'History not configured' }, status: 503 };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    try {
      // Exclude today's incomplete daily aggregation. Never request premium intervals.
      const today = Math.floor(now / DAY) * DAY;
      const url = new URL('https://api.gold-api.com/history');
      url.search = new URLSearchParams({ symbol: 'XAU', startTimestamp: String((today - 45 * DAY) / 1000),
        endTimestamp: String(today / 1000 - 1), groupBy: 'day', aggregation: 'avg', orderBy: 'asc' }).toString();
      const response = await fetch(url.toString(), { method: 'GET', headers: { 'x-api-key': this.env.GOLD_API_KEY, Accept: 'application/json' }, signal: controller.signal });
      if (!response.ok) {
        if (response.status === 429) {
          const header = response.headers.get('Retry-After');
          const numeric = header !== null && /^\d+$/.test(header) ? Number(header) * 1000 : Date.parse(header ?? '') - now;
          const delay = Number.isFinite(numeric) ? Math.max(HOUR, numeric) : HOUR;
          await this.state.storage.put('nextAttempt', now + delay);
          return { body: { error: 'Gold provider history rate limit' }, status: 429, retry: Math.ceil(delay / 1000) };
        }
        return { body: { error: 'Gold daily history unavailable from provider' }, status: 503 };
      }
      const points = parseGoldHistory(await response.json());
      if (points.some(p => Date.parse(p.date) >= today || Date.parse(p.date) < today - 45 * DAY)) throw new Error('Invalid history dates');
      const rows = points.map(p => ({ day: p.date, avg_price: p.value }));
      await this.state.storage.put<Cached>('daily', { fetchedAt: now, rows });
      return { body: rows, status: 200 };
    } catch { return { body: { error: 'Gold history unavailable; no replacement data generated' }, status: 503 }; }
    finally { clearTimeout(timer); }
  }
}
