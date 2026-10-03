-- =====================================================================
-- 0003 — Módulo 4: mensajería directa
-- Ejecutar DESPUÉS de 0002 (SQL Editor -> pegar -> Run).
-- Las tablas conversations/messages, su RLS, el trigger de last_message_at
-- y la publicación Realtime de messages ya existen desde 0001.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. BANDEJA DE ENTRADA en una sola consulta
-- Por cada conversación mía: el otro usuario, el último mensaje y cuántos
-- mensajes suyos no he leído. Ordenada por last_message_at (el trigger
-- bump_conversation lo actualiza en cada mensaje nuevo).
-- SECURITY INVOKER: corre con MIS permisos -> el RLS filtra solo mis conversaciones.
-- ---------------------------------------------------------------------
create or replace function public.get_inbox()
returns table (
  conversation_id   uuid,
  last_message_at   timestamptz,
  other_id          uuid,
  other_username    text,
  other_full_name   text,
  other_avatar_path text,
  last_body         text,
  last_sender_id    uuid,
  last_created_at   timestamptz,
  last_read_at      timestamptz,
  unread_count      bigint
)
language sql stable security invoker
set search_path = public
as $$
  select c.id, c.last_message_at,
         o.id, o.username, o.full_name, o.avatar_path,
         lm.body, lm.sender_id, lm.created_at, lm.read_at,
         (select count(*) from public.messages m
           where m.conversation_id = c.id
             and m.sender_id <> auth.uid()
             and m.read_at is null)
  from public.conversations c
  join public.profiles o
    on o.id = case when c.user_a = auth.uid() then c.user_b else c.user_a end
  -- LATERAL: "para cada conversación, trae su último mensaje" (usa el índice messages_conv_idx)
  left join lateral (
    select m.body, m.sender_id, m.created_at, m.read_at
    from public.messages m
    where m.conversation_id = c.id
    order by m.created_at desc
    limit 1
  ) lm on true
  where auth.uid() in (c.user_a, c.user_b)
    and lm.created_at is not null          -- no mostrar conversaciones vacías
  order by c.last_message_at desc
  limit 100;
$$;

revoke execute on function public.get_inbox() from public, anon;
grant  execute on function public.get_inbox() to authenticated;

-- ---------------------------------------------------------------------
-- 2. CORRECCIÓN DE PRIVACIDAD en follows (hallada con pruebas RLS)
-- Antes: una relación aceptada era visible si podías ver a CUALQUIERA de las dos
-- cuentas (OR). Problema: si Pedro (público) sigue a Ana (privada), cualquiera podía
-- consultar "follows where following_id = Ana" y ver a Pedro: así se reconstruía
-- la lista de seguidores de una cuenta privada saltándose la API.
-- Ahora: debes poder ver a AMBAS cuentas (AND). Las relaciones propias siguen visibles,
-- y los CONTADORES no cambian (get_profile_stats es SECURITY DEFINER).
-- ---------------------------------------------------------------------
drop policy "follows: ver" on public.follows;
create policy "follows: ver" on public.follows for select to authenticated using (
  follower_id = auth.uid()
  or following_id = auth.uid()
  or (status = 'accepted'
      and public.can_view_content(following_id)
      and public.can_view_content(follower_id))
);

-- ---------------------------------------------------------------------
-- 3. "Escribiendo..." con canales PRIVADOS de Realtime (Broadcast)
-- El evento de typing NO se guarda en ninguna tabla (es efímero).
-- Pero tampoco debe poder escucharlo cualquiera: estas políticas sobre
-- realtime.messages hacen que solo los DOS participantes puedan unirse
-- al canal 'typing:<conversation_id>', escuchar y enviar.
-- ---------------------------------------------------------------------
create policy "typing: participantes escuchan"
on realtime.messages for select to authenticated
using (
  realtime.messages.extension in ('broadcast')
  and exists (
    select 1 from public.conversations c
    where 'typing:' || c.id::text = (select realtime.topic())
      and (select auth.uid()) in (c.user_a, c.user_b)
  )
);

create policy "typing: participantes envían"
on realtime.messages for insert to authenticated
with check (
  realtime.messages.extension in ('broadcast')
  and exists (
    select 1 from public.conversations c
    where 'typing:' || c.id::text = (select realtime.topic())
      and (select auth.uid()) in (c.user_a, c.user_b)
  )
);
