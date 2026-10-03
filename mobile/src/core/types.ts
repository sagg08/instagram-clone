// Contratos de datos entre la API y la app (deben coincidir con los DTOs del backend).

export type FollowState = 'none' | 'pending' | 'accepted';

export type Cursor = { created_at: string; id: string } | null;

export type Page<T> = { items: T[]; next_cursor: Cursor };

export type UserMini = {
  id: string;
  username: string;
  full_name: string | null;
  avatar_url: string | null;
  is_private?: boolean;
};

export type Me = UserMini & {
  bio: string | null;
  avatar_path: string | null;
  is_private: boolean;
  created_at: string;
};

export type Profile = Me & {
  stats: { posts_count: number; followers_count: number; following_count: number };
  is_me: boolean;
  follow_state: FollowState;
  can_view_content: boolean;
};

export type Post = {
  id: string;
  author: { id: string; username: string; avatar_url: string | null };
  image_path: string; // clave estable para la caché de imágenes
  image_url: string | null; // URL firmada temporal
  caption: string | null;
  created_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: boolean;
};

export type GridPost = { id: string; image_path: string; image_url: string | null; created_at: string };

export type FollowRequest = { requested_at: string; user: UserMini };

export type Comment = {
  id: string;
  post_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  user: { id: string; username: string; avatar_url: string | null };
  /** Solo en el cliente: 'pending' = en la cola offline; 'failed' = el servidor lo rechazó. */
  _status?: 'pending' | 'failed';
};

export type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  body: string;
  created_at: string;
  delivered_at: string | null; // el teléfono del destinatario lo recibió
  read_at: string | null; // el destinatario abrió el chat ("Visto")
  /** Solo en el cliente: en la cola offline o rechazado por el servidor. */
  _status?: 'pending' | 'failed';
};

export type InboxItem = {
  id: string;
  last_message_at: string;
  other: { id: string; username: string; full_name: string | null; avatar_url: string | null };
  last_message: { body: string; sender_id: string; created_at: string; read_at: string | null } | null;
  unread_count: number;
};

export type ConversationInfo = { id: string; other: InboxItem['other'] };

export type StoryItem = {
  id: string;
  image_path: string; // clave estable para la caché de imágenes
  image_url: string | null;
  created_at: string;
  expires_at: string;
};

export type StoryGroup = {
  author: { id: string; username: string; avatar_url: string | null };
  is_me: boolean;
  latest_at: string;
  items: StoryItem[];
};
