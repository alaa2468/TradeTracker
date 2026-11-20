import React, { useState } from 'react';
import { CheckInForm } from '@/components/CoachUI';
import { savePostSessionCheckIn } from '@/db/database';
import { FlatList, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTrades } from '@/hooks/useTrades';
import { useNow } from '@/hooks/useNow';
import { Button, Metrics, TradeSummary, ui } from '@/components/TradingUI';
import { duration, sessionSeconds } from '@/utils/statistics';

export default function SessionDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { sessions, trades, checkIns, mode, setMode, loading, refresh } = useTrades();
  const [reflect, setReflect] = useState(false);
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
      {checkIns.filter(c => c.session_id === session.id).map(c => <View key={c.phase} style={ui.card}>
        <Text style={ui.title}>{c.phase === 'before' ? 'Before' : 'After'} session check-in</Text>
        <Text style={ui.text}>{c.mood} · stress {c.stress}/5</Text>
        {c.notes ? <Text style={ui.text}>{c.notes}</Text> : null}
        <Text style={ui.muted}>Recorded {new Date(c.recorded_at).toLocaleString()}</Text>
      </View>)}
      {session.status === 'completed' && !checkIns.some(c => c.session_id === session.id && c.phase === 'after') &&
        (reflect ? <CheckInForm title="After this session: how do you feel?" onSkip={() => setReflect(false)}
          onSave={async input => { await savePostSessionCheckIn(session.id, input); setReflect(false); await refresh(); }} />
          : <Button title="Add after-session reflection" secondary onPress={() => setReflect(true)} />)}
      <Button title="Open Journal to edit trades" secondary onPress={() => router.navigate('/journal')} />
      <Text style={ui.title}>Session trades</Text>
    </View>}
    renderItem={({ item }) => <View style={ui.card}><TradeSummary trade={item} /></View>}
    ListEmptyComponent={<Text style={ui.muted}>No trades recorded in this session.</Text>}
  />;
}
