import { useCallback, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';

// A foreground display clock only: this never changes a saved session's status.
// Elapsed time comes from its persisted start time, including after reopening.
export function useNow(enabled = true) {
  const [now, setNow] = useState(Date.now());
  useFocusEffect(useCallback(() => {
    setNow(Date.now());
    if (!enabled) return;
    let timer: ReturnType<typeof setInterval> | undefined;
    const update = (active: boolean) => {
      clearInterval(timer);
      if (active) {
        setNow(Date.now());
        timer = setInterval(() => setNow(Date.now()), 1000);
      }
    };
    update(AppState.currentState === 'active');
    const listener = AppState.addEventListener('change', state => update(state === 'active'));
    return () => { clearInterval(timer); listener.remove(); };
  }, [enabled]));
  return now;
}
