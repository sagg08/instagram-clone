import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useNetInfo } from '@react-native-community/netinfo';
import { session } from '@/core/session';
import { outbox } from '@/core/sync/outbox';
import { colors, spacing } from './theme';

/** Cuántas acciones hay en la cola; se actualiza solo cuando la outbox cambia (patrón observador). */
function usePendingCount() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const refresh = () => {
      const userId = session.userId;
      if (userId) void outbox.count(userId).then(setCount);
    };
    refresh();
    return outbox.subscribe(refresh);
  }, []);
  return count;
}

/** Barra de estado: sin conexión y/o acciones pendientes de sincronizar. */
export function SyncStatusBanner() {
  const net = useNetInfo();
  const pending = usePendingCount();
  const offline = net.isConnected === false || net.isInternetReachable === false;

  if (!offline && pending === 0) return null;

  const text = offline
    ? `Sin conexión${pending ? ` · ${pending} acción(es) en cola` : ' · mostrando datos guardados'}`
    : `Sincronizando ${pending} acción(es)…`;

  return (
    <View style={{ backgroundColor: offline ? colors.text : colors.primary, paddingVertical: spacing.xs }}>
      <Text style={{ color: '#fff', textAlign: 'center', fontSize: 12, fontWeight: '600' }}>{text}</Text>
    </View>
  );
}
