-- =====================================================================
-- 0002 — Endurecimiento y utilidades del módulo 1
-- Se ejecuta DESPUÉS de 0001 (pégalo en el SQL Editor y Run).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Contadores de perfil (posts / seguidores / seguidos)
-- En Instagram los NÚMEROS son públicos aunque la cuenta sea privada;
-- lo privado son las LISTAS. Por RLS, un no-seguidor contaría 0 filas,
-- así que exponemos solo los conteos con SECURITY DEFINER.
-- Esta función no devuelve ningún dato sensible: solo tres números.
-- ---------------------------------------------------------------------
create or replace function public.get_profile_stats(p_user_id uuid)
returns table (posts_count bigint, followers_count bigint, following_count bigint)
language sql stable security definer
set search_path = public
as $$
  select
    (select count(*) from public.posts   where author_id    = p_user_id),
    (select count(*) from public.follows where following_id = p_user_id and status = 'accepted'),
    (select count(*) from public.follows where follower_id  = p_user_id and status = 'accepted');
$$;

-- ---------------------------------------------------------------------
-- 2. Mínimo privilegio sobre funciones
-- Postgres da EXECUTE a PUBLIC por defecto. Lo quitamos y lo damos
-- solo a usuarios autenticados (anon = cualquiera sin login).
-- ---------------------------------------------------------------------
revoke execute on function public.get_profile_stats(uuid) from public, anon;
grant  execute on function public.get_profile_stats(uuid) to authenticated;

revoke execute on function public.can_view_content(uuid) from public, anon;
grant  execute on function public.can_view_content(uuid) to authenticated;

revoke execute on function public.get_feed(timestamptz, uuid, int) from public, anon;
grant  execute on function public.get_feed(timestamptz, uuid, int) to authenticated;

-- ---------------------------------------------------------------------
-- 3. Si una cuenta pasa de privada a pública, sus solicitudes
-- pendientes se aceptan automáticamente (comportamiento de Instagram).
-- ---------------------------------------------------------------------
create or replace function public.accept_pending_on_public()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if old.is_private and not new.is_private then
    update public.follows
       set status = 'accepted'
     where following_id = new.id and status = 'pending';
  end if;
  return new;
end;
$$;

create trigger trg_accept_pending_on_public
  after update of is_private on public.profiles
  for each row execute function public.accept_pending_on_public();

-- ---------------------------------------------------------------------
-- 4. Límites de Storage (los aplica Supabase incluso con signed upload URLs)
-- Evita que alguien suba un archivo de 2 GB o un .exe disfrazado.
-- ---------------------------------------------------------------------
update storage.buckets
   set file_size_limit    = 5 * 1024 * 1024,                         -- 5 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id in ('posts', 'stories');

update storage.buckets
   set file_size_limit    = 2 * 1024 * 1024,                         -- 2 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';

-- ---------------------------------------------------------------------
-- 5. Comentarios en tiempo real (módulo 1: "comentarios en tiempo real")
-- Realtime aplica el RLS de comments: solo recibes los de posts que puedes ver.
-- ---------------------------------------------------------------------
alter publication supabase_realtime add table public.comments;
