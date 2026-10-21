import { localDateKey } from '@/utils/trades';
import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAllTrades, resetToDemoTrades, Trade } from '@/db/database';

export default function HomeScreen() {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [timeframe, setTimeframe] = useState<'ALL' | 'WEEK' | 'MONTH'>('ALL');

  const loadData = useCallback(() => {
    const all = getAllTrades();
    setTrades(all);
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const filteredTrades = trades.filter((t) => {
    if (timeframe === 'ALL') return true;
    const days = timeframe === 'WEEK' ? 7 : 30;
    const cutoff = localDateKey(new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate() - days + 1));
    return t.tradeDate >= cutoff && t.tradeDate <= localDateKey();
  });

  const totalPnl = filteredTrades.reduce((sum, t) => sum + t.pnl, 0);
  const wins = filteredTrades.filter((t) => t.pnl > 0);
  const losses = filteredTrades.filter((t) => t.pnl < 0);
  const winRate = filteredTrades.length > 0 ? Math.round((wins.length / filteredTrades.length) * 100) : 0;
  const totalMinutes = filteredTrades.reduce((sum, t) => sum + t.durationMinutes, 0);

  const todayTrades = trades.filter((trade) => trade.tradeDate === localDateKey()).length;
  const noted = filteredTrades.filter((trade) => (trade.notes ?? '').trim().length > 0).length;
  const notesRate = filteredTrades.length ? Math.round(noted / filteredTrades.length * 100) : 0;

  const recentTen = [...filteredTrades].slice(0, 10).reverse();
  const maxAbsPnl = Math.max(...recentTen.map((t) => Math.abs(t.pnl)), 100);

  return (
    <ScrollView style={styles.container}>
      <View style={styles.filterRow}>
        {(['ALL', 'MONTH', 'WEEK'] as const).map((tf) => (
          <TouchableOpacity
            key={tf}
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
          {filteredTrades.length} Trades | {(totalMinutes / 60).toFixed(1)} hrs Market Time
        </Text>
      </View>

      <View style={styles.grid}>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Win Rate</Text>
          <Text style={styles.statValue}>{winRate}%</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statLabel}>Wins / Losses</Text>
          <Text style={styles.statValue}>
            <Text style={styles.green}>{wins.length}W</Text> / <Text style={styles.red}>{losses.length}L</Text>
          </Text>
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Last 10 Trades PnL Distribution</Text>
        <View style={styles.chartRow}>
          {recentTen.map((t) => {
            const barHeight = Math.max(12, Math.round((Math.abs(t.pnl) / maxAbsPnl) * 90));
            return (
              <View key={t.id} style={styles.barColumn}>
                <View
                  style={[
                    styles.bar,
                    { height: barHeight, backgroundColor: t.pnl >= 0 ? '#2ea043' : '#da3633' },
                  ]}
                />
                <Text style={styles.barLabel}>{t.instrument.slice(0, 3)}</Text>
              </View>
            );
          })}
        </View>
      </View>

      <View style={styles.sectionCard}>
        <Text style={styles.sectionTitle}>Personal Discipline Goals</Text>
        <Text style={styles.goalText}>Daily Trade Limit: {todayTrades} / 3 ({todayTrades <= 3 ? 'Within limit' : 'Exceeded'})</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.min(todayTrades / 3 * 100, 100)}%` }]} />
        </View>
        <Text style={styles.goalText}>Trades With Notes: {notesRate}%</Text>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${notesRate}%`, backgroundColor: '#2ea043' }]} />
        </View>
      </View>

      <Text style={styles.sectionHeader}>Recent Trades</Text>
      {filteredTrades.slice(0, 5).map((t) => (
        <View key={t.id} style={styles.tradeRow}>
          <View>
            <Text style={styles.tradeTitle}>
              {t.instrument} ({t.direction}) {t.isDemo ? '[DEMO]' : ''}
            </Text>
            <Text style={styles.tradeMeta}>
              {t.tradeDate} | {t.session} | Mood: {t.emotion}
            </Text>
          </View>
          <Text style={[styles.tradePnl, t.pnl >= 0 ? styles.green : styles.red]}>
            {t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`}
          </Text>
        </View>
      ))}

      <TouchableOpacity
        style={styles.resetButton}
        onPress={() => {
          resetToDemoTrades();
          loadData();
        }}
      >
        <Text style={styles.resetButtonText}>Refresh 30 Demo Trades (keeps your entries)</Text>
      </TouchableOpacity>
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
  tradeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#161b22', padding: 14, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#30363d' },
  tradeTitle: { color: '#f0f6fc', fontWeight: '600', fontSize: 14 },
  tradeMeta: { color: '#8b949e', fontSize: 12, marginTop: 2 },
  tradePnl: { fontSize: 15, fontWeight: 'bold' },
  green: { color: '#3fb950' },
  red: { color: '#f85149' },
  resetButton: { marginVertical: 24, padding: 14, borderRadius: 8, backgroundColor: '#21262d', alignItems: 'center', borderWidth: 1, borderColor: '#30363d' },
  resetButtonText: { color: '#58a6ff', fontWeight: '600', fontSize: 13 },
});