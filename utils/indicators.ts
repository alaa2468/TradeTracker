export interface Indicators {
  rsi14: number; sma20: number; sma50: number; ema20: number; ema50: number;
  macd: { line: number; signal: number; histogram: number; fast: 12; slow: 26; signalPeriod: 9 };
}
// SMA-seeded EMA; Wilder-smoothed RSI. Input ordering/intervals are validated
// by the market adapter. No missing observations are synthesized here.
export function emaSeries(values: readonly number[], period: number): number[] {
  if (!Number.isInteger(period) || period < 1 || values.length < period
    || values.some(v => !Number.isFinite(v))) throw new Error('Insufficient or invalid EMA data.');
  let current = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = [current], alpha = 2 / (period + 1);
  for (const value of values.slice(period)) { current += alpha * (value - current); result.push(current); }
  return result;
}
export function rsi(values: readonly number[], period = 14): number {
  if (!Number.isInteger(period) || period < 1 || values.length <= period
    || values.some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Insufficient or invalid RSI data.');
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) { const change = values[i] - values[i - 1]; gain += Math.max(0, change); loss += Math.max(0, -change); }
  gain /= period; loss /= period;
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    gain = (gain * (period - 1) + Math.max(0, change)) / period;
    loss = (loss * (period - 1) + Math.max(0, -change)) / period;
  }
  return gain === 0 && loss === 0 ? 50 : loss === 0 ? 100 : 100 - 100 / (1 + gain / loss);
}
export function calculateIndicators(values: readonly number[]): Indicators {
  if (values.length < 100 || values.some(v => !Number.isFinite(v) || v <= 0)) throw new Error('Analysis requires at least 100 valid historical observations.');
  const sma = (p: number) => values.slice(-p).reduce((a, b) => a + b, 0) / p;
  const last = (rows: number[]) => rows[rows.length - 1];
  const fast = emaSeries(values, 12), slow = emaSeries(values, 26);
  const lines = slow.map((value, i) => fast[i + 14] - value);
  const line = last(lines), signal = last(emaSeries(lines, 9));
  const result: Indicators = { rsi14: rsi(values), sma20: sma(20), sma50: sma(50),
    ema20: last(emaSeries(values, 20)), ema50: last(emaSeries(values, 50)),
    macd: { line, signal, histogram: line - signal, fast: 12, slow: 26, signalPeriod: 9 } };
  if ([result.rsi14, result.sma20, result.sma50, result.ema20, result.ema50, line, signal, line - signal].some(v => !Number.isFinite(v))) {
    throw new Error('Indicators could not be calculated reliably.');
  }
  return result;
}
