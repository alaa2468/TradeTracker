import type { Trade } from '../db/database';

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function belongsToSession(recorded: string, session: string): boolean {
  return recorded === session || (recorded === 'London/NY Overlap' && (session === 'London' || session === 'New York'));
}

export function coachInsight(trades: Trade[], kind: string): string {
  if (!trades.length) return 'No recorded trades yet. Log a trade to see journal observations.';
  const net = (rows: Trade[]) => rows.reduce((sum, trade) => sum + trade.pnl, 0);
  if (kind === 'SESSION') {
    const sessions = [...new Set(trades.map((trade) => trade.session))];
    const ranked = sessions.map((session) => ({ session, rows: trades.filter((trade) => trade.session === session) }))
      .sort((a, b) => net(b.rows) - net(a.rows));
    return ranked.map(({ session, rows }) => `${session}: $${net(rows).toFixed(2)} across ${rows.length} trades`).join('. ') + '. These are recorded results, not predictions.';
  }
  if (kind === 'MOOD') {
    return [...new Set(trades.map((trade) => trade.emotion))].map((emotion) => {
      const rows = trades.filter((trade) => trade.emotion === emotion);
      const winRate = Math.round(rows.filter((trade) => trade.pnl > 0).length / rows.length * 100);
      return `${emotion}: ${winRate}% wins, $${net(rows).toFixed(2)} net (${rows.length} trades)`;
    }).join('. ') + '. Association does not establish a cause.';
  }
  if (kind === 'MISTAKES') {
    const losses = trades.filter((trade) => trade.pnl < 0);
    return `${losses.length} of ${trades.length} recorded trades closed at a loss ($${net(losses).toFixed(2)} total). Review their notes to identify repeated execution mistakes; outcomes alone do not establish a mistake or the effect of a daily limit.`;
  }
  return `Across ${trades.length} recorded trades, net profit / loss is $${net(trades).toFixed(2)}, with ${trades.filter((trade) => trade.pnl > 0).length} wins, ${trades.filter((trade) => trade.pnl < 0).length} losses, and ${trades.filter((trade) => trade.pnl === 0).length} break-even trades.`;
}

export function questionKind(question: string): string | undefined {
  if (/session|london|new york|tokyo|sydney/i.test(question)) return 'SESSION';
  if (/mood|emotion|calm|stress|psycholog/i.test(question)) return 'MOOD';
  if (/mistake|loss|drawdown/i.test(question)) return 'MISTAKES';
  if (/summary|summari|overall|performance|profit|pnl/i.test(question)) return 'SUMMARY';
  return undefined;
}

export function parsePnl(input: string): number | undefined {
  const value = input.trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return undefined;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : undefined;
}
