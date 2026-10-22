import React, { useRef, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { insertTrade, updateTrade, type Trade, type TradeInput } from '@/db/database';
import { localDateKey, parsePnl } from '@/utils/trades';
import { localDateTime, parseLocalDateTime, tradeSessionLabel } from '@/utils/statistics';
import { Button, ui } from './TradingUI';

const INSTRUMENTS = ['XAU/USD', 'EUR/USD', 'GBP/USD', 'USD/JPY', 'BTC/USD'];
const STRATEGIES = ['Breakout', 'Trend Following', 'Support/Resistance', 'Scalping', 'Mean Reversion'];
const EMOTIONS = ['Calm', 'Confident', 'Excited', 'Nervous', 'Stressed', 'Frustrated'];

function Choices({ values, selected, onSelect }: { values: readonly string[]; selected: string; onSelect: (value: string) => void }) {
  return <View style={ui.actions}>{values.map(value => <TouchableOpacity key={value} accessibilityRole="button"
    accessibilityState={{ selected: selected === value }} onPress={() => onSelect(value)}
    style={[ui.button, ui.secondary, { paddingHorizontal: 12 }, selected === value && { backgroundColor: '#1f6feb' }]}>
    <Text style={ui.buttonText}>{value}</Text>
  </TouchableOpacity>)}</View>;
}

export function TradeEditor({ trade, sessionId, onClose, onSaved }: {
  trade?: Trade; sessionId?: number; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const insets = useSafeAreaInsets();
  const initialTime = trade?.timestamp ? localDateTime(new Date(trade.timestamp)) : '';
  const [form, setForm] = useState({
    instrument: trade?.instrument ?? 'XAU/USD', direction: trade?.direction ?? 'BUY',
    entryPrice: trade ? String(trade.entryPrice) : '', exitPrice: trade ? String(trade.exitPrice) : '',
    positionSize: trade ? String(trade.positionSize) : '', pnl: trade ? String(trade.pnl) : '',
    timestamp: initialTime, strategy: trade?.strategy ?? 'Breakout', emotion: trade?.emotion ?? 'Calm',
    notes: trade?.notes ?? '', durationMinutes: trade ? String(trade.durationMinutes) : '',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const change = (key: keyof typeof form, value: string) => { setForm(previous => ({ ...previous, [key]: value })); setError(''); };

  const save = async () => {
    if (lock.current) return;
    const pnl = parsePnl(form.pnl);
    const entryPrice = parsePnl(form.entryPrice);
    const exitPrice = parsePnl(form.exitPrice);
    const positionSize = parsePnl(form.positionSize);
    const durationMinutes = form.durationMinutes.trim() ? parsePnl(form.durationMinutes) : 0;
    if (pnl === undefined) return setError('Enter a profit or loss, such as 125, -60 or 0.');
    if (entryPrice === undefined || entryPrice <= 0 || exitPrice === undefined || exitPrice <= 0
        || positionSize === undefined || positionSize <= 0) return setError('Entry price, exit price and position size must be positive numbers.');
    if (durationMinutes === undefined || !Number.isInteger(durationMinutes) || durationMinutes < 0) return setError('Trade duration must be a whole number of minutes, or left blank.');
    if (!form.instrument.trim() || !form.strategy.trim()) return setError('Enter an instrument and strategy.');
    let timestamp: string | null | undefined;
    if (trade && form.timestamp === initialTime) timestamp = trade.timestamp;
    else if (form.timestamp.trim()) {
      timestamp = parseLocalDateTime(form.timestamp);
      if (!timestamp) return setError('Use a valid local date and time: YYYY-MM-DD HH:mm:ss.');
    } else if (trade?.timestamp) return setError('This trade needs a date and time.');
    const input: TradeInput = {
      instrument: form.instrument.trim().toUpperCase(), direction: form.direction,
      entryPrice, exitPrice, positionSize, pnl, durationMinutes,
      session: trade?.session ?? '', strategy: form.strategy.trim(), emotion: form.emotion,
      tradeDate: trade?.tradeDate ?? localDateKey(), notes: form.notes.trim(), isDemo: 0, timestamp,
    };
    lock.current = true;
    setSaving(true);
    try {
      if (trade) await updateTrade(trade.id, input);
      else await insertTrade(input);
      await onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to save. Please try again.');
    } finally { lock.current = false; setSaving(false); }
  };

  const field = (key: keyof typeof form, label: string, numeric = false, placeholder?: string) => <View style={{ gap: 6 }}>
    <Text style={ui.muted}>{label}</Text>
    <TextInput accessibilityLabel={label} style={ui.input} value={form[key]} placeholder={placeholder}
      placeholderTextColor="#8b949e" autoCorrect={false}
      keyboardType={numeric ? 'decimal-pad' : 'default'} onChangeText={value => change(key, value)} />
  </View>;

  return <Modal visible animationType="slide" transparent onRequestClose={() => { if (!lock.current) onClose(); }}>
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.8)', justifyContent: 'center', paddingTop: Math.max(16, insets.top), paddingBottom: Math.max(16, insets.bottom), paddingHorizontal: 12 }}>
      <View style={{ width: '100%', maxWidth: 640, maxHeight: '100%', alignSelf: 'center', backgroundColor: '#161b22', borderRadius: 12 }}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 18, gap: 14 }}>
          <Text style={ui.title}>{trade ? 'Edit Trade' : 'Record New Trade'}</Text>
          <Text style={[ui.muted, ui.blue]}>{trade ? tradeSessionLabel(trade) : `Automatically saved to Session #${sessionId}`}</Text>
          {field('instrument', 'Instrument')}
          <Choices values={INSTRUMENTS} selected={form.instrument} onSelect={value => change('instrument', value)} />
          <Text style={ui.muted}>Direction</Text>
          <Choices values={['BUY', 'SELL']} selected={form.direction} onSelect={value => setForm(previous => ({ ...previous, direction: value as 'BUY' | 'SELL' }))} />
          {field('entryPrice', 'Entry price', true)}
          {field('exitPrice', 'Exit price', true)}
          {field('positionSize', 'Position size', true)}
          <Text style={ui.muted}>Profit / Loss (USD) · enter your result manually</Text>
          <TextInput accessibilityLabel="Profit / Loss" style={ui.input} value={form.pnl} placeholder="150.50 or -75.00"
            placeholderTextColor="#8b949e" keyboardType={Platform.OS === 'ios' ? 'numbers-and-punctuation' : 'numeric'} onChangeText={value => change('pnl', value)} />
          <Choices values={['Profit', 'Loss']} selected={form.pnl.startsWith('-') ? 'Loss' : 'Profit'}
            onSelect={value => change('pnl', (value === 'Loss' ? '-' : '') + form.pnl.replace(/^[+-]/, ''))} />
          {field('timestamp', 'Date and time (local)', false, trade ? 'Time not recorded for this legacy trade' : 'Leave blank to record the current time')}
          <Text style={ui.muted}>Format: YYYY-MM-DD HH:mm:ss. Session trades must fall within their session.</Text>
          {field('strategy', 'Strategy')}
          <Choices values={STRATEGIES} selected={form.strategy} onSelect={value => change('strategy', value)} />
          <Text style={ui.muted}>Emotional state</Text>
          <Choices values={EMOTIONS} selected={form.emotion} onSelect={value => change('emotion', value)} />
          {field('durationMinutes', 'Trade duration in minutes (optional)', true)}
          <Text style={ui.muted}>Total trading time comes from personal sessions. This optional trade detail does not change it.</Text>
          <Text style={ui.muted}>Notes (optional)</Text>
          <TextInput accessibilityLabel="Notes" style={[ui.input, { minHeight: 90, textAlignVertical: 'top' }]} multiline
            value={form.notes} onChangeText={value => change('notes', value)} />
          {error ? <Text accessibilityRole="alert" style={ui.red}>{error}</Text> : null}
          <Button title={saving ? 'Saving…' : 'Save Trade'} disabled={saving} onPress={() => void save()} />
          <Button title="Cancel" secondary disabled={saving} onPress={onClose} />
        </ScrollView>
      </View>
    </KeyboardAvoidingView>
  </Modal>;
}
