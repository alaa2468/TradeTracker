import { belongsToSession } from '@/utils/trades';
import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAllTrades, Trade } from '@/db/database';

const SESSIONS = [
    { name: 'Sydney', utcOpen: 22, utcClose: 7 },
    { name: 'Tokyo', utcOpen: 0, utcClose: 9 },
    { name: 'London', utcOpen: 8, utcClose: 17 },
    { name: 'New York', utcOpen: 13, utcClose: 22 },
];

export default function SessionsScreen() {
    const [now, setNow] = useState(new Date());
    const [trades, setTrades] = useState<Trade[]>([]);

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useFocusEffect(
        useCallback(() => {
            setTrades(getAllTrades());
        }, [])
    );

    const utcHour = now.getUTCHours();
    const utcMin = now.getUTCMinutes();
    const utcSec = now.getUTCSeconds();

    const isSessionOpen = (open: number, close: number) => {
        return open > close
            ? utcHour >= open || utcHour < close
            : utcHour >= open && utcHour < close;
    };

    const londonNewYorkOverlap = utcHour >= 13 && utcHour < 17;
    const sydneyTokyoOverlap = utcHour >= 0 && utcHour < 7;

    return (
        <ScrollView style={styles.container}>
            <View style={styles.clockCard}>
                <Text style={styles.clockLabel}>Session Reference Clock (UTC)</Text>
                <Text style={styles.clockTime}>
                    {String(utcHour).padStart(2, '0')}:{String(utcMin).padStart(2, '0')}:{String(utcSec).padStart(2, '0')} UTC
                </Text>
                <Text style={styles.localTime}>Local Device Time: {now.toLocaleTimeString()}</Text>
            </View>

            <View style={styles.overlapBanner}>
                <Text style={styles.overlapTitle}>Reference Overlap Window</Text>
                <Text style={styles.overlapDesc}>
                    {londonNewYorkOverlap
                        ? 'London + New York reference overlap (13:00 - 17:00 UTC)'
                        : sydneyTokyoOverlap
                            ? 'Sydney + Tokyo reference overlap (00:00 - 07:00 UTC)'
                            : 'Outside the listed reference overlap windows. London + New York reference overlap: 13:00 - 17:00 UTC.'}
                </Text>
            </View>

            <Text style={styles.sectionHeader}>Forex Trading Sessions</Text>
            <Text style={styles.scheduleText}>Fixed UTC reference schedule; daylight saving and weekend market closures are not reflected.</Text>
            {SESSIONS.map((s) => {
                const open = isSessionOpen(s.utcOpen, s.utcClose);
                const targetHour = open ? s.utcClose : s.utcOpen;
                const secondsLeft = (targetHour * 3600 - (utcHour * 3600 + utcMin * 60 + utcSec) + 86400) % 86400;
                const minutesLeft = Math.ceil(secondsLeft / 60);
                const hoursLeft = Math.floor(minutesLeft / 60);


                const sessionTrades = trades.filter((t) => belongsToSession(t.session, s.name));
                const sessionPnl = sessionTrades.reduce((sum, t) => sum + t.pnl, 0);
                const sessionWins = sessionTrades.filter((t) => t.pnl > 0).length;
                const winRate = sessionTrades.length > 0 ? Math.round((sessionWins / sessionTrades.length) * 100) : 0;

                return (
                    <View key={s.name} style={styles.card}>
                        <View style={styles.rowBetween}>
                            <Text style={styles.sessionName}>{s.name} Session</Text>
                            <Text style={[styles.badge, open ? styles.badgeOpen : styles.badgeClosed]}>
                                {open ? 'IN WINDOW' : 'OUTSIDE WINDOW'}
                            </Text>
                        </View>
                        <Text style={styles.scheduleText}>
                            Reference Hours: {String(s.utcOpen).padStart(2, '0')}:00 - {String(s.utcClose).padStart(2, '0')}:00 UTC
                        </Text>
                        <Text style={styles.countdownText}>
                            {open ? `Closes in ~${hoursLeft}h ${minutesLeft % 60}m` : `Opens in ~${hoursLeft}h ${minutesLeft % 60}m`}
                        </Text>

                        <View style={styles.metricsBar}>
                            <Text style={styles.metricItem}>Trades: {sessionTrades.length}</Text>
                            <Text style={styles.metricItem}>Win Rate: {winRate}%</Text>
                            <Text style={[styles.metricItem, sessionPnl >= 0 ? styles.green : styles.red]}>
                                PnL: {sessionPnl >= 0 ? `+$${sessionPnl.toFixed(0)}` : `-$${Math.abs(sessionPnl).toFixed(0)}`}
                            </Text>
                        </View>
                    </View>
                );
            })}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0d1117', padding: 16 },
    clockCard: { backgroundColor: '#161b22', padding: 18, borderRadius: 12, marginBottom: 14, borderWidth: 1, borderColor: '#30363d' },
    clockLabel: { color: '#8b949e', fontSize: 12, textTransform: 'uppercase' },
    clockTime: { color: '#58a6ff', fontSize: 32, fontWeight: 'bold', marginVertical: 4 },
    localTime: { color: '#c9d1d9', fontSize: 13 },
    overlapBanner: { backgroundColor: '#1c2128', padding: 14, borderRadius: 10, marginBottom: 16, borderLeftWidth: 4, borderLeftColor: '#a371f7' },
    overlapTitle: { color: '#d2a8ff', fontWeight: 'bold', fontSize: 14, marginBottom: 4 },
    overlapDesc: { color: '#c9d1d9', fontSize: 13 },
    sectionHeader: { color: '#f0f6fc', fontSize: 16, fontWeight: 'bold', marginBottom: 10 },
    card: { backgroundColor: '#161b22', padding: 16, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#30363d' },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    sessionName: { color: '#f0f6fc', fontSize: 17, fontWeight: 'bold' },
    badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, fontSize: 11, fontWeight: 'bold' },
    badgeOpen: { backgroundColor: '#238636', color: '#ffffff' },
    badgeClosed: { backgroundColor: '#30363d', color: '#8b949e' },
    scheduleText: { color: '#8b949e', fontSize: 13, marginTop: 6 },
    countdownText: { color: '#58a6ff', fontSize: 13, fontWeight: '600', marginTop: 4 },
    metricsBar: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#21262d' },
    metricItem: { color: '#c9d1d9', fontSize: 12, fontWeight: '600' },
    green: { color: '#3fb950' },
    red: { color: '#f85149' },
});