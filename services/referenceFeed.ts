import { fetchReferenceMarket, type ReferenceOptions, type ReferencePair, type ReferenceSnapshot } from './referenceMarkets';

export interface ReferenceFeedState extends ReferenceSnapshot { pair: ReferencePair; loading: boolean; retryAt: number }
// Screen-memory caches retain real observations through category switches. No SQLite migrations.
const saved = new Map<ReferencePair, ReferenceFeedState>();
const cooldowns = { gold: 0, forex: 0 };
export class ReferenceFeed {
  state: ReferenceFeedState;
  private active = false;
  private generation = 0;
  private controller?: AbortController;
  constructor(pair: ReferencePair, private publish: (state: ReferenceFeedState) => void,
    private options: ReferenceOptions = {}, private load = fetchReferenceMarket) {
    this.state = { ...(saved.get(pair) ?? {}), pair, loading: false, retryAt: 0 };
  }
  private emit(next: ReferenceFeedState) { this.state = next; saved.set(next.pair, next); this.publish(next); }
  private cancel() { this.generation++; this.controller?.abort(); this.controller = undefined; }
  async setActive(active: boolean) {
    this.active = active;
    if (!active) { this.cancel(); this.emit({ ...this.state, loading: false }); return; }
    await this.refresh();
  }
  async selectPair(pair: ReferencePair) {
    if (pair === this.state.pair) return;
    this.cancel();
    this.emit({ ...(saved.get(pair) ?? {}), pair, loading: false, retryAt: 0 });
    if (this.active) await this.refresh();
  }
  async refresh() {
    const now = (this.options.now ?? Date.now)();
    const host = this.state.pair === 'XAU/USD' ? 'gold' : 'forex';
    const retryAt = Math.max(this.state.retryAt, cooldowns[host]);
    if (!this.active || this.state.loading) return;
    if (retryAt > now) { this.emit({ ...this.state, retryAt }); return; }
    const pair = this.state.pair, generation = ++this.generation;
    const controller = new AbortController(); this.controller = controller;
    // Respect provider refresh frequency and prevent rapid manual/category-switch requests.
    if (host === 'gold') cooldowns.gold = now + 30000;
    const localCooldown = now + (host === 'gold' ? 30000 : 10000);
    this.emit({ ...this.state, loading: true, retryAt: localCooldown });
    try {
      const result = await this.load(pair, { ...this.options, signal: controller.signal, previous: this.state });
      if (generation !== this.generation || controller.signal.aborted) return;
      // Gold history has a separate server-enforced quota; it must not block the
      // keyless spot endpoint. All quote/provider Retry-After deadlines are honored.
      cooldowns[host] = Math.max(cooldowns[host], host === 'gold' ? result.quoteRetryAt ?? 0 : result.retryAt);
      this.emit({ pair, quote: result.quote ?? this.state.quote, history: result.history ?? this.state.history,
        quoteError: result.quoteError, historyError: result.historyError, loading: false, retryAt: Math.max(localCooldown, cooldowns[host]) });
    } catch (error) {
      if (generation !== this.generation || controller.signal.aborted) return;
      const message = error instanceof Error ? error.message : 'Market data is unavailable.';
      this.emit({ ...this.state, loading: false, quoteError: message, historyError: message });
    } finally { if (generation === this.generation) this.controller = undefined; }
  }
}
