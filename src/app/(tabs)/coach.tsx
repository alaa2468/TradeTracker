import React, { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ActiveCoachingCard, CheckInForm } from '@/components/CoachUI';
import { Button, ui } from '@/components/TradingUI';
import { saveCoachPreferences, savePostSessionCheckIn } from '@/db/database';
import { useTrades } from '@/hooks/useTrades';
import { useNow } from '@/hooks/useNow';
import { DEFAULT_COACH_PREFERENCES, weeklyInsights, type CoachPreferences } from '@/utils/coach';
import { coachInsight } from '@/utils/trades';

function Preferences({ value, onSaved }: { value: CoachPreferences; onSaved: () => Promise<void> }) {
  const [draft, setDraft] = useState(() => Object.fromEntries(Object.entries(value).map(([key, v]) => [key, String(v)])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fields: [keyof CoachPreferences, string][] = [
    ['frequentTrades', 'Trade count (2–100)'], ['windowMinutes', 'Frequency window in minutes (1–240)'],
    ['consecutiveLosses', 'Consecutive losses (2–20)'], ['longSessionMinutes', 'Session minutes (15–720)'],
  ];
  const save = async (defaults = false) => {
    if (busy) return;
    setBusy(true); setError('');
    try {
      const next = defaults ? DEFAULT_COACH_PREFERENCES : Object.fromEntries(fields.map(([key]) => [key, Number(draft[key])])) as unknown as CoachPreferences;
      await saveCoachPreferences(next);
      setDraft(Object.fromEntries(Object.entries(next).map(([key, v]) => [key, String(v)])));
      await onSaved();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save preferences.'); }
    finally { setBusy(false); }
  };
  return <View style={ui.card}>
    <Text style={ui.title}>Your coaching thresholds</Text>
    <Text style={ui.muted}>Adjustable reminders for reflection. These thresholds do not establish whether a trade was appropriate.</Text>
    {fields.map(([key, label]) => <View key={key} style={{ gap: 6 }}>
      <Text style={ui.text}>{label}</Text>
      <TextInput accessibilityLabel={label} style={ui.input} keyboardType="number-pad" value={draft[key]} editable={!busy}
        onChangeText={text => setDraft(previous => ({ ...previous, [key]: text }))} />
    </View>)}
    {error ? <Text accessibilityRole="alert" style={ui.red}>{error}</Text> : null}
    <Button title={busy ? 'Saving…' : 'Save thresholds'} disabled={busy} onPress={() => void save()} />
    <Button title="Restore default thresholds" secondary disabled={busy} onPress={() => void save(true)} />
  </View>;
}

export default function TradingPsychologyCoachScreen() {
  const { trades, sessions, checkIns, coachPreferences, mode, setMode, refresh, loading } = useTrades();
  useNow(mode === 'real', 60000);
  const [postSession, setPostSession] = useState<number | null>(null);
  const [summary, setSummary] = useState('');
  const [settings, setSettings] = useState(false);
  const weekly = weeklyInsights(trades, sessions, checkIns, coachPreferences);
  const missing = sessions.filter(s => s.status === 'completed' && !checkIns.some(c => c.session_id === s.id && c.phase === 'after'));
  return <ScrollView style={ui.page} contentContainerStyle={ui.content} keyboardShouldPersistTaps="handled">
    <View style={[ui.card, { borderLeftWidth: 4, borderLeftColor: '#58a6ff' }]}>
      <Text style={ui.title}>Trading Psychology Coach</Text>
      <Text style={ui.text}>Build awareness of your feelings, habits, and discipline.</Text>
      <Text style={ui.muted}>Offline, rule-based coaching using your journal and check-ins. No AI model or external service is used. Your coaching data stays in this app’s SQLite database.</Text>
      <Text style={ui.muted}>Reflection and habit support only. No investment or buy/sell recommendations.</Text>
    </View>
    {loading ? <Text style={ui.muted}>Loading your coaching data…</Text> : mode === 'demo' ? <View style={ui.card}>
      <Text style={ui.text}>Personal coaching uses My trades. Demo examples are excluded from all coaching patterns and weekly insights.</Text>
      <Button title="Switch to My trades" onPress={() => { setSummary(''); setMode('real'); }} />
    </View> : <>
      <ActiveCoachingCard />
      <View style={ui.card}>
        <Text style={ui.title}>Session check-ins</Text>
        <Text style={ui.text}>Sessions asks how you feel before you start and after you finish. Both check-ins are optional.</Text>
        <Button title="Open Sessions" secondary onPress={() => router.navigate('/sessions')} />
        {missing.slice(0, 5).map(s => <Button key={s.id} title={`Reflect on Session #${s.id} · ${new Date(s.end_time!).toLocaleDateString()}`}
          secondary onPress={() => setPostSession(s.id)} />)}
        {missing.length > 5 && <Text style={ui.muted}>Open older sessions from Sessions to add their reflections.</Text>}
        {!sessions.length && <Text style={ui.muted}>Start your first session to build your coaching history.</Text>}
      </View>
      {postSession !== null && <CheckInForm key={postSession} title={`After Session #${postSession}: how do you feel?`}
        onSave={async input => { await savePostSessionCheckIn(postSession, input); setPostSession(null); await refresh(); }}
        onSkip={() => setPostSession(null)} />}
      <View style={ui.card}>
        <Text style={ui.title}>Your weekly habits</Text>
        <Text style={ui.muted}>{weekly.startKey} to {weekly.todayKey} · device local dates · updates as your journal changes</Text>
        {weekly.lines.map((line, i) => <Text key={i} style={ui.text}>{line}</Text>)}
        <Text style={[ui.text, { color: '#58a6ff' }]}>Discipline goal: {weekly.goal}</Text>
      </View>
      <View style={ui.card}>
        <Text style={ui.title}>Recorded journal observations</Text>
        <View style={ui.actions}>
          <Button title="Mood observations" secondary onPress={() => setSummary(coachInsight(trades, 'MOOD'))} />
          <Button title="Reflect on losses" secondary onPress={() => setSummary(coachInsight(trades, 'MISTAKES'))} />
        </View>
        {summary ? <Text style={ui.text}>{summary}</Text> : null}
      </View>
      <Button title={settings ? 'Hide coaching thresholds' : 'Adjust coaching thresholds'} secondary onPress={() => setSettings(!settings)} />
      {settings && <Preferences key={JSON.stringify(coachPreferences)} value={coachPreferences} onSaved={refresh} />}
      <Text style={ui.muted}>Trade timestamps describe recorded times. Session elapsed time includes time with the app closed. Missing times and feelings are never inferred. Observations may change when you edit or delete a trade.</Text>
    </>}
  </ScrollView>;
}
