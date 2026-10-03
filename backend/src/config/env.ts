import 'dotenv/config';
import { z } from 'zod';

/**
 * Validación de variables de entorno al ARRANCAR.
 * Si falta algo, el servidor no inicia (fail fast) en vez de fallar
 * a mitad de una petición con un error confuso.
 */
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  // Solo el origen del proyecto (https://xxx.supabase.co): el SDK añade /auth/v1, /rest/v1, etc.
  SUPABASE_URL: z
    .string()
    .url()
    .refine((u) => new URL(u).pathname === '/', 'Debe ser solo https://TU-PROYECTO.supabase.co, sin /rest/v1 ni otra ruta'),
  SUPABASE_ANON_KEY: z.string().min(20),
  CORS_ORIGINS: z.string().default(''),
  SIGNED_URL_TTL: z.coerce.number().int().min(60).max(86_400).default(3600),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Solo mostramos QUÉ variable falla, nunca su valor.
  console.error('❌ Variables de entorno inválidas:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
export const isProduction = env.NODE_ENV === 'production';
