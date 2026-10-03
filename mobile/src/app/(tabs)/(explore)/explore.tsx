import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useSearchUsers } from '@/features/profiles/profilesHooks';
import { UserRow } from '@/features/profiles/components/UserRow';
import { CenteredMessage, TextField } from '@/shared/ui/controls';
import { spacing } from '@/shared/ui/theme';

export default function ExploreScreen() {
  const [query, setQuery] = useState('');
  const results = useSearchUsers(query);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: spacing.md }}>
        <TextField placeholder="Buscar usuarios" value={query} onChangeText={setQuery} returnKeyType="search" />
      </View>
      <FlatList
        data={results.data ?? []}
        keyExtractor={(u) => u.id}
        renderItem={({ item }) => <UserRow user={item} />}
        keyboardShouldPersistTaps="handled"
        ListEmptyComponent={
          query.trim() ? (
            results.isFetching ? <CenteredMessage loading /> : <CenteredMessage title="Sin resultados" />
          ) : (
            <CenteredMessage subtitle="Busca por nombre de usuario" />
          )
        }
      />
    </View>
  );
}
