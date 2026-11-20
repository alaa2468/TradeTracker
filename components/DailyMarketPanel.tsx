import React from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Button, ui } from './TradingUI';
import { AnalysisPanel } from './AnalysisPanel';
import { useReferenceMarket } from '@/hooks/useReferenceMarket';
import { useNow } from '@/hooks/useNow';
import { FOREX_PAIRS, pairMetadata, referenceIsStale, type ReferenceHistory } from '@/services/referenceMarkets';

const format = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 6 });
function DailyChart({ history, currency }: { history: ReferenceHistory; currency: string }) {
  const points = history.points;
  const min = Math.min(...points.map(p => p.value)), max = Math.max(...points.map(p => p.value));
  const label = history.kind === 'daily-average' ? 'daily averages' : 'daily reference rates';
  return <View style={{ gap: 8 }}>
    <Text style={ui.text}>{points.length} {label} · {currency}</Text>
    <Text style={ui.muted}>Top of scale: {format(max)} {currency}</Text>
    <View accessible accessibilityLabel={`${label} chart, ${points[0].date} to ${points[points.length - 1].date}, minimum ${format(min)}, maximum ${format(max)} ${currency}`}
      style={{ flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 2, borderBottomWidth: 1, borderColor: '#30363d' }}>
      {points.map(point => <View key={point.date} style={{ flex: 1, height: max === min ? 70 : 4 + (point.value - min) / (max - min) * 132,
        backgroundColor: '#58a6ff', borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />)}
    </View>
    <Text style={ui.muted}>Bottom of scale: {format(min)} {currency}. Scale starts at the minimum, not zero.</Text>
    <Text style={ui.muted}>{points[0].date} → {points[points.length - 1].date} · UTC dates</Text>
    <Text style={ui.muted}>Bars represent available daily observations, not candlesticks. Missing days are omitted; horizontal spacing does not measure elapsed time. No hourly data is generated.</Text>
  </View>;
}
export function DailyMarketPanel({ category }: { category: 'Gold' | 'Forex' }) {
  const { pair, quote, history, quoteError, historyError, loading, retryAt, refresh, selectPair } = useReferenceMarket(category === 'Gold' ? 'XAU/USD' : 'EUR/USD');
  const now = useNow();
  const details = pairMetadata(pair);
  const seconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  const stale = quote && referenceIsStale(quote, now, quoteError);
  return <ScrollView style={ui.page} contentContainerStyle={ui.content}>
    <View style={ui.card}>
      <Text style={ui.title}>AI Trading Agent · {category}</Text>
      <Text style={ui.text}>{category === 'Gold' ? 'XAU/USD spot · USD per troy ounce (31.1035 grams). Spot snapshots refresh every 30 seconds while active.'
        : 'Daily reference rates · not live trading prices. Automatic refresh checks hourly while active; the source publishes daily.'}</Text>
      <Text style={ui.muted}>This app cannot place orders. Historical observations are displayed exactly as provided.</Text>
    </View>
    {category === 'Forex' && <View style={ui.card}>
      <Text style={ui.title}>Currency pair</Text>
      <View style={ui.actions}>{FOREX_PAIRS.map(value => <TouchableOpacity key={value} accessibilityRole="button"
        accessibilityState={{ selected: pair === value }} style={[ui.button, pair !== value && ui.secondary]} onPress={() => void selectPair(value)}>
        <Text style={ui.buttonText}>{value}</Text>
      </TouchableOpacity>)}</View>
    </View>}
    <View style={ui.card}>
      <View style={ui.row}><Text style={ui.title}>{pair}</Text>
        <Button secondary title={loading ? 'Refreshing…' : 'Refresh'} disabled={loading || seconds > 0} onPress={() => void refresh()} /></View>
      {details.derivation && <Text style={[ui.text, ui.blue]}>{details.derivation}. This is not an independently sourced quote.</Text>}
      <Text style={ui.muted}>{category === 'Gold' ? 'Current spot snapshot' : 'Latest daily reference rate'}</Text>
      <Text style={ui.value}>{quote ? `${format(quote.value)} ${details.currency}` : 'Price unavailable'}</Text>
      <Text style={ui.text}>For 1 {details.base}{category === 'Gold' ? ' (one troy ounce)' : ''}</Text>
      {loading && <ActivityIndicator accessibilityLabel="Fetching market observations" color="#58a6ff" />}
      {seconds > 0 && <Text style={ui.muted}>Refresh available in {seconds} seconds.</Text>}
      {quote && <>
        <Text style={ui.muted}>Source {quote.kind === 'spot' ? 'updated' : 'reference date'}: {quote.asOf}</Text>
        <Text style={ui.muted}>Last fetched: {new Date(quote.fetchedAt).toLocaleString()}</Text>
        <Text style={stale ? ui.red : ui.muted}>{stale ? 'Stale / unverified — last successful observation.'
          : category === 'Gold' ? 'Recently fetched spot snapshot; not a streaming feed.' : 'Daily reference observation. Weekends and holidays may retain an earlier date.'}</Text>
      </>}
      {quoteError && <Text accessibilityRole="alert" style={ui.red}>{quoteError}</Text>}
    </View>
    <View style={ui.card}>
      <Text style={ui.title}>{pair} · {category === 'Gold' ? 'Daily historical averages' : 'Daily reference history'}</Text>
      {history ? <>
        <Text style={ui.muted}>History fetched: {new Date(history.fetchedAt).toLocaleString()}</Text>
        {(historyError || now < history.fetchedAt || now - history.fetchedAt > 86400000
          || now - Date.parse(history.points[history.points.length - 1].date) > 5 * 86400000) && <Text style={ui.red}>Stale / unverified history — last successful observations.</Text>}
        <DailyChart history={history} currency={details.currency} />
      </> : <Text style={ui.muted}>{loading ? 'Loading daily history…' : 'Daily history unavailable. No replacement prices are generated.'}</Text>}
      {historyError && <Text accessibilityRole="alert" style={ui.red}>{historyError}</Text>}
      {category === 'Gold' && <Text style={ui.muted}>Completed UTC days only. Daily averages are distinct from spot prices and daily closes. History needs the optional backend’s free Gold API key; no key belongs in the mobile app.</Text>}
    </View>
    {category === 'Forex' && <AnalysisPanel key={pair} market={{ source: 'frankfurter', pair }} />}
    <Text style={ui.muted}>Source: {details.source}. All requests use public market data; your journal and coaching data remain on your device.</Text>
  </ScrollView>;
}
