import { DEFAULT_COACH_PREFERENCES, type CoachPreferences } from '@/utils/coach';
import { getAllTrades, getSessions, getCheckIns, getCoachPreferences, getCoachSessionStates, type SessionCheckIn, type CoachSessionState, type Trade, type TradingSession } from '@/db/database';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

type DataMode = 'real' | 'demo';
interface JournalData {
  trades: Trade[];
  sessions: TradingSession[];
  checkIns: SessionCheckIn[];
  coachPreferences: CoachPreferences;
  coachStates: CoachSessionState[];
  mode: DataMode;
  setMode: (mode: DataMode) => void;
  refresh: () => Promise<void>;
  loading: boolean;
}
// Keep the context identity stable when Fast Refresh re-evaluates this module.
// Its value still belongs to React's provider; no journal data is stored globally.
const journalGlobal = globalThis as typeof globalThis & { __tradeTrackJournalContext?: React.Context<JournalData | null> };
const JournalContext = journalGlobal.__tradeTrackJournalContext ??= createContext<JournalData | null>(null);

export function JournalProvider({ children }: { children: React.ReactNode }) {
  const [rows, setRows] = useState<Trade[]>([]);
  const [sessions, setSessions] = useState<TradingSession[]>([]);
  const [checkIns, setCheckIns] = useState<SessionCheckIn[]>([]);
  const [coachPreferences, setCoachPreferences] = useState(DEFAULT_COACH_PREFERENCES);
  const [coachStates, setCoachStates] = useState<CoachSessionState[]>([]);
  const [mode, setMode] = useState<DataMode>('real');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const request = useRef(0);
  const refresh = useCallback(async () => {
    const current = ++request.current;
    try {
      const [nextTrades, nextSessions, nextCheckIns, nextPreferences, nextStates] = await Promise.all([getAllTrades(), getSessions(), getCheckIns(), getCoachPreferences(), getCoachSessionStates()]);
      if (current === request.current) {
        setRows(nextTrades);
        setSessions(nextSessions);
        setCheckIns(nextCheckIns);
        setCoachPreferences(nextPreferences);
        setCoachStates(nextStates);
        setError(null);
        setLoading(false);
      }
    } catch (cause) {
      if (current === request.current) setError(cause instanceof Error ? cause : new Error(String(cause)));
    }
  }, []);
  useEffect(() => {
    void refresh();
    const listener = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => { request.current++; listener.remove(); };
  }, [refresh]);
  if (error) throw error;
  return <JournalContext.Provider value={{ trades: rows.filter(t => mode === 'real' ? !t.isDemo : !!t.isDemo),
    sessions, checkIns, coachPreferences, coachStates, mode, setMode, refresh, loading }}>{children}</JournalContext.Provider>;
}

export function useJournalData() {
  const data = useContext(JournalContext);
  if (!data) throw new Error('JournalProvider is missing.');
  return data;
}
