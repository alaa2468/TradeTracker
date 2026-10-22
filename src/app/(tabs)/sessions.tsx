import React, { useRef, useState } from 'react';
import { FlatList, Text, View } from 'react-native';
import { router } from 'expo-router';
import { endSession, startSession } from '@/db/database';
import { useTrades } from '@/hooks/useTrades';
import { useNow } from '@/hooks/useNow';
import { Button, Metrics, SessionCard, ui } from '@/components/TradingUI';
import { duration, sessionSeconds } from '@/utils/statistics';

export default function SessionsScreen() {
  const { sessions, trades, mode, setMode, refresh, loading } = useTrades();
  const active = sessions.find(session => session.status === 'active');
  const now = useNow(!!active);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const history = sessions.filter(session => session.status === 'completed');

  const act = async (end: boolean) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    try {
      if (end && active) await endSession(active.id);
      else if (!end) await startSession();
      setConfirmEnd(false);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save the session. Try again.');
    } finally { lock.current = false; setBusy(false); }
  };

  return <FlatList style={ui.page} contentContainerStyle={ui.content} data={mode === 'real' ? history : []}
    keyExtractor={session => String(session.id)}
    ListHeaderComponent={<View style={{ gap: 14 }}>
      <Text style={ui.title}>Your personal trading sessions</Text>
      <Text style={ui.muted}>Start when you trade. End when you finish. Sessions stay active until you end them, even if you close the app.</Text>
      {mode === 'demo' ? <View style={ui.card}>
        <Text style={ui.text}>Demo trades have no personal sessions. Your saved sessions are in My trades.</Text>
        <Button title="Switch to My trades" onPress={() => setMode('real')} />
      </View> : <View style={ui.card}>
        {active ? <>
          <Text style={[ui.title, ui.green]}>Session #{active.id} · ACTIVE</Text>
          <Text style={ui.muted}>Started {new Date(active.start_time).toLocaleString()}</Text>
          <Text style={ui.value}>{duration(sessionSeconds(active, now))}</Text>
          <Metrics trades={trades.filter(trade => trade.session_id === active.id)} />
          <Button title="Log a trade" secondary onPress={() => router.navigate('/journal')} />
          {confirmEnd ? <>
            <Text style={ui.text}>End Session #{active.id} now? Its trades and history will be saved.</Text>
            <Button title={busy ? 'Ending…' : 'Confirm End Session'} danger disabled={busy} onPress={() => void act(true)} />
            <Button title="Keep session active" secondary disabled={busy} onPress={() => setConfirmEnd(false)} />
          </> : <Button title="End Session" danger disabled={busy} onPress={() => setConfirmEnd(true)} />}
        </> : <>
          <Text style={ui.title}>Ready to trade?</Text>
          <Text style={ui.muted}>Start a session to group your trades and track your time.</Text>
          <Button title={busy ? 'Starting…' : 'Start Session'} disabled={busy || loading} onPress={() => void act(false)} />
        </>}
      </View>}
      {error ? <Text accessibilityRole="alert" style={ui.red}>{error}</Text> : null}
      {mode === 'real' && <Text style={ui.title}>Session history</Text>}
    </View>}
    renderItem={({ item }) => <SessionCard session={item} trades={trades} now={now} />}
    ListEmptyComponent={mode === 'real' ? <Text style={ui.muted}>{loading ? 'Loading sessions…' : 'Completed sessions will appear here. Tap a session to see all its trades.'}</Text> : undefined}
  />;
}
