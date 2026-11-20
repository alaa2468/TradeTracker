import type { SessionCheckIn, Trade, TradingSession } from '../db/database';
import { localDateKey } from './trades';

export const MOODS = ['Calm', 'Confident', 'Excited', 'Nervous', 'Stressed', 'Frustrated'] as const;
export type Mood = typeof MOODS[number];
export interface CoachPreferences {
  frequentTrades: number;
  windowMinutes: number;
  consecutiveLosses: number;
  longSessionMinutes: number;
}
export const DEFAULT_COACH_PREFERENCES: CoachPreferences = {
  frequentTrades: 5, windowMinutes: 30, consecutiveLosses: 3, longSessionMinutes: 120,
};
export function validatePreferences(value: CoachPreferences) {
  const ranges: [keyof CoachPreferences, number, number][] = [
    ['frequentTrades', 2, 100], ['windowMinutes', 1, 240],
    ['consecutiveLosses', 2, 20], ['longSessionMinutes', 15, 720],
  ];
  for (const [key, min, max] of ranges) {
    if (!Number.isInteger(value[key]) || value[key] < min || value[key] > max) {
      throw new Error(`${key} must be a whole number from ${min} to ${max}.`);
    }
  }
}
export interface CoachSignal { kind: 'frequency' | 'losses' | 'duration' | 'emotion'; text: string }

// Unknown timestamps are never assigned an invented intraday order.
function orderedTrades(trades: Trade[], session: TradingSession, now: number) {
  return trades.filter(t => !t.isDemo && t.session_id === session.id && t.timestamp
    && Number.isFinite(Date.parse(t.timestamp)) && Date.parse(t.timestamp) <= now
    && Date.parse(t.timestamp) >= Date.parse(session.start_time)
    && (!session.end_time || Date.parse(t.timestamp) <= Date.parse(session.end_time)))
    .sort((a, b) => Date.parse(a.timestamp!) - Date.parse(b.timestamp!) || a.id - b.id);
}

export function sessionSignals(trades: Trade[], session: TradingSession, checkIns: SessionCheckIn[],
  preferences = DEFAULT_COACH_PREFERENCES, now = Date.now(), live = false): CoachSignal[] {
  const rows = orderedTrades(trades, session, now);
  const signals: CoachSignal[] = [];
  const windowMs = preferences.windowMinutes * 60000;
  let peak = 0, left = 0;
  const windowRows = live ? rows.filter(t => Date.parse(t.timestamp!) >= now - windowMs) : rows;
  for (let right = 0; right < windowRows.length; right++) {
    while (Date.parse(windowRows[right].timestamp!) - Date.parse(windowRows[left].timestamp!) > windowMs) left++;
    peak = Math.max(peak, right - left + 1);
  }
  if (peak >= preferences.frequentTrades) signals.push({ kind: 'frequency',
    text: `${peak} recorded trades within ${preferences.windowMinutes} minutes: a possible overtrading pattern. Review whether each entry followed your plan.` });
  let streak = 0, longest = 0;
  for (const row of rows) { streak = row.pnl < 0 ? streak + 1 : 0; longest = Math.max(longest, streak); }
  const lossCount = live ? streak : longest;
  if (lossCount >= preferences.consecutiveLosses) signals.push({ kind: 'losses',
    text: `${lossCount} consecutive recorded losses in this session. Pause to reflect on your process; losses alone do not establish emotional trading.` });
  const end = Math.min(now, session.end_time ? Date.parse(session.end_time) : now);
  const minutes = Math.max(0, (end - Date.parse(session.start_time)) / 60000);
  if (minutes >= preferences.longSessionMinutes) signals.push({ kind: 'duration',
    text: `Session elapsed time is ${Math.floor(minutes)} minutes. Check fatigue. This includes time with the app closed and may include breaks.` });
  const relevant = checkIns.filter(c => c.session_id === session.id && Date.parse(c.recorded_at) <= now);
  const feeling = [...relevant].sort((a, b) => Date.parse(b.recorded_at) - Date.parse(a.recorded_at))[0];
  const recentTrade = rows.at(-1);
  const recentMood = recentTrade && (!live || now - Date.parse(recentTrade.timestamp!) <= windowMs) ? recentTrade.emotion : undefined;
  if ((feeling && (feeling.stress >= 4 || ['Stressed', 'Frustrated'].includes(feeling.mood)))
    || (recentMood && ['Stressed', 'Frustrated'].includes(recentMood))) {
    signals.push({ kind: 'emotion', text: feeling && (feeling.stress >= 4 || ['Stressed', 'Frustrated'].includes(feeling.mood))
      ? `You reported ${feeling.mood.toLowerCase()} feelings with stress ${feeling.stress}/5 ${feeling.phase === 'before' ? 'before' : 'after'} this session. Consider stepping away and checking how you feel.`
      : `Your latest recorded trade was marked ${recentMood?.toLowerCase()}. Consider a short break and a fresh check of your plan.` });
  }
  return signals;
}

export function weeklyInsights(trades: Trade[], sessions: TradingSession[], checkIns: SessionCheckIn[],
  preferences = DEFAULT_COACH_PREFERENCES, now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const previousStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 13);
  const startKey = localDateKey(start), todayKey = localDateKey(now), previousKey = localDateKey(previousStart);
  const real = trades.filter(t => !t.isDemo && (!t.timestamp || Date.parse(t.timestamp) <= now.getTime()));
  const current = real.filter(t => t.tradeDate >= startKey && t.tradeDate <= todayKey);
  const previous = real.filter(t => t.tradeDate >= previousKey && t.tradeDate < startKey);
  // Behavior is evaluated only on trades in this reporting period, within each session.
  const periodSessions = sessions.filter(s => Date.parse(s.start_time) <= now.getTime()
    && (!s.end_time || Date.parse(s.end_time) >= start.getTime()));
  const flagged = periodSessions.map(s => ({ session: s, signals: sessionSignals(current,
    { ...s, start_time: new Date(Math.max(start.getTime(), Date.parse(s.start_time))).toISOString() }, checkIns, preferences, now.getTime()) }));
  const count = (kind: CoachSignal['kind']) => flagged.filter(s => s.signals.some(signal => signal.kind === kind)).length;
  const pairs = periodSessions.flatMap(s => {
    const before = checkIns.find(c => c.session_id === s.id && c.phase === 'before');
    const after = checkIns.find(c => c.session_id === s.id && c.phase === 'after' && Date.parse(c.recorded_at) <= now.getTime());
    return before && after && s.end_time && Date.parse(s.end_time) >= start.getTime() ? [{ before, after }] : [];
  });
  const lines = [
    `${current.length} personal trades recorded across ${new Set(current.map(t => t.tradeDate)).size} trading days.`,
    previous.length && current.length ? `${current.length - previous.length >= 0 ? '+' : ''}${current.length - previous.length} trades compared with the preceding seven days (${previous.length}). This is a count comparison, not a judgment of discipline.` : 'More recorded activity in both weeks is needed for a weekly comparison.',
    `${count('frequency')} sessions met your frequency threshold; ${count('losses')} had a loss streak meeting your threshold; ${count('duration')} reached your elapsed-time threshold within this period.`,
  ];
  if (pairs.length) {
    const change = pairs.reduce((sum, p) => sum + p.after.stress - p.before.stress, 0) / pairs.length;
    lines.push(`Across ${pairs.length} paired check-ins, stress changed by ${change >= 0 ? '+' : ''}${change.toFixed(1)} points on average (1–5 scale).`);
    for (const p of pairs.slice(0, 3)) lines.push(`Session #${p.before.session_id}: ${p.before.mood} → ${p.after.mood}.`);
  } else lines.push('No paired before/after check-ins yet. Missing feelings are left unknown.');
  const emotional = current.filter(t => ['Stressed', 'Frustrated'].includes(t.emotion));
  lines.push(`${emotional.length} of ${current.length} trades were marked stressed or frustrated. These are self-reported associations, not proof of a cause.`);
  const unknown = current.filter(t => !t.timestamp || t.session_id === null).length;
  if (unknown) lines.push(`${unknown} trades lack a timestamp or personal session; they contribute to counts, but not intraday behavior detection.`);
  const goal = count('frequency') ? 'Before each entry, write one sentence explaining how it follows your plan.'
    : count('losses') ? 'Review a sequence of losses against your written plan, focusing on your process rather than the outcome.'
    : count('duration') ? 'Schedule a short screen break before reaching your session-time threshold.'
    : emotional.length ? 'When you feel stressed or frustrated, step away and record how you feel before continuing.'
    : 'Complete a before and after check-in for your next session to build awareness of your habits.';
  return { startKey, todayKey, lines, goal };
}
