import React from 'react';
import { Text, View } from 'react-native';
import type { QuoteCurrency } from '@/services/markets';
import type { MarketHistory } from '@/services/binance';
import { ui } from './TradingUI';

export const marketPrice = (value: number) => value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Native Views keep this small hourly chart dependency-free on iOS, Android and web.
export function MarketChart({ history, currency }: { history: MarketHistory; currency: QuoteCurrency }) {
  const candles = history.candles;
  const low = Math.min(...candles.map(c => c.close)), high = Math.max(...candles.map(c => c.close));
  const first = candles[0], last = candles[candles.length - 1];
  const change = (last.close - first.close) / first.close * 100;
  return <View style={{ gap: 8 }}>
    <Text style={ui.text}>{candles.length} hourly closing prices · {change >= 0 ? '+' : ''}{change.toFixed(2)}% first to latest</Text>
    <Text style={ui.muted}>Top of scale: {marketPrice(high)} {currency}</Text>
    <View accessible accessibilityLabel={`Hourly closing price chart. First ${marketPrice(first.close)}, latest ${marketPrice(last.close)}, minimum ${marketPrice(low)}, maximum ${marketPrice(high)} ${currency}.`}
      style={{ flexDirection: 'row', alignItems: 'flex-end', height: 140, gap: 3, borderBottomWidth: 1, borderColor: '#30363d' }}>
      {candles.map((candle, index) => <View key={candle.openTime} style={{ flex: 1,
        height: high === low ? 70 : 4 + (candle.close - low) / (high - low) * 132,
        backgroundColor: index === candles.length - 1 ? '#8b949e' : '#58a6ff', borderTopLeftRadius: 2, borderTopRightRadius: 2 }} />)}
    </View>
    <Text style={ui.muted}>Bottom of scale: {marketPrice(low)} {currency} · scale starts at the lowest close, not zero.</Text>
    <View style={ui.row}>
      <Text style={ui.muted}>{new Date(first.openTime).toLocaleString()}</Text>
      <Text style={ui.muted}>{new Date(last.openTime).toLocaleString()}</Text>
    </View>
    <Text style={ui.muted}>Times are candle starts in your device timezone. The gray latest hour may still be forming. This is a price history chart, not a trading signal.</Text>
  </View>;
}
