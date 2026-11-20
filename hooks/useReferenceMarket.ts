import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ReferenceFeed, type ReferenceFeedState } from '@/services/referenceFeed';
import type { ReferencePair } from '@/services/referenceMarkets';

export function useReferenceMarket(initialPair: ReferencePair) {
  const [state, setState] = useState<ReferenceFeedState>({ pair: initialPair, loading: false, retryAt: 0 });
  const [feed] = useState(() => new ReferenceFeed(initialPair, setState, {
    backendUrl: process.env.EXPO_PUBLIC_MARKET_BACKEND_URL,
  }));
  useFocusEffect(useCallback(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = (active: boolean) => {
      clearInterval(timer); void feed.setActive(active);
      if (active) timer = setInterval(() => void feed.refresh(), initialPair === 'XAU/USD' ? 30000 : 3600000);
    };
    update(AppState.currentState === 'active');
    const listener = AppState.addEventListener('change', value => update(value === 'active'));
    return () => { clearInterval(timer); listener.remove(); void feed.setActive(false); };
  }, [feed, initialPair]));
  return { ...state, refresh: () => feed.refresh(), selectPair: (pair: ReferencePair) => feed.selectPair(pair) };
}
