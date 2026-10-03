import { api } from '@/core/api/client';
import type { FollowRequest, FollowState, Me, Profile, UserMini } from '@/core/types';

export const getMe = (signal?: AbortSignal) => api<Me>('/me', { signal });

export const updateMe = (patch: Partial<Pick<Me, 'full_name' | 'bio' | 'is_private' | 'avatar_path'>>) =>
  api<Me>('/me', { method: 'PATCH', body: patch });

export const getProfile = (username: string, signal?: AbortSignal) =>
  api<Profile>(`/users/${encodeURIComponent(username)}`, { signal });

export const searchUsers = (q: string, signal?: AbortSignal) =>
  api<UserMini[]>('/users/search', { query: { q }, signal });

export const getConnections = (userId: string, kind: 'followers' | 'following', signal?: AbortSignal) =>
  api<UserMini[]>(`/users/${userId}/${kind}`, { signal });

type FollowResult = { follow_state: FollowState };

export const follow = (userId: string) => api<FollowResult>(`/users/${userId}/follow`, { method: 'POST' });
export const unfollow = (userId: string) => api<FollowResult>(`/users/${userId}/follow`, { method: 'DELETE' });

export const getFollowRequests = (signal?: AbortSignal) => api<FollowRequest[]>('/follow-requests', { signal });

export const acceptRequest = (followerId: string) =>
  api<FollowResult>(`/follow-requests/${followerId}/accept`, { method: 'POST' });

export const rejectRequest = (followerId: string) =>
  api<FollowResult>(`/follow-requests/${followerId}`, { method: 'DELETE' });
