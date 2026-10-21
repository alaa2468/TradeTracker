import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAllTrades, Trade } from '@/db/database';

export default function AnalyticsScreen() {
    const [trades, setTrades] = useState<Trade[]>([]);

    useFocusEffect(
        useCallback(() => {
            setTrades(getAllTrades());
        }, [])
    );

    const wins = trades.filter((t) => t.pnl > 0);
    const losses = trades.filter((t) => t.pnl < 0);

    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? (grossProfit / grossLoss).toFixed(2) : 'N/A';

    const avgWin = wins.length > 0 ? (grossProfit / wins.length).toFixed(2) : '0.00';
    const avgLoss = losses.length > 0 ? (grossLoss / losses.length).toFixed(2) : '0.00';

    const emotions = ['Calm', 'Confident', 'Excited', 'Nervous', 'Stressed', 'Frustrated'];
    const instruments = ['XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'BTC/USD'];

    return (
        <ScrollView style={styles.container}>
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
                    <Text style={styles.metricHint}>Risk-to-reward execution ratio</Text>
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
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0d1117', padding: 16 },
    sectionHeader: { color: '#f0f6fc', fontSize: 16, fontWeight: 'bold', marginBottom: 10, marginTop: 4 },
    grid: { flexDirection: 'row', gap: 12, marginBottom: 16 },
    metricBox: { flex: 1, backgroundColor: '#161b22', padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#30363d' },
    metricLabel: { color: '#8b949e', fontSize: 12 },
    metricVal: { color: '#f0f6fc', fontSize: 18, fontWeight: 'bold', marginVertical: 6 },
    metricHint: { color: '#8b949e', fontSize: 11 },
    card: { backgroundColor: '#161b22', padding: 16, borderRadius: 10, marginBottom: 18, borderWidth: 1, borderColor: '#30363d' },
    cardSubtitle: { color: '#8b949e', fontSize: 12, marginBottom: 12 },
    barGroup: { marginBottom: 12 },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
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