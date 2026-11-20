import React, { useCallback, useState } from 'react';
import { ActivityIndicator, AppState, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { AnalysisFeed, type AnalysisState } from '@/services/analysisClient';
import type { AnalysisMarket } from '@/services/analysisContract';
import { useNow } from '@/hooks/useNow';
import { Button, ui } from './TradingUI';

// Demo authentication only, held in memory. Never persist or bundle a provider key.
let sessionCode = '';
const number = (value: number) => value.toLocaleString(undefined, { maximumFractionDigits: 6 });
export function AnalysisPanel({ market }: { market: AnalysisMarket }) {
  const [accessCode, setAccessCode] = useState(sessionCode);
  const [adult, setAdult] = useState(false);
  const [state, setState] = useState<AnalysisState>({ loading: false, retryAt: 0 });
  const [feed] = useState(() => new AnalysisFeed(market, setState, process.env.EXPO_PUBLIC_MARKET_BACKEND_URL));
  const now = useNow();
  useFocusEffect(useCallback(() => {
    const update = (active: boolean) => {
      feed.setActive(active);
      if (!active) { sessionCode = ''; setAccessCode(''); setAdult(false); }
    };
    update(AppState.currentState === 'active');
    const listener = AppState.addEventListener('change', value => update(value === 'active'));
    return () => { listener.remove(); feed.setActive(false); };
  }, [feed]));
  const seconds = Math.max(0, Math.ceil((state.retryAt - now) / 1000));
  const proposal = state.proposal;
  const expired = proposal && (now >= proposal.expiresAt || now < proposal.generatedAt - 60000
    || now - proposal.dataAsOf > (proposal.interval === '1h' ? 2 * 3600000 : 5 * 86400000));
  return <View style={ui.card}>
    <Text style={ui.title}>Online AI analysis · {market.pair}</Text>
    <Text style={ui.muted}>Experimental educational proposals only. AI can be wrong; this is not personal investment advice. No orders can be placed and no profit is guaranteed.</Text>
    {market.source === 'gold' ? <Text accessibilityRole="alert" style={ui.text}>Analysis Unavailable: the current Gold history provides too few daily averages for the required indicators. Spot and historical display remain available.</Text> : <>
      <Text style={ui.text}>Demo access code</Text>
      <TextInput accessibilityLabel="Demo analysis access code" style={ui.input} secureTextEntry autoCapitalize="none" autoCorrect={false}
        value={accessCode} maxLength={128} placeholder="Ask the project owner for the demo code" placeholderTextColor="#8b949e"
        onChangeText={value => { setAccessCode(value); sessionCode = value; }} />
      <Text style={ui.muted}>Use the demo access code, never a Gemini, Groq, Binance or Kraken API key. The code stays in app memory and clears when the app backgrounds.</Text>
      <TouchableOpacity accessibilityRole="checkbox" accessibilityState={{ checked: adult }} style={[ui.button, ui.secondary]} onPress={() => setAdult(!adult)}>
        <Text style={ui.buttonText}>{adult ? '✓ ' : ''}I am 18 or older</Text>
      </TouchableOpacity>
      <Button title={state.loading ? 'Analyzing…' : 'Analyze Market'} disabled={!adult || state.loading || seconds > 0}
        onPress={() => void feed.analyze(accessCode)} />
      {state.loading && <><ActivityIndicator accessibilityLabel="Requesting online AI analysis" color="#58a6ff" /><Text style={ui.muted}>Fetching server-verified history, calculating indicators, and contacting the AI model…</Text></>}
      {seconds > 0 && <Text style={ui.muted}>Retry available in {seconds} seconds. Quotas are shared across the university demo.</Text>}
      {state.error && <Text accessibilityRole="alert" style={ui.red}>{state.error}</Text>}
      {expired && <Text accessibilityRole="alert" style={ui.red}>Analysis Unavailable: this proposal has expired. Analyze again.</Text>}
      {proposal && !expired && <View style={{ gap: 8 }}>
        <Text style={[ui.value, ui.blue]}>{proposal.action}</Text>
        <Text style={ui.text}>{proposal.market.source} · {proposal.market.pair} · {proposal.interval} · {proposal.observationKind}</Text>
        {proposal.derivedFrom && <Text style={ui.blue}>Inverse-derived from EUR/USD · euros per US dollar.</Text>}
        <Text style={ui.muted}>Provider: {proposal.provider} · Model: {proposal.model}</Text>
        <Text style={ui.muted}>{state.cached ? 'Cached genuine model response' : 'New model response'} · Generated: {new Date(proposal.generatedAt).toLocaleString()}</Text>
        <Text style={ui.muted}>Source data through: {new Date(proposal.dataAsOf).toLocaleString()} · {proposal.observations} observations</Text>
        <Text style={ui.muted}>Server fetched: {new Date(proposal.fetchedAt).toLocaleString()} · Expires: {new Date(proposal.expiresAt).toLocaleString()}</Text>
        <Text style={ui.text}>Last analyzed value: {number(proposal.lastValue)} {proposal.market.pair.split('/')[1]}</Text>
        <Text style={ui.title}>Calculated indicators</Text>
        <Text style={ui.text}>RSI(14): {number(proposal.indicators.rsi14)}</Text>
        <Text style={ui.text}>SMA(20 / 50): {number(proposal.indicators.sma20)} / {number(proposal.indicators.sma50)}</Text>
        <Text style={ui.text}>EMA(20 / 50): {number(proposal.indicators.ema20)} / {number(proposal.indicators.ema50)}</Text>
        <Text style={ui.text}>MACD(12,26,9): {number(proposal.indicators.macd.line)} · Signal: {number(proposal.indicators.macd.signal)} · Histogram: {number(proposal.indicators.macd.histogram)}</Text>
        <Text style={ui.muted}>Indicators are server-calculated. The AI narrative may still contain errors. Daily reference-rate indicators are not hourly trading signals.</Text>
        <Text style={ui.title}>AI explanation</Text><Text style={ui.text}>{proposal.explanation}</Text>
        <Text style={ui.title}>Conflicting signals</Text>{proposal.conflictingSignals.map((value, i) => <Text key={i} style={ui.text}>• {value}</Text>)}
        <Text style={ui.title}>Uncertainty: {proposal.uncertainty}</Text><Text style={ui.text}>{proposal.uncertaintyExplanation}</Text>
        <Text style={ui.title}>Risks</Text>{proposal.risks.map((value, i) => <Text key={i} style={ui.text}>• {value}</Text>)}
        <Text style={ui.muted}>Provider response ID: {proposal.providerRequestId}. No approval or trade execution controls exist.</Text>
      </View>}
    </>}
  </View>;
}
