import 'react-native-url-polyfill/auto'; // supabase-js necesita la API URL completa del navegador
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { config } from './config';
import { secureStorage } from './secureStorage';

/**
 * En la app, Supabase se usa SOLO para:
 *  - Auth (login/registro y refresco de tokens)
 *  - Realtime (escuchar mensajes y "escribiendo...", módulo 4)
 * Todas las lecturas/escrituras de negocio pasan por nuestra API (src/core/api).
 */
export const supabase = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: {
    storage: secureStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // eso es para navegadores (OAuth por URL)
  },
});

// Refrescar tokens solo con la app en primer plano: en background el SO puede
// congelar los timers de JS, y así ahorramos batería y red.
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});
