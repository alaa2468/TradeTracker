import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { router } from 'expo-router';
import type { Trade, TradingSession } from '@/db/database';
import { useJournalData } from '@/hooks/JournalProvider';
import { duration, money, sessionSeconds, summarize, tradeSessionLabel, tradeTime } from '@/utils/statistics';

export const ui = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#0d1117' },
  content: { padding: 16, paddingBottom: 40, gap: 14 },
  card: { backgroundColor: '#161b22', borderColor: '#30363d', borderWidth: 1, borderRadius: 12, padding: 16, gap: 8 },
  title: { color: '#f0f6fc', fontSize: 18, fontWeight: '700' },
  text: { color: '#c9d1d9', fontSize: 14, lineHeight: 21 },
  muted: { color: '#8b949e', fontSize: 13, lineHeight: 20 },
  value: { color: '#f0f6fc', fontSize: 26, fontWeight: '700' },
  row: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: { backgroundColor: '#238636', paddingHorizontal: 16, paddingVertical: 12, minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  secondary: { backgroundColor: '#21262d', borderWidth: 1, borderColor: '#30363d' },
  danger: { backgroundColor: '#a32828' },
  buttonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  green: { color: '#3fb950' },
  red: { color: '#f85149' },
  blue: { color: '#58a6ff' },
  input: { color: '#f0f6fc', backgroundColor: '#0d1117', borderWidth: 1, borderColor: '#30363d', padding: 12, minHeight: 46, borderRadius: 8 },
});

export function Button({ title, onPress, disabled, secondary, danger }: {
  title: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean;
}) {
  return <TouchableOpacity accessibilityRole="button" accessibilityState={{ disabled: !!disabled }}
    disabled={disabled} onPress={onPress} style={[ui.button, secondary && ui.secondary, danger && ui.danger, disabled && { opacity: 0.5 }]}>
    <Text style={ui.buttonText}>{title}</Text>
  </TouchableOpacity>;
}

export function DataSourceSwitch() {
  const { mode, setMode, loading } = useJournalData();
  return <View style={{ gap: 8 }}>
    <View style={ui.actions}>
      {(['real', 'demo'] as const).map(value => <TouchableOpacity key={value} accessibilityRole="button"
        accessibilityState={{ selected: mode === value }} onPress={() => setMode(value)}
        style={[ui.button, ui.secondary, mode === value && { backgroundColor: '#1f6feb' }]}>
        <Text style={ui.buttonText}>{value === 'real' ? 'My trades' : 'Demo examples'}</Text>
      </TouchableOpacity>)}
      {loading && <ActivityIndicator accessibilityLabel="Loading journal" color="#58a6ff" />}
    </View>
    {mode === 'demo' && <Text style={[ui.muted, ui.blue]}>Demo only · Examples are separate from your trades and personal sessions.</Text>}
  </View>;
}

export function Metrics({ trades }: { trades: readonly Trade[] }) {
  const stats = summarize(trades);
  return <View style={{ gap: 6 }}>
    <Text style={[ui.value, stats.pnl >= 0 ? ui.green : ui.red]}>{money(stats.pnl)}</Text>
    <Text style={ui.text}>{stats.count} trades · {stats.winRate.toFixed(1)}% win rate</Text>
    <Text style={ui.muted}>{stats.wins} wins · {stats.losses} losses · {stats.breakeven} breakeven</Text>
    <Text style={ui.muted}>Average per trade: {money(stats.average)}</Text>
  </View>;
}

export function SessionCard({ session, trades, now }: { session: TradingSession; trades: readonly Trade[]; now: number }) {
  const stats = summarize(trades.filter(trade => trade.session_id === session.id));
  return <TouchableOpacity accessibilityRole="button" accessibilityLabel={`Open Session #${session.id}`}
    style={ui.card} onPress={() => router.push({ pathname: '/session/[id]', params: { id: String(session.id) } })}>
    <View style={ui.row}>
      <Text style={ui.title}>Session #{session.id}</Text>
      <Text style={session.status === 'active' ? ui.green : ui.muted}>{session.status === 'active' ? 'ACTIVE' : 'COMPLETED'}</Text>
    </View>
    <Text style={ui.muted}>{new Date(session.start_time).toLocaleString()}</Text>
    <Text style={ui.text}>{duration(sessionSeconds(session, now))} · {stats.count} trades</Text>
    <View style={ui.row}>
      <Text style={stats.pnl >= 0 ? ui.green : ui.red}>{money(stats.pnl)}</Text>
      <Text style={ui.muted}>{stats.winRate.toFixed(1)}% win rate · Open details →</Text>
    </View>
  </TouchableOpacity>;
}

export function TradeSummary({ trade }: { trade: Trade }) {
  return <View style={{ gap: 6 }}>
    <View style={ui.row}>
      <Text style={[ui.title, { fontSize: 16 }]}>{trade.instrument} ({trade.direction}) {trade.isDemo ? '[DEMO]' : ''}</Text>
      <Text style={[ui.title, trade.pnl >= 0 ? ui.green : ui.red]}>{money(trade.pnl)}</Text>
    </View>
    <Text style={ui.muted}>{tradeTime(trade)}</Text>
    <Text style={[ui.muted, ui.blue]}>{tradeSessionLabel(trade)}</Text>
    <Text style={ui.text}>Entry {trade.entryPrice} · Exit {trade.exitPrice} · Size {trade.positionSize}</Text>
    <Text style={ui.muted}>{trade.strategy} · Mood: {trade.emotion || 'Not recorded'}</Text>
    {trade.session_id === null && trade.session ? <Text style={ui.muted}>Original market label: {trade.session}</Text> : null}
    {trade.notes ? <Text style={ui.text}>{trade.notes}</Text> : null}
  </View>;
}

export function PnlChart({ trades }: { trades: readonly Trade[] }) {
  const recent = [...trades].slice(0, 10).reverse();
  const max = Math.max(1, ...recent.map(trade => Math.abs(trade.pnl)));
  return <View style={ui.card}>
    <Text style={ui.title}>Last 10 trades · Profit / loss</Text>
    <Text style={ui.muted}>Green = profit · Red = loss · Gray = breakeven</Text>
    {!recent.length ? <Text style={ui.muted}>Your chart will appear after you log a trade.</Text> :
      <View style={{ flexDirection: 'row', gap: 4, height: 140, alignItems: 'flex-end' }}>
        {recent.map(trade => <View key={trade.id} accessible accessibilityLabel={`${trade.instrument}: ${money(trade.pnl)}`}
          style={{ flex: 1, alignItems: 'center', gap: 6 }}>
          <View style={{ width: '65%', maxWidth: 32, height: Math.max(2, Math.abs(trade.pnl) / max * 96),
            borderRadius: 4, backgroundColor: trade.pnl === 0 ? '#8b949e' : trade.pnl > 0 ? '#2ea043' : '#da3633' }} />
          <Text style={{ color: '#8b949e', fontSize: 10 }}>{trade.instrument.slice(0, 3)}</Text>
        </View>)}
      </View>}
  </View>;
}
