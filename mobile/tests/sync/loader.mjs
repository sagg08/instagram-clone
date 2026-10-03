const M = new URL('./mocks/', import.meta.url).href;
const map = { 'expo-crypto': 'crypto.ts', '@react-native-community/netinfo': 'netinfo.ts', 'react-native': 'rn.ts' };
export async function resolve(spec, ctx, next) {
  if (map[spec]) return { url: M + map[spec], shortCircuit: true };
  if (spec === '../db/localDb') return { url: M + 'localDb.ts', shortCircuit: true };
  if (spec === '../api/client') return { url: M + 'client.ts', shortCircuit: true };
  return next(spec, ctx);
}
