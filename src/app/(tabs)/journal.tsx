import React, { useRef, useState } from 'react';
import { FlatList, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { deleteTradeById, type Trade } from '@/db/database';
import { useTrades } from '@/hooks/useTrades';
import { Button, DataSourceSwitch, TradeSummary, ui } from '@/components/TradingUI';
import { TradeEditor } from '@/components/TradeEditor';
import { tradeSessionLabel } from '@/utils/statistics';

export default function JournalScreen() {
  const { trades, sessions, mode, refresh, loading } = useTrades();
  const active = sessions.find(session => session.status === 'active');
  const [search, setSearch] = useState('');
  const [editor, setEditor] = useState<{ trade?: Trade } | null>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<number | null>(null);
  const deleteLock = useRef(false);
  const [error, setError] = useState('');
  const filtered = trades.filter(trade => [trade.instrument, tradeSessionLabel(trade), trade.strategy, trade.emotion, trade.notes ?? '', trade.session]
    .some(value => value.toLowerCase().includes(search.trim().toLowerCase())));

  const remove = async (id: number) => {
    if (deleteLock.current) return;
    deleteLock.current = true;
    setDeleting(id);
    setError('');
    try {
      await deleteTradeById(id);
      setPendingDelete(null);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to delete. Try again.'); }
    finally { deleteLock.current = false; setDeleting(null); }
  };

  return <View style={ui.page}>
    <FlatList contentContainerStyle={ui.content} data={filtered} keyExtractor={trade => String(trade.id)}
      keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={{ gap: 14 }}>
        <DataSourceSwitch />
        <View style={ui.card}>
          {mode === 'demo' ? <Text style={ui.muted}>Read-only examples. Switch to My trades to record your own results.</Text> : active ? <>
            <Text style={[ui.text, ui.green]}>Session #{active.id} is active</Text>
            <Button title="+ Log Trade" disabled={loading} onPress={() => setEditor({})} />
          </> : <>
            <Text style={ui.text}>Start a personal session before recording a new trade.</Text>
            <Button title="Go to Sessions" onPress={() => router.navigate('/sessions')} />
          </>}
        </View>
        <TextInput accessibilityLabel="Search trades" style={ui.input} placeholder="Search instrument, session, strategy, mood or notes"
          placeholderTextColor="#8b949e" value={search} onChangeText={setSearch} />
        <Text style={ui.title}>Trading journal · {filtered.length} entries</Text>
        {error ? <Text accessibilityRole="alert" style={ui.red}>{error}</Text> : null}
      </View>}
      renderItem={({ item }) => <View style={ui.card}>
        <TradeSummary trade={item} />
        {!item.isDemo && <>
          <View style={ui.actions}>
            <Button title={`Edit Trade #${item.id}`} secondary disabled={deleting !== null} onPress={() => setEditor({ trade: item })} />
            <Button title={pendingDelete === item.id ? 'Confirm Delete Entry' : `Delete Trade #${item.id}`} danger disabled={deleting !== null}
              onPress={() => { if (pendingDelete === item.id) void remove(item.id); else setPendingDelete(item.id); }} />
          </View>
          {pendingDelete === item.id && <>
            <Text style={ui.muted}>Delete this trade permanently? Its session will stay in your history.</Text>
            <Button title="Keep Entry" secondary disabled={deleting !== null} onPress={() => setPendingDelete(null)} />
          </>}
        </>}
      </View>}
      ListEmptyComponent={<Text style={ui.muted}>{loading ? 'Loading journal…' : search ? 'No trades match your search.' : 'No trades yet. Your saved entries will appear here.'}</Text>}
    />
    {editor && <TradeEditor trade={editor.trade} sessionId={active?.id} onClose={() => setEditor(null)}
      onSaved={async () => { await refresh(); setEditor(null); }} />}
  </View>;
}
