import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { qk, queryClient } from '@/core/queryClient';
import type { Profile } from '@/core/types';
import * as profilesApi from './profilesApi';

export function useMe() {
  return useQuery({ queryKey: qk.me, queryFn: ({ signal }) => profilesApi.getMe(signal) });
}

export function useProfile(username: string | undefined) {
  return useQuery({
    queryKey: qk.profile(username ?? ''),
    queryFn: ({ signal }) => profilesApi.getProfile(username!, signal),
    enabled: Boolean(username),
  });
}

export function useUpdateMe() {
  return useMutation({
    mutationFn: profilesApi.updateMe,
    onSuccess: (me) => {
      queryClient.setQueryData(qk.me, me);
      queryClient.invalidateQueries({ queryKey: qk.profile(me.username) });
    },
  });
}

/** Debounce: espera a que el usuario deje de escribir 300 ms antes de buscar (evita una petición por tecla). */
function useDebounced<T>(value: T, ms = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export function useSearchUsers(rawQuery: string) {
  const q = useDebounced(rawQuery.trim().toLowerCase());
  const valid = /^[a-z0-9_.]{1,30}$/.test(q);
  return useQuery({
    queryKey: qk.search(q),
    queryFn: ({ signal }) => profilesApi.searchUsers(q, signal),
    enabled: valid,
  });
}

/** Seguir / dejar de seguir con actualización optimista del botón y el contador. */
export function useToggleFollow(profile: Profile | undefined) {
  return useMutation({
    mutationFn: async () => {
      if (!profile) throw new Error('Perfil no cargado');
      return profile.follow_state === 'none' ? profilesApi.follow(profile.id) : profilesApi.unfollow(profile.id);
    },
    onMutate: () => {
      if (!profile) return;
      const key = qk.profile(profile.username);
      const previous = queryClient.getQueryData<Profile>(key);
      queryClient.setQueryData<Profile>(key, (p) =>
        p && {
          ...p,
          // Optimista: si es privada, queda "Solicitado"; si es pública, "Siguiendo".
          follow_state: p.follow_state === 'none' ? (p.is_private ? 'pending' : 'accepted') : 'none',
        },
      );
      return { previous };
    },
    onError: (_e, _v, ctx) => {
      if (profile && ctx?.previous) queryClient.setQueryData(qk.profile(profile.username), ctx.previous);
    },
    onSettled: () => {
      if (!profile) return;
      // Recarga el perfil (contadores, can_view_content) y el feed (aparecen/desaparecen sus posts).
      queryClient.invalidateQueries({ queryKey: qk.profile(profile.username) });
      queryClient.invalidateQueries({ queryKey: qk.feed });
    },
  });
}

export function useFollowRequests() {
  return useQuery({ queryKey: qk.followRequests, queryFn: ({ signal }) => profilesApi.getFollowRequests(signal) });
}

export function useRespondRequest() {
  return useMutation({
    mutationFn: ({ followerId, accept }: { followerId: string; accept: boolean }) =>
      accept ? profilesApi.acceptRequest(followerId) : profilesApi.rejectRequest(followerId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.followRequests });
      queryClient.invalidateQueries({ queryKey: ['profile'] }); // contador de seguidores
    },
  });
}

export function useConnections(userId: string | undefined, kind: 'followers' | 'following') {
  return useQuery({
    queryKey: qk.connections(userId ?? '', kind),
    queryFn: ({ signal }) => profilesApi.getConnections(userId!, kind, signal),
    enabled: Boolean(userId),
  });
}
