import { useTrades } from '@/hooks/useTrades';
import { localDateKey } from '@/utils/trades';
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { resetToDemoTrades } from '@/db/database';
import { router } from 'expo-router';
import { useNow } from '@/hooks/useNow';
import { Button, DataSourceSwitch, PnlChart } from '@/components/TradingUI';
import { duration, filterTrades, money, summarize, tradeSessionLabel, tradeTime, tradingSeconds, type Timeframe } from '@/utils/statistics';

export default function HomeScreen() {
  const { trades, sessions, mode, refresh, loading } = useTrades();
  const now = useNow(mode === 'real' && sessions.some(session => session.status === 'active'));
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState('');
  const [timeframe, setTimeframe] = useState<Timeframe>('ALL');

  const filteredTrades = filterTrades(trades, timeframe, new Date(now));
  const stats = summarize(filteredTrades);
  const totalPnl = stats.pnl;
  const winRate = stats.winRate;
  const totalTime = tradingSeconds(sessions, timeframe, new Date(now));

  const todayTrades = trades.filter((trade) => trade.tradeDate === localDateKey()).length;
  const noted = filteredTrades.filter((trade) => (trade.notes ?? '').trim().length > 0).length;
  const notesRate = filteredTrades.length ? Math.round(noted / filteredTrades.length * 100) : 0;

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={{ marginBottom: 14 }}><DataSourceSwitch /></View>
      <View style={styles.filterRow}>
        {(['ALL', 'MONTH', 'WEEK'] as const).map((tf) => (
          <TouchableOpacity
            key={tf}
            accessibilityRole="button"
            accessibilityState={{ selected: timeframe === tf }}
            style={[styles.filterBtn, timeframe === tf && styles.filterBtnActive]}
            onPress={() => setTimeframe(tf)}
          >
            <Text style={[styles.filterText, timeframe === tf && styles.filterTextActive]}>
              {tf === 'ALL' ? 'All Time' : tf === 'MONTH' ? '30 Days' : '7 Days'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Net Profit / Loss</Text>
        <Text style={[styles.heroValue, totalPnl >= 0 ? styles.green : styles.red]}>
          {totalPnl >= 0 ? `+$${totalPnl.toFixed(2)}` : `-$${Math.abs(totalPnl).toFixed(2)}`}
        </Text>
        <Text style={styles.subLabel}>
          {stats.count} Trades | {mode === 'real' ? `${duration(totalTime)} trading time` : 'Demo examples'}
        </Text>
      </View>

      <View style={styles.grid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Win Rate</Text>
          <Text style={styles.statValue}>{winRate.toFixed(1)}%</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Wins / Losses</Text>
          <Text style={styles.statValue}>
            <Text style={styles.green}>{stats.wins}W</Text> / <Text style={styles.red}>{stats.losses}L</Text>
          </Text>
        </View>
      </View>

      <View style={styles.grid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Average per trade</Text>
          <Text style={[styles.statValue, { fontSize: 20 }, stats.average >= 0 ? styles.green : styles.red]}>{money(stats.average)}</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Breakeven trades</Text>
          <Text style={styles.statValue}>{stats.breakeven}</Text>
        </View>
      </View>
      {mode === 'real' && <View style={[styles.sectionCard, { gap: 10 }]}>
        <Text style={styles.goalText}>{sessions.some(session => session.status === 'active') ? 'Your personal session is active.' : 'Start a personal session to record trades and track your time.'}</Text>
        <Button title="Open Sessions" onPress={() => router.navigate('/sessions')} />
        <Text style={styles.subLabel}>Trading time includes active sessions. Date filters count only time inside the selected days. Legacy trades have no recorded personal session time.</Text>
      </View>}
      <View style={{ marginBottom: 14 }}><PnlChart trades={filteredTrades} /></View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Personal Discipline Goals</Text>
        <Text style={styles.goalText}>Daily Trade Limit (target): {todayTrades} / 3 ({todayTrades <= 3 ? 'Within limit' : 'Exceeded'})</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(todayTrades / 3 * 100, 100)}%` }]} />
        </View>
        <Text style={styles.goalText}>Trades With Notes: {notesRate}%</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${notesRate}%`, backgroundColor: '#2ea043' }]} />
        </View>
      </View>

      <Text style={styles.sectionHeader}>Recent Trades</Text>
      {!filteredTrades.length && <Text style={styles.subLabel}>{loading ? 'Loading trades…' : 'No trades in this period yet.'}</Text>}
      {filteredTrades.slice(0, 5).map((t) => (
        <View key={t.id} style={styles.tradeRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.tradeTitle}>
              {t.instrument} ({t.direction}) {t.isDemo ? '[DEMO]' : ''}
            </Text>
            <Text style={styles.tradeMeta}>
              {tradeTime(t)} | {tradeSessionLabel(t)} | Mood: {t.emotion}
            </Text>
          </View>
          <Text style={[styles.tradePnl, t.pnl >= 0 ? styles.green : styles.red]}>
            {t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`}
          </Text>
        </View>
      ))}

      {mode === 'demo' && <TouchableOpacity
        accessibilityRole="button"
        style={styles.resetButton}
        disabled={resetting}
        onPress={async () => {
          if (resetting) return;
          setResetting(true);
          setResetError('');
          try {
            await resetToDemoTrades();
            await refresh();
          } catch {
            setResetError('Unable to refresh demo trades. Please try again.');
          } finally {
            setResetting(false);
          }
        }}
      >
        <Text style={styles.resetButtonText}>{resetting ? 'Refreshing…' : 'Refresh 30 Demo Trades (keeps your entries)'}</Text>
      </TouchableOpacity>}
      {resetError ? <Text accessibilityRole="alert" style={styles.red}>{resetError}</Text> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d1117', padding: 16 },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  filterBtn: { flex: 1, paddingVertical: 8, backgroundColor: '#161b22', borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: '#30363d' },
  filterBtnActive: { backgroundColor: '#1f6feb', borderColor: '#58a6ff' },
  filterText: { color: '#8b949e', fontWeight: '600', fontSize: 13 },
  filterTextActive: { color: '#ffffff' },
  heroCard: { backgroundColor: '#161b22', padding: 20, borderRadius: 12, marginBottom: 14, borderWidth: 1, borderColor: '#30363d' },
  heroLabel: { color: '#8b949e', fontSize: 13, textTransform: 'uppercase' },
  heroValue: { fontSize: 34, fontWeight: 'bold', marginVertical: 6 },
  subLabel: { color: '#8b949e', fontSize: 13 },
  grid: { flexDirection: 'row', gap: 12, marginBottom: 14 },
  statCard: { flex: 1, backgroundColor: '#161b22', padding: 16, borderRadius: 10, borderWidth: 1, borderColor: '#30363d' },
  statLabel: { color: '#8b949e', fontSize: 12 },
  statValue: { color: '#f0f6fc', fontSize: 22, fontWeight: 'bold', marginTop: 4 },
  sectionCard: { backgroundColor: '#161b22', padding: 16, borderRadius: 10, marginBottom: 14, borderWidth: 1, borderColor: '#30363d' },
  sectionTitle: { color: '#f0f6fc', fontSize: 15, fontWeight: 'bold', marginBottom: 12 },
  chartRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 115, paddingTop: 10 },
  barColumn: { alignItems: 'center', flex: 1 },
  bar: { width: 16, borderRadius: 4 },
  barLabel: { color: '#8b949e', fontSize: 10, marginTop: 6 },
  goalText: { color: '#c9d1d9', fontSize: 13, marginBottom: 6 },
  progressTrack: { height: 8, backgroundColor: '#21262d', borderRadius: 4, marginBottom: 12, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: '#58a6ff', borderRadius: 4 },
  sectionHeader: { color: '#f0f6fc', fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
  tradeRow: { gap: 10, flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#161b22', padding: 14, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#30363d' },
  tradeTitle: { color: '#f0f6fc', fontWeight: '600', fontSize: 14 },
  tradeMeta: { color: '#8b949e', fontSize: 12, marginTop: 2 },
  tradePnl: { fontSize: 15, fontWeight: 'bold' },
  green: { color: '#3fb950' },
  red: { color: '#f85149' },
  resetButton: { marginVertical: 24, padding: 14, borderRadius: 8, backgroundColor: '#21262d', alignItems: 'center', borderWidth: 1, borderColor: '#30363d' },
  resetButtonText: { color: '#58a6ff', fontWeight: '600', fontSize: 13 },
});
