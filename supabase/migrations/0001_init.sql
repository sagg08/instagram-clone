-- =====================================================================
-- Instagram Clone V2 — Migración inicial
-- Esquema + seguridad (RLS) + triggers + Storage
--
-- Principios:
--  1. Toda la autorización vive en la base de datos (RLS). La API también
--     valida, pero aunque alguien llame a Supabase directo, no ve nada
--     que no le corresponda (defensa en profundidad).
--  2. Los IDs de comentarios y mensajes los genera el CLIENTE (UUID v4).
--     Así, si la cola offline reintenta un envío, el segundo INSERT choca
--     con la PK y no se duplica nada (idempotencia).
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. TABLAS
-- ---------------------------------------------------------------------

-- Perfil público de cada usuario (1:1 con auth.users)
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (username ~ '^[a-z0-9_.]{3,30}$'),
  full_name   text check (char_length(full_name) <= 60),
  bio         text check (char_length(bio) <= 150),
  avatar_path text,                               -- ruta en Storage, no URL
  is_private  boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Seguimientos. "Rechazar" = borrar la fila (permite volver a solicitar).
create type public.follow_status as enum ('pending', 'accepted');

create table public.follows (
  follower_id  uuid not null references public.profiles (id) on delete cascade,
  following_id uuid not null references public.profiles (id) on delete cascade,
  status       public.follow_status not null default 'pending',
  created_at   timestamptz not null default now(),
  primary key (follower_id, following_id),
  check (follower_id <> following_id)
);

create table public.posts (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  image_path text not null,
  caption    text check (char_length(caption) <= 2200),
  created_at timestamptz not null default now()
);

-- La PK compuesta hace el like idempotente por naturaleza:
-- un usuario no puede dar dos likes al mismo post.
create table public.likes (
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

-- parent_id permite respuestas (comentarios anidados).
create table public.comments (
  id         uuid primary key,                      -- generado en el cliente
  post_id    uuid not null references public.posts (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  parent_id  uuid references public.comments (id) on delete cascade,
  body       text not null check (char_length(body) between 1 and 1000),
  created_at timestamptz not null default now()
);

-- Conversación 1:1. user_a < user_b garantiza una sola fila por pareja.
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  user_a          uuid not null references public.profiles (id) on delete cascade,
  user_b          uuid not null references public.profiles (id) on delete cascade,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);

create table public.messages (
  id              uuid primary key,                 -- generado en el cliente
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now(),
  delivered_at    timestamptz,                      -- confirmación de entrega
  read_at         timestamptz                       -- "Visto"
);

create table public.stories (
  id         uuid primary key default gen_random_uuid(),
  author_id  uuid not null references public.profiles (id) on delete cascade,
  image_path text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours')
);

-- ---------------------------------------------------------------------
-- 2. ÍNDICES (pensados para las consultas reales de la app)
-- ---------------------------------------------------------------------
create index posts_feed_idx        on public.posts (created_at desc, id desc);
create index posts_author_idx      on public.posts (author_id, created_at desc);
create index follows_following_idx on public.follows (following_id, status);
create index comments_post_idx     on public.comments (post_id, created_at);
create index messages_conv_idx     on public.messages (conversation_id, created_at desc);
create index conversations_a_idx   on public.conversations (user_a, last_message_at desc);
create index conversations_b_idx   on public.conversations (user_b, last_message_at desc);
create index stories_author_idx    on public.stories (author_id, expires_at);

-- ---------------------------------------------------------------------
-- 3. FUNCIÓN CENTRAL DE PRIVACIDAD
-- ¿El usuario actual puede ver el contenido de "owner"?
-- SECURITY DEFINER: se ejecuta con permisos del dueño para leer follows
-- y profiles sin disparar RLS de nuevo (evita recursión infinita).
-- search_path fijo: evita ataques por suplantación de esquema.
-- ---------------------------------------------------------------------
create or replace function public.can_view_content(owner uuid)
returns boolean
language sql stable security definer
set search_path = public
as $$
  select owner = auth.uid()
      or exists (select 1 from public.profiles p
                 where p.id = owner and not p.is_private)
      or exists (select 1 from public.follows f
                 where f.follower_id = auth.uid()
                   and f.following_id = owner
                   and f.status = 'accepted');
$$;

-- ---------------------------------------------------------------------
-- 4. TRIGGERS
-- ---------------------------------------------------------------------

-- 4.1 Crea el perfil al registrarse (username viene en metadata del signup)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, full_name)
  values (new.id,
          lower(new.raw_user_meta_data ->> 'username'),
          new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 4.2 El estado de un follow lo decide el SERVIDOR, nunca el cliente:
-- cuenta privada -> 'pending'; pública -> 'accepted'.
create or replace function public.set_follow_status()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  select case when p.is_private then 'pending'::public.follow_status
              else 'accepted'::public.follow_status end
    into new.status
  from public.profiles p
  where p.id = new.following_id;

  if new.status is null then
    raise exception 'El perfil que intentas seguir no existe';
  end if;
  return new;
end;
$$;

create trigger trg_follow_status
  before insert on public.follows
  for each row execute function public.set_follow_status();

-- 4.3 Reordenamiento de la bandeja de DMs: cada mensaje nuevo
-- actualiza last_message_at de su conversación.
create or replace function public.bump_conversation()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update public.conversations
     set last_message_at = new.created_at
   where id = new.conversation_id;
  return new;
end;
$$;

create trigger trg_bump_conversation
  after insert on public.messages
  for each row execute function public.bump_conversation();

-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------
alter table public.profiles      enable row level security;
alter table public.follows       enable row level security;
alter table public.posts         enable row level security;
alter table public.likes         enable row level security;
alter table public.comments      enable row level security;
alter table public.conversations enable row level security;
alter table public.messages      enable row level security;
alter table public.stories       enable row level security;

-- PROFILES: nombre y avatar son visibles para todos los autenticados
-- (como en Instagram); lo privado es el CONTENIDO.
create policy "profiles: ver"    on public.profiles for select to authenticated using (true);
create policy "profiles: editar" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- FOLLOWS
-- Ver: las filas propias, o las aceptadas de perfiles cuyo contenido puedo ver
-- (así la lista de seguidores/seguidos de una cuenta privada queda oculta).
create policy "follows: ver" on public.follows for select to authenticated using (
  follower_id = auth.uid()
  or following_id = auth.uid()
  or (status = 'accepted'
      and (public.can_view_content(following_id) or public.can_view_content(follower_id)))
);
create policy "follows: solicitar" on public.follows for insert to authenticated
  with check (follower_id = auth.uid());
-- Aprobar: solo el dueño de la cuenta seguida, y solo pending -> accepted
create policy "follows: aprobar" on public.follows for update to authenticated
  using (following_id = auth.uid() and status = 'pending')
  with check (following_id = auth.uid() and status = 'accepted');
-- Borrar: dejar de seguir / cancelar solicitud (follower) o rechazar / eliminar seguidor (following)
create policy "follows: borrar" on public.follows for delete to authenticated
  using (follower_id = auth.uid() or following_id = auth.uid());

-- POSTS
create policy "posts: ver"    on public.posts for select to authenticated
  using (public.can_view_content(author_id));
create policy "posts: crear"  on public.posts for insert to authenticated
  with check (author_id = auth.uid());
create policy "posts: editar" on public.posts for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
create policy "posts: borrar" on public.posts for delete to authenticated
  using (author_id = auth.uid());

-- LIKES (el EXISTS sobre posts hereda el RLS de posts: si no ves el post, no ves sus likes)
create policy "likes: ver"   on public.likes for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "likes: dar"   on public.likes for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));
create policy "likes: quitar" on public.likes for delete to authenticated
  using (user_id = auth.uid());

-- COMMENTS
create policy "comments: ver"    on public.comments for select to authenticated
  using (exists (select 1 from public.posts p where p.id = post_id));
create policy "comments: crear"  on public.comments for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.posts p where p.id = post_id));
create policy "comments: borrar" on public.comments for delete to authenticated
  using (user_id = auth.uid()
         or exists (select 1 from public.posts p where p.id = post_id and p.author_id = auth.uid()));

-- CONVERSATIONS
create policy "conversations: ver"   on public.conversations for select to authenticated
  using (auth.uid() in (user_a, user_b));
create policy "conversations: crear" on public.conversations for insert to authenticated
  with check (auth.uid() in (user_a, user_b));

-- MESSAGES
create policy "messages: ver" on public.messages for select to authenticated using (
  exists (select 1 from public.conversations c
          where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b))
);
create policy "messages: enviar" on public.messages for insert to authenticated with check (
  sender_id = auth.uid()
  and exists (select 1 from public.conversations c
              where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b))
);
-- Marcar entregado/visto: solo el DESTINATARIO (no el remitente)
create policy "messages: marcar estado" on public.messages for update to authenticated
  using (sender_id <> auth.uid()
         and exists (select 1 from public.conversations c
                     where c.id = conversation_id and auth.uid() in (c.user_a, c.user_b)));

-- STORIES (el filtro de 24 h también es de seguridad: lo expirado no se sirve)
create policy "stories: ver"    on public.stories for select to authenticated
  using (expires_at > now() and public.can_view_content(author_id));
create policy "stories: crear"  on public.stories for insert to authenticated
  with check (author_id = auth.uid());
create policy "stories: borrar" on public.stories for delete to authenticated
  using (author_id = auth.uid());

-- ---------------------------------------------------------------------
-- 6. PRIVILEGIOS POR COLUMNA
-- RLS decide QUÉ FILAS; estos GRANT deciden QUÉ COLUMNAS se pueden editar.
-- Ej.: el destinatario puede marcar read_at, pero NO cambiar el texto.
-- ---------------------------------------------------------------------
revoke update on public.profiles from anon, authenticated;
grant  update (username, full_name, bio, avatar_path, is_private) on public.profiles to authenticated;

revoke update on public.follows from anon, authenticated;
grant  update (status) on public.follows to authenticated;

revoke update on public.messages from anon, authenticated;
grant  update (delivered_at, read_at) on public.messages to authenticated;

revoke update on public.posts from anon, authenticated;
grant  update (caption) on public.posts to authenticated;

-- ---------------------------------------------------------------------
-- 7. FEED (una sola consulta con contadores y "liked_by_me")
-- SECURITY INVOKER: corre con los permisos del usuario -> respeta RLS.
-- Paginación por cursor (created_at, id): estable aunque lleguen posts nuevos,
-- a diferencia de OFFSET, que duplica o salta elementos.
-- ---------------------------------------------------------------------
create or replace function public.get_feed(
  p_cursor_created_at timestamptz default null,
  p_cursor_id         uuid        default null,
  p_limit             int         default 20
)
returns table (
  id uuid, author_id uuid, username text, avatar_path text,
  image_path text, caption text, created_at timestamptz,
  like_count bigint, comment_count bigint, liked_by_me boolean
)
language sql stable security invoker
set search_path = public
as $$
  select p.id, p.author_id, pr.username, pr.avatar_path,
         p.image_path, p.caption, p.created_at,
         (select count(*) from public.likes l    where l.post_id = p.id),
         (select count(*) from public.comments c where c.post_id = p.id),
         exists (select 1 from public.likes l where l.post_id = p.id and l.user_id = auth.uid())
  from public.posts p
  join public.profiles pr on pr.id = p.author_id
  where (p.author_id = auth.uid()
         or exists (select 1 from public.follows f
                    where f.follower_id = auth.uid()
                      and f.following_id = p.author_id
                      and f.status = 'accepted'))
    and (p_cursor_created_at is null
         or (p.created_at, p.id) < (p_cursor_created_at, p_cursor_id))
  order by p.created_at desc, p.id desc
  limit least(greatest(p_limit, 1), 50);
$$;

-- ---------------------------------------------------------------------
-- 8. REALTIME: publicar cambios de messages (Realtime respeta el RLS de arriba)
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.messages;

-- ---------------------------------------------------------------------
-- 9. STORAGE
-- Convención de rutas: {user_id}/{uuid}.jpg
-- avatars: público. posts/stories: PRIVADOS -> se sirven con signed URLs.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public) values
  ('avatars', 'avatars', true),
  ('posts',   'posts',   false),
  ('stories', 'stories', false)
on conflict (id) do nothing;

-- Solo puedes subir dentro de tu propia carpeta
create policy "storage: subir propio" on storage.objects for insert to authenticated
  with check (bucket_id in ('avatars', 'posts', 'stories')
              and (storage.foldername(name))[1] = auth.uid()::text);

create policy "storage: borrar propio" on storage.objects for delete to authenticated
  using (bucket_id in ('avatars', 'posts', 'stories')
         and (storage.foldername(name))[1] = auth.uid()::text);

-- Leer (y firmar URLs) de imágenes privadas: misma regla de privacidad que los posts
create policy "storage: leer contenido visible" on storage.objects for select to authenticated
  using (bucket_id in ('posts', 'stories')
         and public.can_view_content(((storage.foldername(name))[1])::uuid));
