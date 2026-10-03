import { FlatList, Text, View } from 'react-native';
import { useFollowRequests, useRespondRequest } from '@/features/profiles/profilesHooks';
import { UserRow } from '@/features/profiles/components/UserRow';
import { Button, CenteredMessage } from '@/shared/ui/controls';
import { spacing } from '@/shared/ui/theme';

/** Solicitudes de seguimiento pendientes (flujo de cuentas privadas, módulo 1). */
export default function ActivityScreen() {
  const requests = useFollowRequests();
  const respond = useRespondRequest();

  if (requests.isPending) return <CenteredMessage loading />;

  return (
    <FlatList
      data={requests.data ?? []}
      keyExtractor={(r) => r.user.id}
      refreshing={requests.isRefetching}
      onRefresh={() => requests.refetch()}
      ListHeaderComponent={
        <Text style={{ fontWeight: '700', fontSize: 16, padding: spacing.lg }}>Solicitudes de seguimiento</Text>
      }
      ListEmptyComponent={<CenteredMessage subtitle="No tienes solicitudes pendientes" />}
      renderItem={({ item }) => {
        const busy = respond.isPending && respond.variables?.followerId === item.user.id;
        return (
          <UserRow
            user={item.user}
            right={
              <View style={{ flexDirection: 'row', gap: spacing.sm, width: 170 }}>
                <Button compact title="Confirmar" loading={busy} onPress={() => respond.mutate({ followerId: item.user.id, accept: true })} />
                <Button compact title="Eliminar" variant="secondary" disabled={busy} onPress={() => respond.mutate({ followerId: item.user.id, accept: false })} />
              </View>
            }
          />
        );
      }}
    />
  );
}
