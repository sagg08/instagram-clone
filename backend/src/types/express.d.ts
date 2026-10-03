import type { SupabaseClient } from '@supabase/supabase-js';

// Extiende Request para que, tras el middleware de auth, cada handler
// tenga el id del usuario y un cliente de BD que actúa en su nombre.
declare global {
  namespace Express {
    interface Request {
      auth?: { userId: string; db: SupabaseClient };
    }
  }
}

export {};
