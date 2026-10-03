-- 22 pruebas de seguridad RLS: se actúa como Ana, Pedro y Luis e intenta
-- lo permitido y lo prohibido. Orden: 00_supabase_shim.sql -> migraciones 0001..0003 -> este archivo.
-- Ejemplo: psql -d prueba -f tests/00_supabase_shim.sql -f migrations/0001_init.sql ... -f tests/rls_test.sql
\set ON_ERROR_STOP 1
\set QUIET 1
-- Usuarios: Ana (privada), Pedro, Luis
insert into auth.users values
 ('aaaaaaaa-0000-0000-0000-000000000001', '{"username":"ana"}'),
 ('bbbbbbbb-0000-0000-0000-000000000002', '{"username":"pedro"}'),
 ('cccccccc-0000-0000-0000-000000000003', '{"username":"luis"}');
update profiles set is_private = true where username = 'ana';
insert into posts (id, author_id, image_path) values ('11111111-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/x.jpg');

create schema t_helpers;
grant usage on schema t_helpers to authenticated;
create function t_helpers.as_user(u text) returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', u, false); end $$;
create function t_helpers.ok(label text) returns void language plpgsql as $$
begin raise notice '✅ %', label; end $$;
grant execute on all functions in schema t_helpers to authenticated;

-- ===================== MÓDULO 1: privacidad =====================
select t_helpers.as_user('bbbbbbbb-0000-0000-0000-000000000002'); set role authenticated;
do $$ begin
  assert (select count(*) from posts) = 0, 'Pedro NO debería ver posts de Ana (privada)';
  perform t_helpers.ok('1. Pedro (no seguidor) no ve los posts de la cuenta privada de Ana');
  insert into follows (follower_id, following_id, status) values (auth.uid(), 'aaaaaaaa-0000-0000-0000-000000000001', 'accepted');
  assert (select status from follows where following_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 'pending', 'el trigger debe forzar pending';
  perform t_helpers.ok('2. Pedro envía "accepted" pero el trigger lo deja en pending');
  update follows set status = 'accepted' where follower_id = auth.uid();
  assert (select status from follows where follower_id = auth.uid()) = 'pending', 'Pedro no puede auto-aprobarse';
  perform t_helpers.ok('3. Pedro no puede aprobar su propia solicitud (RLS)');
  assert (select count(*) from posts) = 0;
  perform t_helpers.ok('4. Con solicitud pendiente sigue sin ver nada');
  begin
    insert into posts (author_id, image_path) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x/y.jpg');
    raise exception 'NO debía poder publicar como Ana';
  exception when insufficient_privilege then perform t_helpers.ok('5. Pedro no puede publicar haciéndose pasar por Ana');
  end;
  begin
    insert into storage.objects (bucket_id, name) values ('posts', 'aaaaaaaa-0000-0000-0000-000000000001/hack.jpg');
    raise exception 'NO debía poder subir a la carpeta de Ana';
  exception when insufficient_privilege then perform t_helpers.ok('6. Pedro no puede subir archivos a la carpeta de Ana en Storage');
  end;
end $$;
reset role;

select t_helpers.as_user('aaaaaaaa-0000-0000-0000-000000000001'); set role authenticated;
do $$ begin
  update follows set status = 'accepted' where following_id = auth.uid() and status = 'pending';
  assert found, 'Ana debe poder aprobar';
  perform t_helpers.ok('7. Ana aprueba la solicitud');
end $$;
reset role;

select t_helpers.as_user('bbbbbbbb-0000-0000-0000-000000000002'); set role authenticated;
do $$ begin
  assert (select count(*) from posts) = 1, 'tras aprobar, Pedro ve el post';
  assert (select count(*) from get_feed()) = 1, 'y aparece en su feed';
  perform t_helpers.ok('8. Tras aprobar: Pedro ve el post y le aparece en el feed');
  insert into likes (post_id, user_id) values ('11111111-0000-0000-0000-000000000001', auth.uid());
  begin
    insert into likes (post_id, user_id) values ('11111111-0000-0000-0000-000000000001', auth.uid());
    raise exception 'like duplicado NO debía insertarse';
  exception when unique_violation then perform t_helpers.ok('9. Like duplicado imposible (PK compuesta)');
  end;
end $$;
reset role;

select t_helpers.as_user('cccccccc-0000-0000-0000-000000000003'); set role authenticated;
do $$ begin
  begin
    insert into comments (id, post_id, user_id, body) values (gen_random_uuid(), '11111111-0000-0000-0000-000000000001', auth.uid(), 'hola');
    raise exception 'Luis NO debía comentar un post privado que no ve';
  exception when insufficient_privilege then perform t_helpers.ok('10. Luis (no seguidor) no puede comentar el post privado');
  end;
  assert (select count(*) from follows where following_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'Luis no ve la lista de seguidores de Ana';
  perform t_helpers.ok('11. Luis no ve la lista de seguidores de la cuenta privada');
  assert (select followers_count from get_profile_stats('aaaaaaaa-0000-0000-0000-000000000001')) = 1;
  perform t_helpers.ok('12. Pero sí ve el NÚMERO de seguidores (como Instagram)');
end $$;
reset role;

-- ===================== MÓDULO 4: mensajes =====================
insert into conversations (id, user_a, user_b) values ('22222222-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'cccccccc-0000-0000-0000-000000000003');
select t_helpers.as_user('cccccccc-0000-0000-0000-000000000003'); set role authenticated;
do $$ begin
  insert into messages (id, conversation_id, sender_id, body) values ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', auth.uid(), 'Hola Pedro');
  update messages set read_at = now() where id = '33333333-0000-0000-0000-000000000001';
  assert (select read_at from messages where id = '33333333-0000-0000-0000-000000000001') is null, 'el remitente no puede marcar su propio Visto';
  perform t_helpers.ok('13. Luis no puede marcar como "Visto" su propio mensaje');
end $$;
reset role;

select t_helpers.as_user('aaaaaaaa-0000-0000-0000-000000000001'); set role authenticated;
do $$ begin
  assert (select count(*) from messages) = 0 and (select count(*) from get_inbox()) = 0, 'Ana no ve chats ajenos';
  perform t_helpers.ok('14. Ana no ve mensajes ni la conversación de Pedro y Luis');
  begin
    insert into messages (id, conversation_id, sender_id, body) values (gen_random_uuid(), '22222222-0000-0000-0000-000000000001', auth.uid(), 'intrusa');
    raise exception 'Ana NO debía escribir en un chat ajeno';
  exception when insufficient_privilege then perform t_helpers.ok('15. Ana no puede escribir en un chat ajeno');
  end;
  perform set_config('realtime.topic', 'typing:22222222-0000-0000-0000-000000000001', false);
  begin
    insert into realtime.messages (topic, extension) values (realtime.topic(), 'broadcast');
    raise exception 'Ana NO debía emitir "escribiendo" en un chat ajeno';
  exception when insufficient_privilege then perform t_helpers.ok('16. Ana no puede unirse al canal privado de "Escribiendo…" ajeno');
  end;
end $$;
reset role;

select t_helpers.as_user('bbbbbbbb-0000-0000-0000-000000000002'); set role authenticated;
do $$ declare r record; begin
  select * into r from get_inbox();
  assert r.other_username = 'luis' and r.unread_count = 1 and r.last_body = 'Hola Pedro', 'bandeja de Pedro';
  perform t_helpers.ok('17. Bandeja de Pedro: chat con luis, último mensaje y 1 sin leer');
  update messages set delivered_at = now(), read_at = now() where sender_id <> auth.uid() and read_at is null;
  assert (select count(*) from get_inbox() where unread_count = 0) = 1;
  perform t_helpers.ok('18. Pedro marca entregado y "Visto": 0 sin leer');
  begin
    update messages set body = 'texto alterado' where id = '33333333-0000-0000-0000-000000000001';
    raise exception 'Pedro NO debía poder editar el texto';
  exception when insufficient_privilege then perform t_helpers.ok('19. Pedro no puede alterar el TEXTO del mensaje (GRANT por columna)');
  end;
  perform set_config('realtime.topic', 'typing:22222222-0000-0000-0000-000000000001', false);
  insert into realtime.messages (topic, extension) values (realtime.topic(), 'broadcast');
  perform t_helpers.ok('20. Pedro (participante) sí puede emitir "Escribiendo…"');
end $$;
reset role;

do $$ declare t1 timestamptz; t2 timestamptz; begin
  select last_message_at into t1 from conversations;
  perform pg_sleep(0.05);
  insert into messages (id, conversation_id, sender_id, body) values (gen_random_uuid(), '22222222-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000002', 'otro');
  select last_message_at into t2 from conversations;
  assert t2 > t1, 'el trigger debe subir last_message_at';
  raise notice '✅ 21. Cada mensaje nuevo actualiza last_message_at (orden de la bandeja)';
end $$;

-- ===================== Cuenta privada -> pública =====================
insert into follows (follower_id, following_id) values ('cccccccc-0000-0000-0000-000000000003', 'aaaaaaaa-0000-0000-0000-000000000001');
update profiles set is_private = false where username = 'ana';
do $$ begin
  assert (select status from follows where follower_id = 'cccccccc-0000-0000-0000-000000000003') = 'accepted';
  raise notice '✅ 22. Al volverse pública, las solicitudes pendientes se aceptan solas';
end $$;

-- ===================== MÓDULO 5: historias de 24 h =====================
insert into stories (author_id, image_path, created_at, expires_at) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/vieja.jpg', now() - interval '25 hours', now() - interval '1 hour'),
  ('aaaaaaaa-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001/nueva.jpg', now(), now() + interval '24 hours');
update profiles set is_private = true where username = 'ana';
select t_helpers.as_user('bbbbbbbb-0000-0000-0000-000000000002'); set role authenticated;
do $$ begin
  assert (select count(*) from stories) = 1 and (select image_path from stories) like '%nueva.jpg', 'Pedro (seguidor) ve solo la vigente';
  perform t_helpers.ok('23. Una historia de hace 25 h es ILEGIBLE aunque se consulte directo (RLS + expires_at)');
end $$;
reset role;
-- Luis siguió a Ana cuando era pública (quedó aceptado): quitamos esa relación para probar a un NO seguidor.
delete from follows where follower_id = 'cccccccc-0000-0000-0000-000000000003';
select t_helpers.as_user('cccccccc-0000-0000-0000-000000000003'); set role authenticated;
do $$ begin
  assert (select count(*) from stories) = 0, 'Luis (no seguidor) no ve historias de la cuenta privada';
  perform t_helpers.ok('24. Las historias de una cuenta privada solo las ven sus seguidores');
end $$;
reset role;
