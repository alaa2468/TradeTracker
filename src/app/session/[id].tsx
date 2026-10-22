import React from 'react';
import { FlatList, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTrades } from '@/hooks/useTrades';
import { useNow } from '@/hooks/useNow';
import { Button, Metrics, TradeSummary, ui } from '@/components/TradingUI';
import { duration, sessionSeconds } from '@/utils/statistics';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sessions, trades, mode, setMode, loading } = useTrades();
  const session = sessions.find(item => String(item.id) === id);
  const now = useNow(session?.status === 'active');
  if (mode === 'demo') return <View style={[ui.page, ui.content]}>
    <Text style={ui.text}>Personal session details use your real trades.</Text>
    <Button title="Switch to My trades" onPress={() => setMode('real')} />
  </View>;
  if (!session) return <View style={[ui.page, ui.content]}>
    <Text style={ui.text}>{loading ? 'Loading session…' : 'Session not found.'}</Text>
    <Button title="Go to Sessions" onPress={() => router.navigate('/sessions')} />
  </View>;
  const entries = trades.filter(trade => trade.session_id === session.id);
  return <FlatList style={ui.page} contentContainerStyle={ui.content} data={entries}
    keyExtractor={trade => String(trade.id)}
    ListHeaderComponent={<View style={{ gap: 14 }}>
      <View style={ui.card}>
        <Text style={ui.title}>Session #{session.id} · {session.status === 'active' ? 'ACTIVE' : 'COMPLETED'}</Text>
        <Text style={ui.muted}>Start: {new Date(session.start_time).toLocaleString()}</Text>
        <Text style={ui.muted}>End: {session.end_time ? new Date(session.end_time).toLocaleString() : 'Still active · end manually in Sessions'}</Text>
        <Text style={ui.text}>Duration: {duration(sessionSeconds(session, now))}</Text>
        <Metrics trades={entries} />
      </View>
      <Button title="Open Journal to edit trades" secondary onPress={() => router.navigate('/journal')} />
      <Text style={ui.title}>Session trades</Text>
    </View>}
    renderItem={({ item }) => <View style={ui.card}><TradeSummary trade={item} /></View>}
    ListEmptyComponent={<Text style={ui.muted}>No trades recorded in this session.</Text>}
  />;
}
