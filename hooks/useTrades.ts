import { useCallback } from 'react';
import { useFocusEffect } from 'expo-router';
import { useJournalData } from './JournalProvider';

export function useTrades() {
  const data = useJournalData();
  useFocusEffect(useCallback(() => { void data.refresh(); }, [data.refresh]));
  return data;
}
