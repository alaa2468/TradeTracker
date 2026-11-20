import { parseAnalysisMarket, parseAnalysisProposal, type AnalysisProposal } from '../services/analysisContract';
import { calculateIndicators } from '../utils/indicators';
import { AnalysisUnavailable } from './analysisData';
import { cachedAnalysisData } from './historyCache';
import { verifyExplanation } from './explanationValidation';
import { AI_MODEL, analyzeWithModel } from './aiProvider';

interface Storage { get<T>(key: string): Promise<T | undefined>; put<T>(key: string, value: T): Promise<void> }
interface State { storage: Storage }
interface Namespace { idFromName(name: string): unknown; get(id: unknown): { fetch(request: Request): Promise<Response> } }
export interface AIEnv {
  GROQ_API_KEY?: string; AI_ACCESS_CODE?: string; AI_FREE_TIER_CONFIRMED?: string; ANALYSIS: Namespace;
}
export function analysisConfigurationError(env: AIEnv): string | undefined {
  if (env.AI_FREE_TIER_CONFIRMED !== 'true') return 'AI_FREE_TIER_CONFIRMED must be exactly true on the deployed Worker.';
  if (!env.GROQ_API_KEY) return 'GROQ_API_KEY is missing on the deployed Worker.';
  if (!env.AI_ACCESS_CODE || env.AI_ACCESS_CODE.length < 24 || env.AI_ACCESS_CODE.length > 128) {
    return 'AI_ACCESS_CODE must contain 24–128 characters. Update it privately in Cloudflare; never send it in chat.';
  }
}
export function analysisHealth(env: AIEnv): Response {
  const issue = analysisConfigurationError(env);
  return reply({ service: 'TradeTrack market data', analysis: issue ? 'configuration-required' : 'configured',
    ...(issue ? { issue } : {}), note: 'Readiness checks do not verify provider credentials, quotas, billing, or a model response.' });
}
function reply(body: unknown, status = 200, retryAt?: number): Response {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Expose-Headers': 'Retry-After',
    ...(retryAt ? { 'Retry-After': String(Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))) } : {}),
  } });
}
async function input(request: Request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new AnalysisUnavailable('JSON request required.', 415);
  if (Number(request.headers.get('Content-Length')) > 1024) throw new AnalysisUnavailable('Request too large.', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new AnalysisUnavailable('Market selection required.', 400);
  let bytes = 0, content = '';
  const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1024) { await reader.cancel(); throw new AnalysisUnavailable('Request too large.', 413); }
      content += decoder.decode(part.value, { stream: true });
    }
    content += decoder.decode();
    return parseAnalysisMarket(JSON.parse(content));
  } catch (error) {
    if (error instanceof AnalysisUnavailable) throw error;
    throw new AnalysisUnavailable('Unsupported market or invalid request.', 400);
  } finally { reader.releaseLock(); }
}
export async function authorized(actual: string, expected: string): Promise<boolean> {
  if (actual.length > 300 || !actual.startsWith('Bearer ')) return false;
  const encode = new TextEncoder();
  const [a, b] = await Promise.all([actual.slice(7), expected].map(value => crypto.subtle.digest('SHA-256', encode.encode(value))));
  const av = new Uint8Array(a), bv = new Uint8Array(b);
  let difference = 0; for (let i = 0; i < av.length; i++) difference |= av[i] ^ bv[i];
  return difference === 0;
}
export async function handleAnalysis(request: Request, env: AIEnv): Promise<Response> {
  if (new URL(request.url).pathname !== '/v1/analysis' || new URL(request.url).search) return reply({ error: 'Not found' }, 404);
  if (request.method === 'OPTIONS') return reply({ available: true });
  if (request.method !== 'POST') return reply({ error: 'POST required' }, 405);
  const configurationError = analysisConfigurationError(env);
  if (configurationError) return reply({ error: `Analysis Unavailable: ${configurationError}` }, 503);
  if (!await authorized(request.headers.get('Authorization') ?? '', env.AI_ACCESS_CODE!)) return reply({ error: 'Analysis access code is incorrect. Ask the project owner for the demo access code, not an API key.' }, 401);
  try {
    const market = await input(request);
    const internal = new Request('https://internal/v1/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(market) });
    return await env.ANALYSIS.get(env.ANALYSIS.idFromName('global-free-analysis-v1')).fetch(internal);
  } catch (error) {
    return error instanceof AnalysisUnavailable ? reply({ error: error.message }, error.status, error.retryAt)
      : reply({ error: 'Analysis Unavailable: backend temporarily unavailable.' }, 503);
  }
}

export class MarketAnalysis {
  private busy = false;
  constructor(private state: State, private env: AIEnv) {}
  async fetch(request: Request): Promise<Response> {
    if (this.busy) return reply({ error: 'An analysis is already running. Retry shortly.' }, 429, Date.now() + 60000);
    this.busy = true;
    try {
      const market = await input(request), now = Date.now();
      if (market.source === 'gold') throw new AnalysisUnavailable('Gold Analysis Unavailable: the current free daily-average history has insufficient observations. No indicators or AI proposal were invented.');
      if (this.env.AI_FREE_TIER_CONFIRMED !== 'true' || !this.env.GROQ_API_KEY) throw new AnalysisUnavailable('Free AI service is not configured.', 503);
      const cacheKey = `proposal:${market.source}:${market.pair}`;
      const cached = await this.state.storage.get<AnalysisProposal>(cacheKey);
      if (cached) {
        try {
          const parsed = parseAnalysisProposal(cached, market, now);
          const checked = verifyExplanation(parsed, parsed.indicators);
          if (checked !== parsed) await this.state.storage.put(cacheKey, checked);
          return reply({ proposal: checked, cached: true });
        }
        catch { /* Expired/corrupt caches never authorize an AI fallback. */ }
      }
      const quota = await this.state.storage.get<{ date: string; calls: number; nextAttempt: number }>('quota');
      if (quota && quota.nextAttempt > now) throw new AnalysisUnavailable('Shared demo cooldown. Please wait before analyzing another market.', 429, quota.nextAttempt);
      const date = new Date(now).toISOString().slice(0, 10), calls = quota?.date === date ? quota.calls : 0;
      if (calls >= 20) throw new AnalysisUnavailable('The demo’s 20-call daily AI allowance is exhausted. No paid fallback is available.', 429, (Math.floor(now / 86400000) + 1) * 86400000);
      // History failures have their own durable provider cooldowns. They must not
      // extend Groq's shared cooldown and disable unrelated, healthy markets.
      const data = await cachedAnalysisData(this.state.storage, market), indicators = calculateIndicators(data.values);
      // Reserve the model quota BEFORE calling Groq, including failed model calls.
      await this.state.storage.put('quota', { date, calls: calls + 1, nextAttempt: Date.now() + 60000 });
      let model: Awaited<ReturnType<typeof analyzeWithModel>>;
      try { model = await analyzeWithModel(data, indicators, this.env.GROQ_API_KEY); }
      catch (error) {
        if (error instanceof AnalysisUnavailable && error.retryAt) {
          await this.state.storage.put('quota', { date, calls: calls + 1, nextAttempt: Math.max(Date.now() + 60000, error.retryAt) });
        }
        throw error;
      }
      const generatedAt = Date.now();
      const proposal: AnalysisProposal = { ...model.proposal, version: 1, market, provider: 'Groq', model: AI_MODEL, providerRequestId: model.requestId,
        generatedAt, expiresAt: Math.min(generatedAt + (data.interval === '1h' ? 15 * 60000 : 3600000), data.dataAsOf + (data.interval === '1h' ? 2 * 3600000 : 5 * 86400000)),
        dataAsOf: data.dataAsOf, fetchedAt: data.fetchedAt, interval: data.interval, observationKind: data.observationKind,
        ...(data.derivedFrom ? { derivedFrom: data.derivedFrom } : {}), observations: data.values.length,
        lastValue: data.values[data.values.length - 1], indicators };
      parseAnalysisProposal(proposal, market, generatedAt);
      await this.state.storage.put(cacheKey, proposal);
      return reply({ proposal, cached: false });
    } catch (error) {
      if (error instanceof AnalysisUnavailable) {
        return reply({ error: `Analysis Unavailable: ${error.message}` }, error.status, error.retryAt);
      }
      return reply({ error: 'Analysis Unavailable: invalid data, indicator computation or provider response. No recommendation was generated.' }, 503);
    } finally { this.busy = false; }
  }
}
