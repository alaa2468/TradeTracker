import { useTrades } from '@/hooks/useTrades';
import { coachInsight, questionKind } from '@/utils/trades';
import React, { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput } from 'react-native';

export default function AICoachScreen() {
    const { trades } = useTrades();
    const [chatHistory, setChatHistory] = useState<{ sender: 'USER' | 'AI'; text: string }[]>([]);
    const [question, setQuestion] = useState('');



    const generateDataDrivenInsight = (kind: string) => coachInsight(trades, kind);

    const handleAskQuestion = (promptText: string, typeKey: string) => {
        const reply = typeKey === 'UNSUPPORTED' ? 'This local coach supports session, mood, loss, and overall performance summaries. Choose one of the prompts above.' : generateDataDrivenInsight(typeKey);
        setChatHistory((prev) => [
            { sender: 'AI', text: reply },
            { sender: 'USER', text: promptText },
            ...prev,
        ]);
    };

    return (
        <ScrollView style={styles.container}>
            <View style={styles.banner}>
                <Text style={styles.bannerTitle}>Journal Coach</Text>
                <Text style={styles.bannerSub}>
                    Summarizes recorded results using local rules. Demo entries are included and observations do not predict future performance.
                </Text>
            </View>

            <Text style={styles.sectionHeader}>Automated Journal Observations</Text>
            <View style={styles.insightCard}>
                <Text style={styles.insightBullet}>
                    1. {generateDataDrivenInsight('MOOD')}
                </Text>
                <Text style={styles.insightBullet}>
                    2. {generateDataDrivenInsight('SESSION')}
                </Text>
            </View>

            <Text style={styles.sectionHeader}>Ask Your Journal Coach</Text>
            <View style={styles.promptGrid}>
                <TouchableOpacity
                    style={styles.promptChip}
                    onPress={() => handleAskQuestion('Which trading session had my best results?', 'SESSION')}
                >
                    <Text style={styles.promptChipText}>Which session had my best results?</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.promptChip}
                    onPress={() => handleAskQuestion('How does my mood relate to my performance?', 'MOOD')}
                >
                    <Text style={styles.promptChipText}>How does my mood affect my PnL?</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.promptChip}
                    onPress={() => handleAskQuestion('What trading mistakes do I repeat?', 'MISTAKES')}
                >
                    <Text style={styles.promptChipText}>What mistakes do I repeat?</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    style={styles.promptChip}
                    onPress={() => handleAskQuestion('Summarize my overall performance.', 'SUMMARY')}
                >
                    <Text style={styles.promptChipText}>Summarize my overall performance</Text>
                </TouchableOpacity>
            </View>

            <View style={styles.customAskRow}>
                <TextInput
                    style={styles.input}
                    placeholder="Ask a custom question about your journal..."
                    placeholderTextColor="#8b949e"
                    value={question}
                    onChangeText={setQuestion}
                />
                <TouchableOpacity
                    style={styles.sendBtn}
                    onPress={() => {
                        if (!question.trim()) return;
                        handleAskQuestion(question.trim(), questionKind(question) ?? 'UNSUPPORTED');
                        setQuestion('');
                    }}
                >
                    <Text style={styles.sendBtnText}>Ask</Text>
                </TouchableOpacity>
            </View>

            {chatHistory.map((item, idx) => (
                <View
                    key={idx}
                    style={[styles.chatBubble, item.sender === 'USER' ? styles.userBubble : styles.aiBubble]}
                >
                    <Text style={styles.chatSender}>{item.sender === 'USER' ? 'You' : 'TradeTrack Journal Coach'}</Text>
                    <Text style={styles.chatText}>{item.text}</Text>
                </View>
            ))}
        </ScrollView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#0d1117', padding: 16 },
    banner: { backgroundColor: '#161b22', padding: 16, borderRadius: 10, marginBottom: 14, borderLeftWidth: 4, borderLeftColor: '#58a6ff' },
    bannerTitle: { color: '#f0f6fc', fontSize: 16, fontWeight: 'bold' },
    bannerSub: { color: '#8b949e', fontSize: 12, marginTop: 4 },
    sectionHeader: { color: '#f0f6fc', fontSize: 15, fontWeight: 'bold', marginBottom: 8 },
    insightCard: { backgroundColor: '#161b22', padding: 14, borderRadius: 10, marginBottom: 16, borderWidth: 1, borderColor: '#30363d' },
    insightBullet: { color: '#c9d1d9', fontSize: 13, marginBottom: 10, lineHeight: 19 },
    promptGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 },
    promptChip: { backgroundColor: '#1f6feb', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
    promptChipText: { color: '#ffffff', fontSize: 12, fontWeight: '600' },
    customAskRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
    input: { flex: 1, backgroundColor: '#161b22', color: '#f0f6fc', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#30363d' },
    sendBtn: { backgroundColor: '#238636', paddingHorizontal: 18, justifyContent: 'center', borderRadius: 8 },
    sendBtnText: { color: '#ffffff', fontWeight: 'bold' },
    chatBubble: { padding: 14, borderRadius: 10, marginBottom: 10 },
    userBubble: { backgroundColor: '#21262d', alignSelf: 'flex-end', width: '85%' },
    aiBubble: { backgroundColor: '#161b22', borderWidth: 1, borderColor: '#58a6ff', alignSelf: 'flex-start', width: '92%' },
    chatSender: { color: '#58a6ff', fontSize: 11, fontWeight: 'bold', marginBottom: 4 },
    chatText: { color: '#f0f6fc', fontSize: 13, lineHeight: 18 },
});