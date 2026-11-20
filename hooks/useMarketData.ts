import { useCallback, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { MARKET_REFRESH_MS } from '@/services/binance';
import { initialMarketFeedState, MarketFeed } from '@/services/marketFeed';
import type { MarketExchange } from '@/services/markets';

export function useMarketData() {
  const [state, setState] = useState(initialMarketFeedState);
  const ref = useRef<MarketFeed | null>(null);
  if (!ref.current) ref.current = new MarketFeed(setState);
  const feed = ref.current;
  const refresh = useCallback(() => feed.refresh(), [feed]);
  const selectExchange = useCallback((exchange: MarketExchange) => feed.selectExchange(exchange), [feed]);

  useFocusEffect(useCallback(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const update = (active: boolean) => {
      clearInterval(interval);
      void feed.setActive(active);
      if (active) interval = setInterval(() => void feed.refresh(), MARKET_REFRESH_MS);
    };
    update(AppState.currentState === 'active');
    const listener = AppState.addEventListener('change', state => update(state === 'active'));
    return () => { clearInterval(interval); listener.remove(); void feed.setActive(false); };
  }, [feed]));

  return { exchange: state.exchange, ...state.snapshots[state.exchange], selectExchange, refresh };
}
