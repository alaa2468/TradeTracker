import React, { useRef, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { type CheckInInput, saveCoachSessionState } from '@/db/database';
import { useJournalData } from '@/hooks/JournalProvider';
import { useNow } from '@/hooks/useNow';
import { MOODS, sessionSignals, type Mood } from '@/utils/coach';
import { Button, ui } from './TradingUI';

export function CheckInForm({ title, onSave, onSkip, saveLabel = 'Save check-in' }: {
  title: string; onSave: (input: CheckInInput) => Promise<void>; onSkip: () => void; saveLabel?: string;
}) {
  const [mood, setMood] = useState<Mood | null>(null);
  const [stress, setStress] = useState<number | null>(null);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!mood || !stress || lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await onSave({ mood, stress, notes }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save check-in. Try again.'); }
    finally { lock.current = false; setBusy(false); }
  };
  return <View style={ui.card}>
    <Text style={ui.title}>{title}</Text>
    <Text style={ui.text}>How do you feel?</Text>
    <View style={ui.actions}>{MOODS.map(item => <Button key={item} title={`${mood === item ? '✓ ' : ''}${item}`}
      secondary={mood !== item} disabled={busy} onPress={() => setMood(item)} />)}</View>
    <Text style={ui.text}>Stress level · 1 relaxed, 5 very stressed</Text>
    <View style={ui.actions}>{[1, 2, 3, 4, 5].map(level => <Button key={level} title={`${stress === level ? '✓ ' : ''}${level}`}
      secondary={stress !== level} disabled={busy} onPress={() => setStress(level)} />)}</View>
    <TextInput accessibilityLabel="Optional check-in notes" style={ui.input} placeholder="Optional reflection (up to 1000 characters)"
      placeholderTextColor="#8b949e" multiline maxLength={1000} value={notes} editable={!busy} onChangeText={setNotes} />
    {error ? <Text accessibilityRole="alert" style={ui.red}>{error}</Text> : null}
    <Button title={busy ? 'Saving…' : saveLabel} disabled={busy || !mood || !stress} onPress={() => void save()} />
    <Button title="Skip for now" secondary disabled={busy} onPress={onSkip} />
  </View>;
}

export function ActiveCoachingCard() {
  const { trades, sessions, checkIns, coachPreferences, coachStates, mode, refresh } = useJournalData();
  const active = sessions.find(s => s.status === 'active');
  const now = useNow(mode === 'real' && !!active);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState('');
  if (mode !== 'real' || !active) return null;
  const signals = sessionSignals(trades, active, checkIns, coachPreferences, now, true);
  const key = signals.map(s => s.kind === 'duration' ? 'duration' : s.text).join('|');
  const state = coachStates.find(s => s.session_id === active.id);
  const remaining = state?.break_until ? Math.max(0, Math.ceil((Date.parse(state.break_until) - now) / 1000)) : null;
  const act = async (dismissed: string, until: string | null) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await saveCoachSessionState(active.id, dismissed, until); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to save. Try again.'); }
    finally { lock.current = false; setBusy(false); }
  };
  // A break survives navigation and app restarts; no background alarm is scheduled.
  if (remaining !== null) return <View style={ui.card}>
    <Text style={ui.title}>{remaining ? 'Take a moment away from the screen' : 'Your five-minute break has finished'}</Text>
    <Text accessibilityLiveRegion="polite" style={ui.value}>{Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, '0')}</Text>
    <Text style={ui.text}>Breathe, stretch, and check how you feel. The session stays active. The timer is a reminder, with no background notification.</Text>
    <Button title={remaining ? 'Finish break early' : 'Acknowledge break'} secondary disabled={busy}
      onPress={() => void act(key, null)} />
    {error ? <Text accessibilityRole="alert" style={ui.red}>{error}</Text> : null}
  </View>;
  if (!signals.length || state?.dismissed_key === key) return null;
  return <View style={[ui.card, { borderColor: '#58a6ff' }]}>
    <Text style={ui.title}>A moment to check in</Text>
    {signals.map(signal => <Text key={signal.kind} style={ui.text}>{signal.text}</Text>)}
    <Text style={ui.muted}>Local rules highlight possible patterns. Consider a five-minute break and reflect on your discipline.</Text>
    <Button title="Start a five-minute break" disabled={busy} onPress={() => void act(key, new Date(Date.now() + 5 * 60000).toISOString())} />
    <Button title="Dismiss these observations" secondary disabled={busy} onPress={() => void act(key, null)} />
    {error ? <Text accessibilityRole="alert" style={ui.red}>{error}</Text> : null}
  </View>;
}
