import type { Trade, TradingSession } from '../db/database';
import { localDateKey } from './trades';

export type Timeframe = 'ALL' | 'MONTH' | 'WEEK';

export function summarize(trades: readonly Pick<Trade, 'pnl'>[]) {
  const pnl = trades.reduce((sum, trade) => sum + trade.pnl, 0);
  const wins = trades.filter(trade => trade.pnl > 0).length;
  const losses = trades.filter(trade => trade.pnl < 0).length;
  return { pnl, count: trades.length, wins, losses, breakeven: trades.length - wins - losses,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    average: trades.length ? pnl / trades.length : 0 };
}

export function periodStart(timeframe: Timeframe, now: Date): number {
  if (timeframe === 'ALL') return -Infinity;
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (timeframe === 'WEEK' ? 6 : 29)).getTime();
}

export function filterTrades(trades: readonly Trade[], timeframe: Timeframe, now = new Date()): Trade[] {
  if (timeframe === 'ALL') return [...trades];
  const cutoff = localDateKey(new Date(periodStart(timeframe, now)));
  const today = localDateKey(now);
  return trades.filter(trade => trade.tradeDate >= cutoff && trade.tradeDate <= today);
}

export function sessionSeconds(session: TradingSession, now = Date.now()): number {
  return session.status === 'completed' ? session.duration ?? 0
    : Math.max(0, (now - Date.parse(session.start_time)) / 1000);
}

// Count only the part inside the selected calendar range. Adding overlapping
// individual trade durations would double-count the user's time.
export function tradingSeconds(sessions: readonly TradingSession[], timeframe: Timeframe, now = new Date()): number {
  const cutoff = periodStart(timeframe, now);
  return sessions.reduce((sum, session) => {
    const start = Math.max(cutoff, Date.parse(session.start_time));
    const end = Math.min(now.getTime(), session.end_time ? Date.parse(session.end_time) : now.getTime());
    return sum + Math.max(0, end - start) / 1000;
  }, 0);
}

export function money(value: number): string {
  return `${value < 0 ? '-' : '+'}$${Math.abs(value).toFixed(2)}`;
}

export function duration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 3600)}h ${Math.floor(total % 3600 / 60)}m ${total % 60}s`;
}

export function tradeSessionLabel(trade: Pick<Trade, 'session_id' | 'session' | 'isDemo'>): string {
  if (trade.session_id !== null) return `Session #${trade.session_id}`;
  return trade.isDemo ? 'Demo example' : 'Unassigned legacy trade';
}

export function tradeTime(trade: Pick<Trade, 'timestamp' | 'tradeDate'>): string {
  return trade.timestamp ? new Date(trade.timestamp).toLocaleString() : `${trade.tradeDate} · time not recorded`;
}

export function localDateTime(date: Date): string {
  return `${localDateKey(date)} ${[date.getHours(), date.getMinutes(), date.getSeconds()].map(v => String(v).padStart(2, '0')).join(':')}`;
}

// Reject rollover dates (e.g. February 31) instead of letting Date correct them.
export function parseLocalDateTime(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return undefined;
  const [, year, month, day, hour, minute, second = '0'] = match;
  const date = new Date(+year, +month - 1, +day, +hour, +minute, +second);
  if (date.getFullYear() !== +year || date.getMonth() !== +month - 1 || date.getDate() !== +day
      || date.getHours() !== +hour || date.getMinutes() !== +minute || date.getSeconds() !== +second) return undefined;
  return date.toISOString();
}
