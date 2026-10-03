import { Alert } from 'react-native';
import { session } from '@/core/session';
import { outbox } from '@/core/sync/outbox';
import { signOut } from './authService';

/**
 * Cerrar sesión de forma segura con la cola offline.
 * Las acciones pendientes pertenecen a ESTE usuario: no pueden quedarse para
 * enviarse luego con el token de otra persona. Si hay pendientes, se avisa
 * antes de descartarlas.
 */
export async function confirmSignOut() {
  const userId = session.userId;
  const pending = userId ? await outbox.count(userId) : 0;

  const doSignOut = async () => {
    if (userId) await outbox.clearUser(userId);
    await signOut();
  };

  if (pending === 0) {
    await doSignOut();
    return;
  }

  Alert.alert(
    'Hay acciones sin sincronizar',
    `Tienes ${pending} acción(es) que aún no llegan al servidor. Si cierras sesión ahora se perderán.`,
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: () => void doSignOut() },
    ],
  );
}
