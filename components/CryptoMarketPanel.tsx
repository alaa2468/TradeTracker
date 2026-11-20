import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { Button, ui } from '@/components/TradingUI';
import { MarketChart, marketPrice } from '@/components/MarketChart';
import { AnalysisPanel } from './AnalysisPanel';
import { useMarketData } from '@/hooks/useMarketData';
import { useNow } from '@/hooks/useNow';
import { marketIsStale } from '@/services/binance';
import { EXCHANGES, EXCHANGE_DETAILS, MARKET_ASSETS, pairLabel, type MarketAsset } from '@/services/markets';

export default function CryptoMarketPanel() {
  const { exchange, data, loading, error, retryAt, refresh, selectExchange } = useMarketData();
  const details = EXCHANGE_DETAILS[exchange];
  const now = useNow();
  const [selected, setSelected] = useState<MarketAsset>('BTC');
  const history = data[selected].history;
  const cooldownSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));
  return <ScrollView style={ui.page} contentContainerStyle={ui.content}>
    <View style={[ui.card, { borderLeftWidth: 4, borderLeftColor: '#58a6ff' }]}>
      <Text style={ui.title}>AI Trading Agent</Text>
      <Text style={ui.text}>{details.name} Spot market data</Text>
      <Text style={ui.muted}>Market data refreshes every 30 seconds while this screen is open and the app is active. Prices are snapshots, not a streaming feed.</Text>
      <Text style={ui.text}>{exchange === 'kraken' ? 'Online AI analysis is available for the selected market. This app cannot place orders or access exchange accounts.' : 'Explore market prices and hourly history. This app cannot place orders or access exchange accounts.'}</Text>
    </View>
    <View style={ui.card}>
      <Text style={ui.title}>Exchange</Text>
      <View style={ui.actions}>{EXCHANGES.map(value => <TouchableOpacity key={value} accessibilityRole="button"
        accessibilityState={{ selected: exchange === value }} style={[ui.button, exchange !== value && ui.secondary]}
        onPress={() => void selectExchange(value)}><Text style={ui.buttonText}>{EXCHANGE_DETAILS[value].name}</Text></TouchableOpacity>)}</View>
      <Text style={ui.muted}>Binance pairs use USDT. Kraken pairs use USD. These are different quote currencies; prices are not converted.</Text>
    </View>
    <View style={ui.card}>
      <View style={ui.row}>
        <Text style={ui.title}>Market prices</Text>
        <Button title={loading ? 'Refreshing…' : 'Refresh'} secondary disabled={loading || cooldownSeconds > 0} onPress={() => void refresh()} />
      </View>
      {loading && <View style={[ui.actions, { alignItems: 'center' }]}>
        <ActivityIndicator color="#58a6ff" accessibilityLabel={`Refreshing ${details.name} market data`} />
        <Text accessibilityLiveRegion="polite" style={ui.muted}>Fetching public market data…</Text>
      </View>}
      {cooldownSeconds > 0 && <Text style={ui.muted}>{details.name} request cooldown · retry available in {cooldownSeconds} seconds.</Text>}
      {error ? <Text accessibilityRole="alert" style={ui.red}>{error}</Text> : null}
      {MARKET_ASSETS.map(symbol => {
        const pair = data[symbol];
        const stale = marketIsStale(pair.quote?.fetchedAt, now, pair.quoteError);
        return <View key={symbol} style={{ paddingVertical: 10, gap: 6 }}>
          <Text style={ui.title}>{pairLabel(exchange, symbol)}</Text>
          <Text style={ui.value}>{pair.quote ? `${marketPrice(pair.quote.price)} ${details.currency}` : 'Price unavailable'}</Text>
          <Text style={ui.muted}>{pair.quote ? `Last fetched: ${new Date(pair.quote.fetchedAt).toLocaleString()}` : 'No successful price update yet.'}</Text>
          {pair.quote && <Text style={stale ? ui.red : ui.muted}>{stale ? 'Stale / unverified — last successful snapshot.' : 'Recently fetched snapshot.'}</Text>}
          {pair.quoteError ? <Text accessibilityRole="alert" style={ui.red}>{pair.quoteError}</Text> : null}
        </View>;
      })}
      <Text style={ui.muted}>Prices are quoted in {details.currency}. “Last fetched” is the device receipt time, not the exchange trade time. Failed updates keep the last successful snapshot; check its age before using it.</Text>
    </View>
    <View style={ui.card}>
      <Text style={ui.title}>Hourly market chart</Text>
      <View style={ui.actions}>{MARKET_ASSETS.map(symbol => <TouchableOpacity key={symbol} accessibilityRole="button"
        accessibilityState={{ selected: selected === symbol }} style={[ui.button, selected !== symbol && ui.secondary]}
        onPress={() => setSelected(symbol)}><Text style={ui.buttonText}>{pairLabel(exchange, symbol)}</Text></TouchableOpacity>)}</View>
      <Text style={ui.text}>{pairLabel(exchange, selected)} · hourly closes in {details.currency}</Text>
      {history ? <>
        <Text style={ui.muted}>Chart fetched: {new Date(history.fetchedAt).toLocaleString()}</Text>
        {marketIsStale(history.fetchedAt, now, data[selected].historyError) && <Text style={ui.red}>Stale chart — last successful history.</Text>}
        <MarketChart history={history} currency={details.currency} />
      </> : <Text style={ui.muted}>{loading ? 'Loading hourly price history…' : 'No price history is available. Use Refresh to retry.'}</Text>}
      {data[selected].historyError ? <Text accessibilityRole="alert" style={ui.red}>{data[selected].historyError}</Text> : null}
    </View>
    {exchange === 'kraken' && <AnalysisPanel key={`${exchange}:${selected}`} market={{ source: exchange, pair: pairLabel(exchange, selected) }} />}
    <Text style={ui.muted}>Source: {details.name}’s official public Spot market-data API at {details.host}. No API keys are required. If requests fail, check your connection and retry; regional or service restrictions may also prevent access.</Text>
  </ScrollView>;
}
