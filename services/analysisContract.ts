import type { Indicators } from '../utils/indicators';

export type AnalysisSource = 'binance' | 'kraken' | 'frankfurter' | 'gold';
export interface AnalysisMarket { source: AnalysisSource; pair: string }
export const ANALYSIS_PAIRS: Record<AnalysisSource, readonly string[]> = {
  binance: ['BTC/USDT', 'ETH/USDT'], kraken: ['BTC/USD', 'ETH/USD'],
  frankfurter: ['EUR/USD', 'USD/EUR', 'GBP/USD', 'USD/JPY'], gold: ['XAU/USD'],
};
export interface ModelProposal {
  action: 'BUY' | 'SELL' | 'WAIT'; explanation: string; conflictingSignals: string[];
  uncertainty: 'medium' | 'high'; uncertaintyExplanation: string; risks: string[];
}
export interface AnalysisProposal extends ModelProposal {
  version: 1; market: AnalysisMarket; provider: 'Groq'; model: string; providerRequestId: string;
  generatedAt: number; expiresAt: number; dataAsOf: number; fetchedAt: number;
  interval: '1h' | '1d'; observationKind: 'closed-candle' | 'daily-reference';
  derivedFrom?: 'EUR/USD'; observations: number; lastValue: number; indicators: Indicators;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid analysis response.');
  return value as Record<string, unknown>;
}
export function parseAnalysisMarket(value: unknown): AnalysisMarket {
  const row = record(value);
  if (Object.keys(row).length !== 2 || typeof row.source !== 'string' || !Object.hasOwn(ANALYSIS_PAIRS, row.source)
    || typeof row.pair !== 'string' || !ANALYSIS_PAIRS[row.source as AnalysisSource].includes(row.pair)) throw new Error('Unsupported analysis market.');
  return { source: row.source as AnalysisSource, pair: row.pair };
}
function text(value: unknown): value is string { return typeof value === 'string' && value.trim().length >= 3 && value.length <= 1800; }
function texts(value: unknown): value is string[] { return Array.isArray(value) && value.length >= 1 && value.length <= 5 && value.every(text); }
export function parseModelProposal(value: unknown): ModelProposal {
  const row = record(value);
  const keys = ['action', 'explanation', 'conflictingSignals', 'uncertainty', 'uncertaintyExplanation', 'risks'];
  if (Object.keys(row).some(k => !keys.includes(k)) || !['BUY', 'SELL', 'WAIT'].includes(String(row.action))
    || !text(row.explanation) || !texts(row.conflictingSignals) || !['medium', 'high'].includes(String(row.uncertainty))
    || !text(row.uncertaintyExplanation) || !texts(row.risks)) throw new Error('AI returned an invalid proposal. No recommendation is available.');
  return row as unknown as ModelProposal;
}
export function parseAnalysisProposal(value: unknown, expected: AnalysisMarket, now = Date.now()): AnalysisProposal {
  const row = record(value), market = parseAnalysisMarket(row.market);
  parseModelProposal(Object.fromEntries(['action', 'explanation', 'conflictingSignals', 'uncertainty', 'uncertaintyExplanation', 'risks'].map(key => [key, row[key]])));
  const daily = expected.source === 'frankfurter';
  if (market.source !== expected.source || market.pair !== expected.pair || row.version !== 1 || row.provider !== 'Groq'
    || row.model !== 'openai/gpt-oss-20b' || !text(row.providerRequestId)
    || row.interval !== (daily ? '1d' : '1h') || row.observationKind !== (daily ? 'daily-reference' : 'closed-candle')
    || row.derivedFrom !== (expected.pair === 'USD/EUR' ? 'EUR/USD' : undefined)) throw new Error('Analysis does not match the selected market or model.');
  for (const key of ['generatedAt', 'expiresAt', 'dataAsOf', 'fetchedAt']) {
    if (!Number.isSafeInteger(row[key]) || (row[key] as number) <= 0) throw new Error('Invalid analysis timestamp.');
  }
  const proposal = row as unknown as AnalysisProposal;
  if (proposal.generatedAt > now + 60000 || proposal.expiresAt <= now || proposal.expiresAt <= proposal.generatedAt
    || proposal.dataAsOf > proposal.fetchedAt || proposal.fetchedAt > proposal.generatedAt
    || now - proposal.dataAsOf > (daily ? 5 * 86400000 : 2 * 3600000)
    || !Number.isInteger(proposal.observations) || proposal.observations < 100 || proposal.observations > 1000
    || !Number.isFinite(proposal.lastValue) || proposal.lastValue <= 0) throw new Error('Analysis is expired, stale, or incomplete. Analyze again.');
  const indicators = record(row.indicators), macd = record(indicators.macd);
  for (const key of ['rsi14', 'sma20', 'sma50', 'ema20', 'ema50']) {
    if (typeof indicators[key] !== 'number' || !Number.isFinite(indicators[key])) throw new Error('Invalid analysis indicators.');
  }
  for (const key of ['line', 'signal', 'histogram']) if (typeof macd[key] !== 'number' || !Number.isFinite(macd[key])) throw new Error('Invalid MACD.');
  if ((indicators.rsi14 as number) < 0 || (indicators.rsi14 as number) > 100 || macd.fast !== 12 || macd.slow !== 26 || macd.signalPeriod !== 9
    || ['sma20', 'sma50', 'ema20', 'ema50'].some(key => (indicators[key] as number) <= 0)) throw new Error('Invalid indicator range.');
  return proposal;
}
