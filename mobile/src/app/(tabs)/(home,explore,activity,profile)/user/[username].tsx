import { Stack, useLocalSearchParams } from 'expo-router';
import { ProfileView } from '@/features/profiles/components/ProfileView';

export default function UserScreen() {
  const { username } = useLocalSearchParams<{ username: string }>();
  return (
    <>
      <Stack.Screen options={{ title: username }} />
      <ProfileView username={username} />
    </>
  );
}
