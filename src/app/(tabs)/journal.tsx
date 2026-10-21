import { localDateKey, parsePnl } from '@/utils/trades';
import React, { useState, useCallback } from 'react';
import {
    View,
    Text,
    StyleSheet,
    ScrollView,
    TextInput,
    TouchableOpacity,
    Modal,
    Platform,
} from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getAllTrades, insertTrade, deleteTradeById, Trade } from '@/db/database';

const INSTRUMENTS = ['XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'BTC/USD'];
const SESSIONS = ['London', 'New York', 'Tokyo', 'Sydney', 'London/NY Overlap'];
const EMOTIONS = ['Calm', 'Confident', 'Excited', 'Nervous', 'Stressed', 'Frustrated'];
const STRATEGIES = ['Breakout', 'Trend Following', 'Support/Resistance', 'Scalping'];

export default function JournalScreen() {
    const [trades, setTrades] = useState<Trade[]>([]);
    const [search, setSearch] = useState('');
    const [modalVisible, setModalVisible] = useState(false);

    const [instrument, setInstrument] = useState(INSTRUMENTS[0]);
    const [direction, setDirection] = useState<'BUY' | 'SELL'>('BUY');
    const [pnlInput, setPnlInput] = useState('');
    const [session, setSession] = useState(SESSIONS[0]);
    const [emotion, setEmotion] = useState(EMOTIONS[0]);
    const [strategy, setStrategy] = useState(STRATEGIES[0]);
    const [notes, setNotes] = useState('');
    const [saveError, setSaveError] = useState('');
    const [details, setDetails] = useState({ entryPrice: '', exitPrice: '', positionSize: '', durationMinutes: '' });
    const [pendingDelete, setPendingDelete] = useState<number | null>(null);

    const refresh = useCallback(() => {
        setTrades(getAllTrades());
    }, []);

    useFocusEffect(
        useCallback(() => {
            refresh();
        }, [refresh])
    );

    const handleSaveTrade = () => {
        const parsedPnl = parsePnl(pnlInput);
        if (parsedPnl === undefined) {
            setSaveError('Enter a valid profit or loss, such as 125 or -60.');
            return;
        }

        const entryPrice = parsePnl(details.entryPrice);
        const exitPrice = parsePnl(details.exitPrice);
        const positionSize = parsePnl(details.positionSize);
        const durationMinutes = parsePnl(details.durationMinutes);
        if (
            entryPrice === undefined || entryPrice <= 0 ||
            exitPrice === undefined || exitPrice <= 0 ||
            positionSize === undefined || positionSize <= 0 ||
            durationMinutes === undefined || durationMinutes < 0 || !Number.isInteger(durationMinutes)
        ) {
            setSaveError('Enter positive prices and position size, and a whole number of minutes (zero is allowed).');
            return;
        }
        try {
            insertTrade({
                instrument,
                direction,
                entryPrice,
                exitPrice,
                positionSize,
                pnl: parsedPnl,
                session,
                strategy,
                emotion,
                durationMinutes,
                tradeDate: localDateKey(),
                notes: notes.trim(),
                isDemo: 0,
            });

        } catch {
            setSaveError('Unable to save this trade. Please try again.');
            return;
        }
        setSaveError('');
        setPnlInput('');
        setDetails({ entryPrice: '', exitPrice: '', positionSize: '', durationMinutes: '' });
        setNotes('');
        setModalVisible(false);
        refresh();
    };

    const filtered = trades.filter(
        (t) =>
            t.instrument.toLowerCase().includes(search.toLowerCase()) ||
            t.session.toLowerCase().includes(search.toLowerCase()) ||
            t.emotion.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <View style={styles.container}>
            <View style={styles.topBar}>
                <TextInput
                    style={styles.searchInput}
                    placeholder="Filter by instrument, session, mood..."
                    placeholderTextColor="#8b949e"
                    value={search}
                    onChangeText={setSearch}
                />
                <TouchableOpacity style={styles.addBtn} onPress={() => setModalVisible(true)}>
                    <Text style={styles.addBtnText}>+ Log Trade</Text>
                </TouchableOpacity>
            </View>

            <ScrollView>
                {filtered.map((t) => (
                    <View key={t.id} style={styles.tradeCard}>
                        <View style={styles.rowBetween}>
                            <Text style={styles.instrumentText}>
                                {t.instrument} ({t.direction}) {t.isDemo ? '[DEMO]' : ''}
                            </Text>
                            <Text style={[styles.pnlText, t.pnl >= 0 ? styles.green : styles.red]}>
                                {t.pnl >= 0 ? `+$${t.pnl.toFixed(2)}` : `-$${Math.abs(t.pnl).toFixed(2)}`}
                            </Text>
                        </View>
                        <Text style={styles.metaText}>
                            Date: {t.tradeDate} | Session: {t.session} | Strategy: {t.strategy}
                        </Text>
                        <Text style={styles.emotionTag}>Psychology State: {t.emotion}</Text>
                        {t.notes ? <Text style={styles.notesText}>Note: {t.notes}</Text> : null}
                        <TouchableOpacity
                            style={styles.deleteLink}
                            onPress={() => {
                                if (pendingDelete !== t.id) {
                                    setPendingDelete(t.id);
                                    return;
                                }
                                deleteTradeById(t.id);
                                setPendingDelete(null);
                                refresh();
                            }}
                        >
                            <Text style={styles.deleteText}>{pendingDelete === t.id ? 'Confirm Delete Entry' : 'Delete Entry'}</Text>
                        </TouchableOpacity>
                        {pendingDelete === t.id ? <TouchableOpacity onPress={() => setPendingDelete(null)}><Text style={styles.metaText}>Keep Entry</Text></TouchableOpacity> : null}
                    </View>
                ))}
            </ScrollView>

            <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={() => setModalVisible(false)}>
                <View style={styles.modalOverlay}>
                    <ScrollView style={styles.modalContent}>
                        <Text style={styles.modalHeader}>Record New Trade</Text>

                        <Text style={styles.label}>Instrument</Text>
                        <View style={styles.chipRow}>
                            {INSTRUMENTS.map((item) => (
                                <TouchableOpacity
                                    key={item}
                                    style={[styles.chip, instrument === item && styles.chipActive]}
                                    onPress={() => setInstrument(item)}
                                >
                                    <Text style={styles.chipText}>{item}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={styles.label}>Direction</Text>
                        <View style={styles.chipRow}>
                            {(['BUY', 'SELL'] as const).map((dir) => (
                                <TouchableOpacity
                                    key={dir}
                                    style={[styles.chip, direction === dir && styles.chipActive]}
                                    onPress={() => setDirection(dir)}
                                >
                                    <Text style={styles.chipText}>{dir}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {([
                            ['entryPrice', 'Entry price'],
                            ['exitPrice', 'Exit price'],
                            ['positionSize', 'Position size'],
                            ['durationMinutes', 'Duration in minutes'],
                        ] as const).map(([key, label]) => (
                            <View key={key}>
                                <Text style={styles.label}>{label}</Text>
                                <TextInput
                                    accessibilityLabel={label}
                                    style={styles.input}
                                    keyboardType="decimal-pad"
                                    value={details[key]}
                                    onChangeText={(value) => { setDetails((previous) => ({ ...previous, [key]: value })); setSaveError(''); }}
                                />
                            </View>
                        ))}

                        <Text style={styles.label}>Profit / Loss (USD, use minus for loss)</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="e.g. 150.50 or -75.00"
                            placeholderTextColor="#8b949e"
                            keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'}
                            value={pnlInput}
                            onChangeText={(value) => { setPnlInput(value); setSaveError(''); }}
                        />

                        <Text style={styles.label}>Trading Session</Text>
                        <View style={styles.chipRow}>
                            {SESSIONS.map((s) => (
                                <TouchableOpacity
                                    key={s}
                                    style={[styles.chip, session === s && styles.chipActive]}
                                    onPress={() => setSession(s)}
                                >
                                    <Text style={styles.chipText}>{s}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={styles.label}>Emotional State (Trading Psychology)</Text>
                        <View style={styles.chipRow}>
                            {EMOTIONS.map((em) => (
                                <TouchableOpacity
                                    key={em}
                                    style={[styles.chip, emotion === em && styles.chipActive]}
                                    onPress={() => setEmotion(em)}
                                >
                                    <Text style={styles.chipText}>{em}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={styles.label}>Strategy</Text>
                        <View style={styles.chipRow}>
                            {STRATEGIES.map((st) => (
                                <TouchableOpacity
                                    key={st}
                                    style={[styles.chip, strategy === st && styles.chipActive]}
                                    onPress={() => setStrategy(st)}
                                >
                                    <Text style={styles.chipText}>{st}</Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        <Text style={styles.label}>Trade Notes</Text>
                        <TextInput
                            style={styles.input}
                            placeholder="Execution observations..."
                            placeholderTextColor="#8b949e"
                            value={notes}
                            onChangeText={setNotes}
                        />

                        {saveError ? <Text accessibilityRole="alert" style={styles.red}>{saveError}</Text> : null}
                        <View style={styles.modalActions}>
                            <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                                <Text style={styles.cancelText}>Cancel</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.saveBtn} onPress={handleSaveTrade}>
                                <Text style={styles.saveText}>Save Trade</Text>
                            </TouchableOpacity>
                        </View>
                    </ScrollView>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0d1117', padding: 16 },
    topBar: { flexDirection: 'row', gap: 10, marginBottom: 14 },
    searchInput: { flex: 1, backgroundColor: '#161b22', color: '#f0f6fc', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#30363d' },
    addBtn: { backgroundColor: '#238636', paddingHorizontal: 16, justifyContent: 'center', borderRadius: 8 },
    addBtnText: { color: '#ffffff', fontWeight: 'bold', fontSize: 13 },
    tradeCard: { backgroundColor: '#161b22', padding: 14, borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#30363d' },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    instrumentText: { color: '#f0f6fc', fontWeight: 'bold', fontSize: 15 },
    pnlText: { fontSize: 16, fontWeight: 'bold' },
    metaText: { color: '#8b949e', fontSize: 12, marginTop: 4 },
    emotionTag: { color: '#d2a8ff', fontSize: 12, marginTop: 4, fontWeight: '600' },
    notesText: { color: '#c9d1d9', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
    deleteLink: { marginTop: 8, alignSelf: 'flex-end' },
    deleteText: { color: '#f85149', fontSize: 12 },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.75)', justifyContent: 'center', padding: 16 },
    modalContent: { backgroundColor: '#161b22', borderRadius: 12, padding: 18, maxHeight: '90%' },
    modalHeader: { color: '#f0f6fc', fontSize: 18, fontWeight: 'bold', marginBottom: 12 },
    label: { color: '#8b949e', fontSize: 12, marginTop: 10, marginBottom: 6, textTransform: 'uppercase' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: { backgroundColor: '#21262d', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: '#30363d' },
    chipActive: { backgroundColor: '#1f6feb', borderColor: '#58a6ff' },
    chipText: { color: '#f0f6fc', fontSize: 12 },
    input: { backgroundColor: '#0d1117', color: '#f0f6fc', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#30363d' },
    modalActions: { flexDirection: 'row', gap: 12, marginTop: 20, marginBottom: 30 },
    cancelBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#30363d', alignItems: 'center' },
    cancelText: { color: '#f0f6fc', fontWeight: '600' },
    saveBtn: { flex: 1, padding: 12, borderRadius: 8, backgroundColor: '#238636', alignItems: 'center' },
    saveText: { color: '#ffffff', fontWeight: 'bold' },
    green: { color: '#3fb950' },
    red: { color: '#f85149' },
});