import { useMe } from '@/features/profiles/profilesHooks';
import { ProfileView } from '@/features/profiles/components/ProfileView';
import { CenteredMessage } from '@/shared/ui/controls';

/** Mi perfil: obtiene mi username y reutiliza la misma vista que el perfil de otros (DRY). */
export default function MyProfileScreen() {
  const me = useMe();
  if (me.isPending) return <CenteredMessage loading />;
  if (me.error || !me.data) return <CenteredMessage title="No se pudo cargar tu perfil" subtitle={me.error?.message} />;
  return <ProfileView username={me.data.username} />;
}
