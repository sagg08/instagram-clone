import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '@/core/supabase';
import { queryClient } from '@/core/queryClient';
import { persister } from '@/core/persistence';
import { session as currentSession } from '@/core/session';
import { syncEngine } from '@/core/sync/syncEngine';

type AuthState = { session: Session | null; loading: boolean };

const AuthContext = createContext<AuthState>({ session: null, loading: true });

/** Fuente única de verdad sobre "¿hay usuario logueado?" para toda la app. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, loading: true });

  useEffect(() => {
    const apply = (session: Session | null) => {
      const userId = session?.user.id ?? null;
      const previous = currentSession.userId;
      currentSession.set(userId); // antes de renderizar: las consultas lo necesitan para el rebase

      if (userId && userId !== previous) {
        syncEngine.start(userId); // procesa lo que quedó en la cola (incluso de antes de cerrar la app)
      } else if (!userId && previous) {
        syncEngine.stop();
        // El siguiente usuario no debe ver datos del anterior: memoria y disco.
        queryClient.clear();
        void persister.removeClient();
      }
      setState({ session, loading: false });
    };

    // 1) Sesión guardada en SecureStore al abrir la app
    supabase.auth.getSession().then(({ data }) => apply(data.session));
    // 2) Cambios posteriores: login, logout, refresco de token
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => apply(session));
    return () => sub.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
