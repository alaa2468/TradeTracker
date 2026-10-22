import { useTrades } from '@/hooks/useTrades';
import { useNow } from '@/hooks/useNow';
import { router } from 'expo-router';
import { Button, DataSourceSwitch, Metrics, PnlChart, SessionCard, TradeSummary, ui } from '@/components/TradingUI';
import { duration, tradingSeconds } from '@/utils/statistics';
import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';

export default function AnalyticsScreen() {
    const { trades, sessions, mode } = useTrades();
    const now = useNow(mode === 'real' && sessions.some(session => session.status === 'active'));



    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);

    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'N/A';

    const avgWin = wins.length > 0 ? (grossProfit / wins.length).toFixed(2) : '0.00';
    const avgLoss = losses.length > 0 ? (grossLoss / losses.length).toFixed(2) : '0.00';

    const emotions = ['Calm', 'Confident', 'Excited', 'Nervous', 'Stressed', 'Frustrated'];
    const instruments = [...new Set(trades.map(trade => trade.instrument))];

    return (
        <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={{ marginBottom: 16 }}><DataSourceSwitch /></View>
            <View style={ui.card}>
                <Text style={ui.title}>Overall performance</Text>
                <Metrics trades={trades} />
                <Text style={ui.text}>Trading time: {mode === 'real' ? duration(tradingSeconds(sessions, 'ALL', new Date(now))) : 'Unavailable for demo examples'}</Text>
                <Text style={ui.muted}>Win rate = wins ÷ all trades, including breakeven trades.</Text>
            </View>
            <View style={{ marginVertical: 16 }}><PnlChart trades={trades} /></View>
            {mode === 'real' && <View style={{ gap: 12, marginBottom: 18 }}>
                <Text style={styles.sectionHeader}>Performance per personal session</Text>
                {sessions.slice(0, 10).map(session => <SessionCard key={session.id} session={session} trades={trades} now={now} />)}
                {!sessions.length && <Text style={ui.muted}>Start a session to build your personal session history.</Text>}
                <Button title="View all sessions" secondary onPress={() => router.navigate('/sessions')} />
            </View>}
            <Text style={styles.sectionHeader}>Core Statistical Metrics</Text>
            <View style={styles.grid}>
                <View style={styles.metricBox}>
                    <Text style={styles.metricLabel}>Profit Factor</Text>
                    <Text style={styles.metricVal}>{profitFactor}</Text>
                    <Text style={styles.metricHint}>Ratio of gross profit to gross loss</Text>
                </View>
                <View style={styles.metricBox}>
                    <Text style={styles.metricLabel}>Avg Win vs Avg Loss</Text>
                    <Text style={styles.metricVal}>
                        <Text style={styles.green}>+${avgWin}</Text> / <Text style={styles.red}>-${avgLoss}</Text>
                    </Text>
                    <Text style={styles.metricHint}>Average recorded profit and loss</Text>
                </View>
            </View>

            <Text style={styles.sectionHeader}>Trading Psychology Analysis</Text>
            <View style={styles.card}>
                <Text style={styles.cardSubtitle}>Win Rate Correlation by Recorded Emotional State</Text>
                {emotions.map((em) => {
                    const subset = trades.filter((t) => t.emotion === em);
                    const emWins = subset.filter((t) => t.pnl > 0).length;
                    const rate = subset.length > 0 ? Math.round((emWins / subset.length) * 100) : 0;
                    const net = subset.reduce((s, t) => s + t.pnl, 0);

                    return (
                        <View key={em} style={styles.barGroup}>
                            <View style={styles.rowBetween}>
                                <Text style={styles.rowTitle}>
                                    {em} ({subset.length} trades)
                                </Text>
                                <Text style={[styles.rowTitle, net >= 0 ? styles.green : styles.red]}>
                                    {rate}% Win Rate ({net >= 0 ? `+$${net.toFixed(0)}` : `-$${Math.abs(net).toFixed(0)}`})
                                </Text>
                            </View>
                            <View style={styles.track}>
                                <View
                                    style={[
                                        styles.fill,
                                        { width: `${rate}%`, backgroundColor: rate >= 50 ? '#2ea043' : '#da3633' },
                                    ]}
                                />
                            </View>
                        </View>
                    );
                })}
            </View>

            <Text style={styles.sectionHeader}>Performance by Instrument</Text>
            <View style={styles.card}>
                {instruments.map((inst) => {
                    const subset = trades.filter((t) => t.instrument === inst);
                    const net = subset.reduce((s, t) => s + t.pnl, 0);
                    const winCount = subset.filter((t) => t.pnl > 0).length;
                    const rate = subset.length > 0 ? Math.round((winCount / subset.length) * 100) : 0;

                    return (
                        <View key={inst} style={styles.instRow}>
                            <View>
                                <Text style={styles.instName}>{inst}</Text>
                                <Text style={styles.instSub}>
                                    {subset.length} trades | {rate}% Win Rate
                                </Text>
                            </View>
                            <Text style={[styles.instPnl, net >= 0 ? styles.green : styles.red]}>
                                {net >= 0 ? `+$${net.toFixed(2)}` : `-$${Math.abs(net).toFixed(2)}`}
                            </Text>
                        </View>
                    );
                })}
            </View>
            <Text style={styles.sectionHeader}>Recent trading history</Text>
            <View style={{ gap: 12 }}>
                {trades.slice(0, 10).map(trade => <View key={trade.id} style={ui.card}><TradeSummary trade={trade} /></View>)}
                {!trades.length && <Text style={ui.muted}>No saved trades yet.</Text>}
                <Button title="View full journal" secondary onPress={() => router.navigate('/journal')} />
            </View>
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0d1117', padding: 16 },
    sectionHeader: { color: '#f0f6fc', fontSize: 16, fontWeight: 'bold', marginBottom: 10, marginTop: 4 },
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
    metricBox: { flex: 1, minWidth: 140, backgroundColor: '#161b22', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#30363d' },
    metricLabel: { color: '#8b949e', fontSize: 12 },
    metricVal: { color: '#f0f6fc', fontSize: 18, fontWeight: 'bold', marginVertical: 6 },
    metricHint: { color: '#8b949e', fontSize: 11 },
    card: { backgroundColor: '#161b22', padding: 16, borderRadius: 10, marginBottom: 18, borderWidth: 1, borderColor: '#30363d' },
    cardSubtitle: { color: '#8b949e', fontSize: 12, marginBottom: 12 },
    barGroup: { marginBottom: 12 },
    rowBetween: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'space-between', marginBottom: 4 },
    rowTitle: { color: '#c9d1d9', fontSize: 13, fontWeight: '600' },
    track: { height: 8, backgroundColor: '#21262d', borderRadius: 4, overflow: 'hidden' },
    fill: { height: '100%', borderRadius: 4 },
    instRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#21262d' },
    instName: { color: '#f0f6fc', fontWeight: 'bold', fontSize: 14 },
    instSub: { color: '#8b949e', fontSize: 12 },
    instPnl: { fontSize: 15, fontWeight: 'bold' },
    green: { color: '#3fb950' },
    red: { color: '#f85149' },
});