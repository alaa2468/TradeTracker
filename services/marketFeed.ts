import { emptyExchangeData, EXCHANGES, fetchExchangeData, mergeExchangeResults,
  type ExchangeData, type MarketExchange } from './markets';

export interface ExchangeSnapshot { data: ExchangeData; loading: boolean; error: string; retryAt: number }
export interface MarketFeedState { exchange: MarketExchange; snapshots: Record<MarketExchange, ExchangeSnapshot> }
// Public request cooldowns survive reopening the screen, independently per host.
const sharedCooldowns: Record<MarketExchange, number> = { binance: 0, kraken: 0 };
export function initialMarketFeedState(cooldowns = sharedCooldowns): MarketFeedState {
  const snapshot = (exchange: MarketExchange): ExchangeSnapshot => ({ data: emptyExchangeData(), loading: false, error: '', retryAt: cooldowns[exchange] });
  return { exchange: 'binance', snapshots: { binance: snapshot('binance'), kraken: snapshot('kraken') } };
}

// Keep async selection/cancellation behavior outside React so it can be exercised
// with delayed exchange responses and the same logic used by the mobile hook.
export class MarketFeed {
  state: MarketFeedState;
  private active = false;
  private generation = 0;
  private controller: AbortController | null = null;
  constructor(private readonly listener: (state: MarketFeedState) => void,
    private readonly fetcher = fetchExchangeData, private readonly now = Date.now,
    private readonly cooldowns = sharedCooldowns) {
    this.state = initialMarketFeedState(cooldowns);
  }
  private update(exchange: MarketExchange, patch: Partial<ExchangeSnapshot>) {
    this.state = { ...this.state, snapshots: { ...this.state.snapshots,
      [exchange]: { ...this.state.snapshots[exchange], ...patch } } };
    this.listener(this.state);
  }
  private cancel() {
    this.generation++;
    this.controller?.abort();
    this.controller = null;
    this.state = { ...this.state, snapshots: { ...this.state.snapshots,
      [this.state.exchange]: { ...this.state.snapshots[this.state.exchange], loading: false } } };
  }
  async selectExchange(exchange: MarketExchange) {
    if (!EXCHANGES.includes(exchange)) throw new Error('Unsupported market exchange.');
    if (exchange === this.state.exchange) return;
    this.cancel();
    this.state = { ...this.state, exchange };
    this.listener(this.state);
    await this.refresh();
  }
  async setActive(active: boolean) {
    this.active = active;
    if (active) await this.refresh();
    else { this.cancel(); this.listener(this.state); }
  }
  async refresh() {
    const exchange = this.state.exchange;
    if (!this.active || this.controller || this.now() < this.cooldowns[exchange]) return;
    const controller = new AbortController();
    this.controller = controller;
    const generation = ++this.generation;
    this.update(exchange, { loading: true, error: '' });
    try {
      const results = await this.fetcher(exchange, { signal: controller.signal });
      if (controller.signal.aborted || generation !== this.generation) return;
      this.cooldowns[exchange] = Math.max(0, ...results.map(r => 'error' in r ? r.retryAt ?? 0 : 0));
      this.update(exchange, { data: mergeExchangeResults(this.state.snapshots[exchange].data, results), retryAt: this.cooldowns[exchange] });
    } catch {
      if (!controller.signal.aborted && generation === this.generation) this.update(exchange, { error: 'Unable to refresh market data. Check your connection and try again.' });
    } finally {
      if (generation === this.generation) { this.controller = null; this.update(exchange, { loading: false }); }
    }
  }
}
