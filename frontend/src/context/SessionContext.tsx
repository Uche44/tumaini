'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';

interface SessionState {
  sessionId: string;
  voiceBlob: Blob | null;
  voiceUrl: string | null;
  voiceId: string | null;
  situation: string;
  goals: string[];
  challenges: string;
  traits: string[];
  futureReminder: string;
}

interface SessionContextValue extends SessionState {
  setVoiceBlob: (blob: Blob | null) => void;
  setVoiceUrl: (url: string | null) => void;
  setVoiceId: (id: string | null) => void;
  setSessionId: (id: string) => void;
  setSituation: (s: string) => void;
  setGoals: (g: string[]) => void;
  setChallenges: (c: string) => void;
  setTraits: (t: string[]) => void;
  setFutureReminder: (r: string) => void;
  resetSession: () => void;
}

const defaultState: SessionState = {
  sessionId: '',
  voiceBlob: null,
  voiceUrl: null,
  voiceId: null,
  situation: '',
  goals: [],
  challenges: '',
  traits: [],
  futureReminder: '',
};

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>(defaultState);

  // Initialize session ID on client side
  useEffect(() => {
    if (typeof window !== 'undefined') {
      let id = localStorage.getItem('tumaini_session_id');
      if (!id) {
        id = 'sess_' + Math.random().toString(36).substring(2, 15) + '_' + Date.now();
        localStorage.setItem('tumaini_session_id', id);
      }
      setState((prev) => ({ ...prev, sessionId: id }));
    }
  }, []);

  const setVoiceBlob = (blob: Blob | null) => {
    setState((prev) => ({ ...prev, voiceBlob: blob }));
  };

  const setVoiceUrl = (url: string | null) => {
    setState((prev) => ({ ...prev, voiceUrl: url }));
  };

  const setVoiceId = (voiceId: string | null) => {
    setState((prev) => ({ ...prev, voiceId }));
  };

  const setSessionId = (id: string) => {
    // Persists to localStorage so it survives navigation
    if (typeof window !== 'undefined') {
      localStorage.setItem('tumaini_session_id', id);
    }
    setState((prev) => ({ ...prev, sessionId: id }));
  };

  const setSituation = (situation: string) => {
    setState((prev) => ({ ...prev, situation }));
  };

  const setGoals = (goals: string[]) => {
    setState((prev) => ({ ...prev, goals }));
  };

  const setChallenges = (challenges: string) => {
    setState((prev) => ({ ...prev, challenges }));
  };

  const setTraits = (traits: string[]) => {
    setState((prev) => ({ ...prev, traits }));
  };

  const setFutureReminder = (futureReminder: string) => {
    setState((prev) => ({ ...prev, futureReminder }));
  };

  const resetSession = () => {
    if (state.voiceUrl) {
      URL.revokeObjectURL(state.voiceUrl);
    }
    setState((prev) => ({
      ...defaultState,
      sessionId: prev.sessionId // Keep the same session ID
    }));
  };

  return (
    <SessionContext.Provider
      value={{
        ...state,
        setVoiceBlob,
        setVoiceUrl,
        setVoiceId,
        setSessionId,
        setSituation,
        setGoals,
        setChallenges,
        setTraits,
        setFutureReminder,
        resetSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const ctx = useContext(SessionContext);
  if (!ctx) {
    throw new Error('useSession must be used inside <SessionProvider>');
  }
  return ctx;
}

