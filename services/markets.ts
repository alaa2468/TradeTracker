import { fetchMarketData, type MarketPair, type MarketResult } from './binance';
import { fetchKrakenMarketData, type KrakenRequestOptions, type KrakenResult } from './kraken';

export const EXCHANGES = ['binance', 'kraken'] as const;
export type MarketExchange = typeof EXCHANGES[number];
export const MARKET_ASSETS = ['BTC', 'ETH'] as const;
export type MarketAsset = typeof MARKET_ASSETS[number];
export type QuoteCurrency = 'USD' | 'USDT';
export const EXCHANGE_DETAILS: Record<MarketExchange, { name: string; currency: QuoteCurrency; host: string }> = {
  binance: { name: 'Binance', currency: 'USDT', host: 'data-api.binance.vision' },
  kraken: { name: 'Kraken', currency: 'USD', host: 'api.kraken.com' },
};
export type ExchangeData = Record<MarketAsset, MarketPair>;
export type ExchangeResult = ({ asset: MarketAsset } & Omit<Extract<MarketResult, { resource: 'quote' }>, 'symbol'>)
  | ({ asset: MarketAsset } & Omit<Extract<MarketResult, { resource: 'history' }>, 'symbol'>)
  | { asset: MarketAsset; resource: 'quote' | 'history'; error: string; retryAt?: number };
export function emptyExchangeData(): ExchangeData { return { BTC: {}, ETH: {} }; }
export function pairLabel(exchange: MarketExchange, asset: MarketAsset) { return `${asset}/${EXCHANGE_DETAILS[exchange].currency}`; }
export async function fetchExchangeData(exchange: MarketExchange, options: KrakenRequestOptions = {}): Promise<ExchangeResult[]> {
  if (!EXCHANGES.includes(exchange)) throw new Error('Unsupported market exchange.');
  const rows: (MarketResult | KrakenResult)[] = exchange === 'binance' ? await fetchMarketData(options) : await fetchKrakenMarketData(options);
  return rows.map(row => {
    const { symbol, ...result } = row;
    return { ...result, asset: symbol.startsWith('BTC') ? 'BTC' : 'ETH' };
  });
}
export function mergeExchangeResults(previous: ExchangeData, results: ExchangeResult[]): ExchangeData {
  const next = { BTC: { ...previous.BTC }, ETH: { ...previous.ETH } };
  for (const result of results) {
    const pair = next[result.asset];
    if ('error' in result) {
      if (result.resource === 'quote') pair.quoteError = result.error;
      else pair.historyError = result.error;
    } else if (result.resource === 'quote') { pair.quote = result.value; pair.quoteError = undefined; }
    else { pair.history = result.value; pair.historyError = undefined; }
  }
  return next;
}
