import { parseAnalysisProposal, record, type AnalysisMarket, type AnalysisProposal } from './analysisContract';

export class AnalysisRequestError extends Error {
  constructor(message: string, readonly retryAt = 0) { super(message); }
}
export interface AnalysisState { loading: boolean; proposal?: AnalysisProposal; error?: string; retryAt: number; cached?: boolean }
export async function requestAnalysis(market: AnalysisMarket, accessCode: string, backendUrl: string | undefined,
  signal: AbortSignal, fetcher = fetch): Promise<{ proposal: AnalysisProposal; cached: boolean }> {
  if (!backendUrl) throw new AnalysisRequestError('Analysis Unavailable: set up the free online backend first. See docs/ai-testing.md.');
  let origin: URL;
  try { origin = new URL(backendUrl); } catch { throw new AnalysisRequestError('Analysis backend URL is invalid.'); }
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.username || origin.password || origin.search || origin.hash) {
    throw new AnalysisRequestError('Analysis backend must be an HTTPS origin without a path or credentials.');
  }
  if (accessCode.length < 24 || accessCode.length > 128) throw new AnalysisRequestError('Enter the project’s demo access code (24–128 characters), never a model or exchange API key.');
  const response = await fetcher(`${origin.origin}/v1/analysis`, { method: 'POST', credentials: 'omit', cache: 'no-store', signal,
    headers: { Authorization: `Bearer ${accessCode}`, 'Content-Type': 'application/json' }, body: JSON.stringify(market) });
  const payload = record(await response.json());
  if (!response.ok) {
    let retryAt = 0;
    if (response.status === 429) {
      const raw = response.headers.get('Retry-After'), now = Date.now();
      const delay = raw !== null && /^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw ?? '') - now;
      retryAt = now + (Number.isFinite(delay) ? Math.max(1000, delay) : 60000);
    }
    throw new AnalysisRequestError(typeof payload.error === 'string' && payload.error.length <= 600 ? payload.error : 'Analysis Unavailable: the backend could not complete the request.', retryAt);
  }
  if (typeof payload.cached !== 'boolean') throw new AnalysisRequestError('Analysis response is invalid.');
  return { proposal: parseAnalysisProposal(payload.proposal, market), cached: payload.cached };
}
export class AnalysisFeed {
  state: AnalysisState = { loading: false, retryAt: 0 };
  private active = false;
  private epoch = 0;
  private controller?: AbortController;
  constructor(private market: AnalysisMarket, private publish: (state: AnalysisState) => void,
    private backendUrl?: string, private load = requestAnalysis) {}
  private emit(state: AnalysisState) { this.state = state; this.publish(state); }
  setActive(active: boolean) {
    this.active = active;
    if (!active) { this.epoch++; this.controller?.abort(); this.controller = undefined; this.emit({ ...this.state, loading: false }); }
  }
  async analyze(accessCode: string) {
    if (!this.active || this.state.loading || this.state.retryAt > Date.now()) return;
    const epoch = ++this.epoch, controller = new AbortController(); this.controller = controller;
    this.emit({ loading: true, retryAt: 0 });
    const timer = setTimeout(() => {
      if (this.epoch !== epoch) return;
      this.epoch++; controller.abort(); this.controller = undefined;
      this.emit({ loading: false, retryAt: 0, error: 'Analysis Unavailable: request timed out. Try again later.' });
    }, 45000);
    try {
      const result = await this.load(this.market, accessCode, this.backendUrl, controller.signal);
      if (this.epoch !== epoch || controller.signal.aborted) return;
      this.emit({ loading: false, retryAt: Date.now() + 10000, ...result });
    } catch (error) {
      if (this.epoch !== epoch || controller.signal.aborted) return;
      this.emit({ loading: false, retryAt: error instanceof AnalysisRequestError ? error.retryAt : 0,
        error: error instanceof AnalysisRequestError ? error.message : 'Analysis Unavailable: connection failed or the response was invalid. No fallback recommendation was generated.' });
    } finally { clearTimeout(timer); if (this.epoch === epoch) this.controller = undefined; }
  }
}
