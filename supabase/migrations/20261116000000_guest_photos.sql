-- Hurra hotfix: guest photos (docs/guest-photos.md).
--
-- Additive on top of the v2 init file and the TV sound volume hotfix
-- (20261115230000_tv_sound_volume.sql): a photo column on players, written
-- only by set_my_photo (the guest) and host_remove_photo (the host), and the
-- time the guest last set one (set_my_photo's throttle); a public
-- player-photos bucket whose paths name the party and the player
-- (<session id>/<player id>/<random uuid>.jpg); a log row and a ping whenever
-- a photo changes; the photo in session_snapshot's players. Nothing existing
-- is dropped, and no existing row changes.
--
-- Rules as in the init file (docs/engine-v2.md, 2.1): set search_path = '' and
-- fully qualified names, security definer only where a function must read or
-- write past row level security, every function revoked and then granted
-- exactly, and a copy of the self-checks at the end, updated for this file.
-- The file holds no data: no user ids, no emails, no project refs.

-- A busy players table makes this wait at most 5 s; then the whole file rolls
-- back and nothing is applied. Push again a minute later.
set lock_timeout = '5s';

-- 1. Helpers ---------------------------------------------------------------------

-- The one shape of a photo path: <session id>/<player id>/<random uuid>.jpg,
-- lower case, as Postgres prints a uuid and crypto.randomUUID makes one.
create function public.is_photo_path(p_path text) returns boolean
language sql immutable parallel safe set search_path = '' as $$
  select coalesce(p_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$', false)
$$;

-- Whether a path is in the folder of a player the caller owns. The folder
-- follows the player, not the uploader: after "Move to a new phone" the new
-- phone owns the photos and the old one owns nothing.
create function public.owns_photo_path(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_photo_path(p_path) and exists (
    select 1 from public.players p
    where p.id = public.try_uuid(split_part(p_path, '/', 2))
      and p.session_id = public.try_uuid(split_part(p_path, '/', 1))
      and p.user_id = auth.uid())
$$;

-- An upload is allowed into the caller's own folder, while the party is on,
-- with fewer than 10 files there. The app keeps one; the cap only stops the
-- app and a simple script, because Storage checks it once per request, so
-- uploads sent in parallel each see the folder before the others land.
create function public.may_upload_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.owns_photo_path(p_path)
    and exists (select 1 from public.sessions s
                where s.id = public.try_uuid(split_part(p_path, '/', 1)) and s.archived_at is null)
    and (select count(*) from storage.objects o
         where o.bucket_id = 'player-photos'
           and o.name like split_part(p_path, '/', 1) || '/' || split_part(p_path, '/', 2) || '/%') < 10
$$;

-- 2. The columns -------------------------------------------------------------------
-- photo: the path, null for no photo. photo_set_at: when the guest last set a
-- photo, for set_my_photo's throttle. Neither is in a client grant: only the
-- two functions below write them. The check uses built-in operators only, so a
-- host's rename and the engine's profile updates (which re-check every
-- constraint of the row) need no new grant.

alter table public.players add column photo text;
alter table public.players add column photo_set_at timestamptz;
alter table public.players add constraint players_photo_path check (
  photo is null
  or (photo ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
      and split_part(photo, '/', 1) = session_id::text
      and split_part(photo, '/', 2) = id::text));

-- The delete policy's helper (5), here because it reads the photo column: an
-- owner may delete any file in their folder but the one their player's photo
-- points at. Otherwise they could delete it and upload other bytes to the
-- same path after set_my_photo checked it, and every screen would show them.
-- The app always moves or clears the photo before it deletes the file.
create function public.may_delete_photo(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.owns_photo_path(p_path) and not exists (
    select 1 from public.players p
    where p.id = public.try_uuid(split_part(p_path, '/', 2)) and p.photo = p_path)
$$;

-- 3. The log row and the ping ------------------------------------------------------
-- That a photo changed, never which file: the log is the night's story, and
-- the host's "Download the night" must not carry links to guests' faces.
-- A guest's own change pings the stage (the TV and the host page; other
-- phones see it at their next poll), as a join does; a host's removal and the
-- deletion script ping the room, so a removed photo goes from every screen at
-- once. Fails open like the other logging triggers.

create function public.log_player_photo() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_own boolean;
  v_host boolean;
begin
  if new.photo is not distinct from old.photo then
    return null;
  end if;
  begin
    v_own := new.user_id = v_uid;
    v_host := public.is_host();
    insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
    values (new.session_id, 'player.photo_changed',
      case when v_own then 'player' when v_host then 'host' else 'system' end,
      new.id, v_uid, array[new.id],
      jsonb_build_object('name', new.name, 'player_id', new.id,
        'change', case when old.photo is null then 'added' when new.photo is null then 'removed' else 'replaced' end));
    perform public.ping_session(new.session_id, case when v_own and not v_host then 'stage' else 'room' end);
  exception when others then
    raise warning 'Hurra event log (player photos): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
create trigger players_photo_logged after update of photo on public.players
  for each row execute function public.log_player_photo();

-- 4. Client RPCs ---------------------------------------------------------------------

-- A guest sets (a path) or removes (null) their own photo. The file must
-- already be uploaded into their folder, labelled image/jpeg, no bigger than
-- the app's encoder ever makes (48 KB), and stored as the app uploads it: no
-- content coding, cached an hour. A new photo at most every 10 s,
-- since every change writes a log row and pings: removing is never throttled,
-- and setting the photo the player already has changes nothing. Returns the
-- photo and the one it replaced, so the phone can delete the old file.
create function public.set_my_photo(p_player_id uuid, p_path text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_player public.players;
  v_path text := nullif(btrim(coalesce(p_path, '')), '');
  v_wait interval;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'PT401', detail = 'not_signed_in';
  end if;
  -- Only the caller's own row, and "for no key update": a photo save never
  -- waits on game_commit's key share lock of the party's players, and nobody
  -- can lock another guest's row by passing its id.
  select * into v_player from public.players where id = p_player_id and user_id = v_uid for no key update;
  if not found then
    raise exception 'That isn''t your player' using errcode = 'PT403', detail = 'not_your_player';
  end if;
  if v_path is not null then
    if exists (select 1 from public.sessions s where s.id = v_player.session_id and s.archived_at is not null) then
      raise exception 'This party is over' using errcode = 'PT409', detail = 'archived';
    end if;
    if not public.is_photo_path(v_path)
       or split_part(v_path, '/', 1) <> v_player.session_id::text
       or split_part(v_path, '/', 2) <> v_player.id::text then
      raise exception 'That photo isn''t in your folder' using errcode = 'PT400', detail = 'bad_path';
    end if;
    if v_path = v_player.photo then
      return jsonb_build_object('photo', v_path, 'previous', v_player.photo);
    end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'player-photos' and o.name = v_path) then
      raise exception 'Upload the photo first' using errcode = 'PT409', detail = 'not_uploaded';
    end if;
    -- Storage compares only the type a client states, so the stored label and
    -- size are checked here too: only a file the app's encoder could have made
    -- is ever shown. Storage also keeps the uploader's content coding and
    -- cache time and serves them: a few KB of brotli can unpack to gigabytes
    -- in every screen's browser, and a year's cache time would keep a removed
    -- photo on the CDN for a year. The app's uploads have no coding and an hour.
    if not exists (select 1 from storage.objects o
                   where o.bucket_id = 'player-photos' and o.name = v_path
                     and o.metadata ->> 'mimetype' = 'image/jpeg'
                     and o.metadata ->> 'contentEncoding' is null
                     and o.metadata ->> 'cacheControl' = 'max-age=3600'
                     and case when jsonb_typeof(o.metadata -> 'size') = 'number'
                              then (o.metadata -> 'size')::numeric between 1 and 49152 else false end) then
      raise exception 'That file can''t be a photo here' using errcode = 'PT415', detail = 'bad_file';
    end if;
    v_wait := v_player.photo_set_at + interval '10 seconds' - clock_timestamp();
    if v_wait > interval '0' then
      raise exception 'Wait a moment before changing your photo again' using errcode = 'PT429', detail = 'too_soon',
        hint = ceil(extract(epoch from v_wait) * 1000)::bigint::text;
    end if;
  end if;
  -- The players_photo_logged trigger logs the change and pings.
  update public.players
  set photo = v_path, photo_set_at = case when v_path is null then photo_set_at else clock_timestamp() end
  where id = v_player.id and photo is distinct from v_path;
  return jsonb_build_object('photo', v_path, 'previous', v_player.photo);
end;
$$;

-- The host takes a guest's photo down (the player menu's Remove photo). The
-- guest may add another. Returns the photo it removed, so the host page can
-- delete the file.
create function public.host_remove_photo(p_player_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_old text;
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  select photo into v_old from public.players where id = p_player_id for no key update;
  if not found then
    raise exception 'That player isn''t in the party any more' using errcode = 'PT404', detail = 'not_found';
  end if;
  update public.players set photo = null where id = p_player_id and photo is not null;
  return jsonb_build_object('photo', null, 'previous', v_old);
end;
$$;

-- The snapshot, as the TV sound volume hotfix left it (the init file's, section
-- 9, with the session's sound_volume), with each player's photo. Only the
-- players line differs: 'photo', p.photo. Runs as the caller, so row level
-- security decides what each screen gets. Every time is epoch ms.
create or replace function public.session_snapshot(p_session_id uuid, p_screen text) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v_now timestamptz := now();
  v_host boolean := public.is_host();
  v_exists boolean := public.session_exists(p_session_id);
  v_member boolean;
  v_session public.sessions;
  v_me uuid;
  v_active uuid[];
  v_shown uuid[];
begin
  if p_screen is null or p_screen not in ('phone', 'tv', 'host') then
    raise exception 'p_screen must be phone, tv or host' using errcode = 'PT400', detail = 'bad_request';
  end if;
  v_member := v_exists and (v_host or p_session_id = any (public.my_session_ids()));
  if v_member then
    select * into v_session from public.sessions where id = p_session_id;
    v_member := found;
  end if;
  if not v_member then
    return jsonb_build_object('now', public.epoch_ms(v_now), 'member', false, 'exists', v_exists, 'session', null,
      'games', '[]'::jsonb, 'prompts', '[]'::jsonb, 'tallies', '{}'::jsonb, 'game_points', '{}'::jsonb,
      'players', '[]'::jsonb, 'standings', '[]'::jsonb, 'feed', '[]'::jsonb,
      'me', null, 'states', null, 'screens', null, 'recap', null,
      'moved', v_exists and p_screen = 'phone' and public.moved_away(p_session_id));
  end if;

  select coalesce(array_agg(g.id), '{}') into v_active
  from public.session_games g where g.session_id = p_session_id and g.status = 'active';

  -- The shown games: active, the spotlit one, finished in the last 60 minutes,
  -- and the most recently finished one, so a phone's result card always has its data.
  select coalesce(array_agg(g.id), '{}') into v_shown
  from public.session_games g
  where g.session_id = p_session_id and (
    g.status = 'active'
    or g.id = v_session.spotlight_game_id
    or (g.status = 'finished' and g.finished_at > v_now - interval '60 minutes')
    or g.id = (select l.id from public.session_games l
               where l.session_id = p_session_id and l.status = 'finished' and l.archived_at is null
               order by l.finished_at desc, l.id limit 1));

  if p_screen = 'phone' then
    select p.id into v_me from public.players p where p.session_id = p_session_id and p.user_id = auth.uid();
  end if;

  return jsonb_build_object(
    'now', public.epoch_ms(v_now),
    'member', true,
    'exists', true,
    'moved', false,
    'session', jsonb_build_object('id', v_session.id, 'name', v_session.name, 'join_code', v_session.join_code,
      'status', v_session.status, 'data', v_session.data, 'spotlight_game_id', v_session.spotlight_game_id,
      'spotlight_at', public.epoch_ms(v_session.spotlight_at), 'tv_scene', v_session.tv_scene,
      'sound_volume', v_session.sound_volume,
      'archived_at', public.epoch_ms(v_session.archived_at), 'created_at', public.epoch_ms(v_session.created_at)),
    'games', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', g.id, 'game_type', g.game_type, 'title', g.title, 'position', g.position, 'status', g.status,
        'public_state', case when g.id = any (v_shown) then g.public_state end,
        'started_at', public.epoch_ms(g.started_at), 'finished_at', public.epoch_ms(g.finished_at),
        'finished_by', g.finished_by, 'winners', to_jsonb(g.winners), 'wake_at', public.epoch_ms(g.wake_at),
        'archived_at', public.epoch_ms(g.archived_at), 'created_at', public.epoch_ms(g.created_at))
        order by g.position, g.created_at, g.id), '[]'::jsonb)
      from public.session_games g where g.session_id = p_session_id),
    'prompts', (select coalesce(jsonb_agg(jsonb_build_object(
        'game_id', pr.game_id, 'key', pr.key, 'spec', pr.spec, 'opened_at', public.epoch_ms(pr.opened_at),
        'closes_at', public.epoch_ms(pr.closes_at), 'closed_at', public.epoch_ms(pr.closed_at),
        'revealed_at', public.epoch_ms(pr.revealed_at))
        order by pr.opened_at, pr.key), '[]'::jsonb)
      from public.game_prompts pr where pr.game_id = any (v_active)),
    'tallies', public.prompt_tallies(p_session_id),
    -- This round's points per game: its scores plus its awards and bonuses.
    'game_points', (select coalesce(jsonb_object_agg(x.game_id, x.points), '{}'::jsonb) from (
        select y.game_id, jsonb_object_agg(y.player_id, y.points) as points from (
          select z.game_id, z.player_id, sum(z.points)::int as points from (
            select gs.game_id, gs.player_id, gs.points from public.game_scores gs where gs.game_id = any (v_shown)
            union all
            select se.game_id, se.player_id, se.points
            from public.score_events se join public.session_games g on g.id = se.game_id
            where se.game_id = any (v_shown) and se.created_at >= g.started_at
          ) z group by z.game_id, z.player_id
        ) y group by y.game_id
      ) x),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code,
        'profile', p.profile, 'photo', p.photo, 'created_at', public.epoch_ms(p.created_at)) order by p.created_at, p.id), '[]'::jsonb)
      from public.players p where p.session_id = p_session_id),
    'standings', (select coalesce(jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', b.name,
        'code', b.code, 'points', b.points, 'profile', b.profile) order by b.points desc, b.name, b.player_id), '[]'::jsonb)
      from public.scoreboard b where b.session_id = p_session_id),
    -- The newest 12 the caller may read; the TV and the host page get room-wide ones only.
    'feed', (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'game_id', f.game_id, 'message', f.message,
        'detail', f.detail, 'audience', to_jsonb(f.audience), 'sound', f.sound, 'icon', f.icon, 'tone', f.tone,
        'interrupt', f.interrupt, 'created_at', public.epoch_ms(f.created_at)) order by f.id desc), '[]'::jsonb)
      from (select * from public.session_feed f0
            where f0.session_id = p_session_id
              and (f0.audience is null or (p_screen = 'phone' and v_me is not null and f0.audience && array[v_me]))
            order by f0.id desc limit 12) f),
    'me', case when p_screen = 'phone' and v_me is not null then jsonb_build_object(
        'player_id', v_me,
        'views', (select coalesce(jsonb_object_agg(v.game_id, v.view), '{}'::jsonb)
          from public.game_player_views v where v.player_id = v_me and v.game_id = any (v_shown)),
        'answers', (select coalesce(jsonb_object_agg(a.game_id, a.answers), '{}'::jsonb) from (
            select s.game_id, jsonb_object_agg(s.key, s.payload) as answers from public.game_submissions s
            where s.player_id = v_me and s.game_id = any (v_active) group by s.game_id) a))
      end,
    'states', case when p_screen = 'host' and v_host then (
        select coalesce(jsonb_object_agg(st.game_id, jsonb_build_object('state', st.state, 'config', st.config,
          'round', st.round, 'members', to_jsonb(st.members))), '{}'::jsonb)
        from public.game_states st where st.game_id = any (v_active))
      end,
    'screens', case when p_screen = 'host' and v_host then (
        select count(*) from public.session_screens sc where sc.session_id = p_session_id)
      end,
    'recap', (select jsonb_build_object('published_at', public.epoch_ms(r.published_at))
      from public.session_recaps r where r.session_id = p_session_id and r.published_at is not null)
  );
end;
$$;

-- 5. Storage: player-photos ---------------------------------------------------------
-- Public, so the TV (8 hours) and sleeping phones never hold a link that
-- expires; the random file name keeps a URL unguessable, and only members
-- see paths (session_snapshot). 64 KB and image/jpeg only: the browser
-- re-encodes every photo to a 320 px square of about 25 KB first
-- (src/lib/media.ts), so a raw camera file is refused. Storage compares only
-- the type a client states, never the bytes: so the insert policy refuses a
-- copy given another type, set_my_photo checks the stored label, size, coding
-- and cache time, and screens measure a photo before they draw it. The file a
-- photo points at never changes: there is no update policy, the insert policy
-- refuses to sign an upload URL (its uploads run later as the storage admin,
-- upserts included, so they could overwrite a file), and its owner can't
-- delete it to upload other bytes in its place (may_delete_photo). Every file
-- is deleted after the party (scripts/delete-photos.ts).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('player-photos', 'player-photos', true, 65536, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- An upload states its type and its content coding in the metadata Storage
-- tests the policy with; a copy states the ones it asks for, so a copy given
-- another type is refused, and so is any stated coding. Storage names the
-- request in storage.operation() (empty outside the Storage API), so the
-- test that signs an upload URL is refused too.
drop policy if exists "Guests add their own photo" on storage.objects;
create policy "Guests add their own photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'player-photos'
              and coalesce(metadata ->> 'mimetype', 'image/jpeg') = 'image/jpeg'
              and coalesce(metadata ->> 'contentEncoding', '') = ''
              and coalesce(storage.operation(), '') <> 'storage.object.sign_upload_url'
              and public.may_upload_photo(name));
-- Storage needs this one before a delete can find the file; it also lets the
-- owner list their own folder. Hosts see every folder (moderation, cleanup).
drop policy if exists "Owners and hosts see player photos" on storage.objects;
create policy "Owners and hosts see player photos" on storage.objects
  for select to authenticated
  using (bucket_id = 'player-photos' and ((select public.is_host()) or public.owns_photo_path(name)));
-- The owner deletes any of their files but the one their photo points at;
-- hosts delete any (Remove photo, removing a guest or a party).
drop policy if exists "Owners and hosts delete player photos" on storage.objects;
create policy "Owners and hosts delete player photos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'player-photos' and ((select public.is_host()) or public.may_delete_photo(name)));

-- 6. Function grants: everything revoked, then exactly what each role needs ---------------

revoke execute on function
  public.is_photo_path(text), public.owns_photo_path(text), public.may_upload_photo(text),
  public.may_delete_photo(text), public.log_player_photo(), public.set_my_photo(uuid, text),
  public.host_remove_photo(uuid), public.session_snapshot(uuid, text)
from public, anon, authenticated;

-- Helpers: the storage policies run as the caller.
grant execute on function public.is_photo_path(text), public.owns_photo_path(text), public.may_upload_photo(text),
  public.may_delete_photo(text)
to authenticated, service_role;

-- What the app calls.
grant execute on function public.set_my_photo(uuid, text), public.host_remove_photo(uuid), public.session_snapshot(uuid, text)
to authenticated, service_role;

-- PostgREST reloads its schema cache on DDL by itself (pgrst_ddl_watch); this
-- makes sure the two new RPCs answer the moment the file commits.
notify pgrst, 'reload schema';

-- 7. Self-checks: the TV sound volume hotfix's, updated for this file --------------------
-- From here on this block is the current one: a later hotfix copies it, not the init's
-- or the sound volume hotfix's.

do $$
declare
  v_problems text[] := '{}';
  v_name text;
  r record;
begin
  -- Row level security on every table.
  for r in
    select c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity
  loop
    v_problems := v_problems || format('row level security is off on %s', r.relname);
  end loop;

  -- Schema usage.
  foreach v_name in array array['anon', 'authenticated', 'service_role'] loop
    if not has_schema_privilege(v_name, 'public', 'usage') then
      v_problems := v_problems || format('%s lacks usage on schema public', v_name);
    end if;
  end loop;

  -- anon: nothing on any table, view or sequence.
  for r in
    select c.oid, c.relname, c.relkind from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  loop
    if r.relkind = 'S' then
      if has_sequence_privilege('anon', r.oid, 'usage,select,update') then
        v_problems := v_problems || format('anon has a privilege on sequence %s', r.relname);
      end if;
    elsif has_table_privilege('anon', r.oid, 'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('anon', r.oid, 'select,insert,update,references') then
      v_problems := v_problems || format('anon has a privilege on %s', r.relname);
    end if;
  end loop;

  -- Functions (extension functions skipped).
  for r in
    select p.oid, p.proname, p.prorettype from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    if r.proname <> 'keep_alive' and has_function_privilege('anon', r.oid, 'execute') then
      v_problems := v_problems || format('anon can execute %s', r.proname);
    end if;
    if (r.proname in ('game_load', 'game_commit', 'ping', 'ping_session', 'ping_player', 'check_answer')
        or r.prorettype = 'trigger'::regtype)
       and has_function_privilege('authenticated', r.oid, 'execute') then
      v_problems := v_problems || format('authenticated can execute %s', r.proname);
    end if;
    if r.proname in ('game_load', 'game_commit', 'ping', 'ping_session', 'ping_player')
       and not has_function_privilege('service_role', r.oid, 'execute') then
      v_problems := v_problems || format('service_role can''t execute %s', r.proname);
    end if;
    -- New: the storage policies call the four helpers as the caller, and the app calls the two photo functions.
    if r.proname in ('is_photo_path', 'owns_photo_path', 'may_upload_photo', 'may_delete_photo', 'set_my_photo',
                     'host_remove_photo')
       and not (has_function_privilege('authenticated', r.oid, 'execute')
                and has_function_privilege('service_role', r.oid, 'execute')) then
      v_problems := v_problems || format('authenticated or service_role can''t execute %s', r.proname);
    end if;
  end loop;
  -- New: the photo functions exist.
  foreach v_name in array array['is_photo_path', 'owns_photo_path', 'may_upload_photo', 'may_delete_photo',
                                'log_player_photo', 'set_my_photo', 'host_remove_photo'] loop
    if not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_name) then
      v_problems := v_problems || format('function %s is missing', v_name);
    end if;
  end loop;

  -- authenticated: nothing on the host list and the one-off codes; no direct joins or pairings.
  foreach v_name in array array['hosts', 'player_transfers', 'screen_codes'] loop
    if has_table_privilege('authenticated', ('public.' || v_name)::regclass,
         'select,insert,update,delete,truncate,references,trigger')
       or has_any_column_privilege('authenticated', ('public.' || v_name)::regclass, 'select,insert,update,references') then
      v_problems := v_problems || format('authenticated has a privilege on %s', v_name);
    end if;
  end loop;
  foreach v_name in array array['players', 'session_screens'] loop
    if has_table_privilege('authenticated', ('public.' || v_name)::regclass, 'insert')
       or has_any_column_privilege('authenticated', ('public.' || v_name)::regclass, 'insert') then
      v_problems := v_problems || format('authenticated can insert into %s', v_name);
    end if;
  end loop;

  -- authenticated: the engine's tables are read-only.
  foreach v_name in array array['event_log', 'game_states', 'game_player_views', 'game_scores', 'session_feed',
                                'game_prompts', 'game_submissions'] loop
    if has_table_privilege('authenticated', ('public.' || v_name)::regclass, 'insert,update')
       or has_any_column_privilege('authenticated', ('public.' || v_name)::regclass, 'insert,update') then
      v_problems := v_problems || format('authenticated can insert into or update %s', v_name);
    end if;
  end loop;

  -- Engine-owned columns are never in a client grant. New: players.photo and players.photo_set_at, written only by
  -- the photo functions.
  for r in
    select * from (values
      ('session_games', 'status'), ('session_games', 'public_state'), ('session_games', 'started_at'),
      ('session_games', 'finished_at'), ('session_games', 'finished_by'), ('session_games', 'winners'),
      ('session_games', 'wake_at'), ('sessions', 'data'), ('sessions', 'spotlight_at'),
      ('players', 'profile'), ('players', 'user_id'), ('players', 'session_id'), ('players', 'photo'),
      ('players', 'photo_set_at'), ('score_events', 'awarded_by')
    ) as c(t, col)
  loop
    if has_column_privilege('authenticated', ('public.' || r.t)::regclass, r.col, 'insert')
       or has_column_privilege('authenticated', ('public.' || r.t)::regclass, r.col, 'update') then
      v_problems := v_problems || format('authenticated can write %s.%s', r.t, r.col);
    end if;
  end loop;

  -- sessions' column grants (2.5), checked both ways: a host creates a party
  -- with a name and a join code, and changes exactly these columns (the TV's
  -- sound volume among them); every other column stays out of a client grant.
  for r in
    select a.attname::text as col,
      a.attname in ('name', 'status', 'archived_at', 'spotlight_game_id', 'tv_scene', 'sound_volume') as updates,
      a.attname in ('name', 'join_code') as inserts
    from pg_attribute a
    where a.attrelid = 'public.sessions'::regclass and a.attnum > 0 and not a.attisdropped
  loop
    if has_column_privilege('authenticated', 'public.sessions'::regclass, r.col, 'update') <> r.updates then
      v_problems := v_problems || format('authenticated %s update sessions.%s',
        case when r.updates then 'can''t' else 'can' end, r.col);
    end if;
    if has_column_privilege('authenticated', 'public.sessions'::regclass, r.col, 'insert') <> r.inserts then
      v_problems := v_problems || format('authenticated %s insert sessions.%s',
        case when r.inserts then 'can''t' else 'can' end, r.col);
    end if;
  end loop;

  -- New: the photo column is always checked, and logged when it changes.
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.players'::regclass
                 and c.conname = 'players_photo_path' and c.contype = 'c') then
    v_problems := v_problems || 'the players_photo_path check is missing'::text;
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.players'::regclass
                 and t.tgname = 'players_photo_logged' and not t.tgisinternal and t.tgenabled <> 'D') then
    v_problems := v_problems || 'the players_photo_logged trigger is missing or disabled'::text;
  end if;

  -- service_role: what the engine uses.
  for r in
    select c.oid, c.relname from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm')
  loop
    if not has_table_privilege('service_role', r.oid, 'select') then
      v_problems := v_problems || format('service_role can''t read %s', r.relname);
    end if;
  end loop;
  foreach v_name in array array['game_states', 'game_player_views', 'game_scores', 'game_prompts'] loop
    if not (has_table_privilege('service_role', ('public.' || v_name)::regclass, 'insert')
            and has_table_privilege('service_role', ('public.' || v_name)::regclass, 'update')
            and has_table_privilege('service_role', ('public.' || v_name)::regclass, 'delete')) then
      v_problems := v_problems || format('service_role can''t insert, update and delete %s', v_name);
    end if;
  end loop;
  foreach v_name in array array['score_events', 'session_feed', 'event_log'] loop
    if not has_table_privilege('service_role', ('public.' || v_name)::regclass, 'insert') then
      v_problems := v_problems || format('service_role can''t insert into %s', v_name);
    end if;
  end loop;
  foreach v_name in array array['sessions', 'players', 'session_games'] loop
    if not has_table_privilege('service_role', ('public.' || v_name)::regclass, 'update') then
      v_problems := v_problems || format('service_role can''t update %s', v_name);
    end if;
  end loop;

  -- The log is append-only for everyone but postgres.
  foreach v_name in array array['authenticated', 'service_role'] loop
    if has_table_privilege(v_name, 'public.event_log', 'update,delete,truncate') then
      v_problems := v_problems || format('%s can change or delete event_log rows', v_name);
    end if;
  end loop;

  -- Realtime: the pings policy, and no public table in the Postgres Changes publication.
  if not exists (select 1 from pg_policies where schemaname = 'realtime' and tablename = 'messages'
                 and policyname = 'Hurra screens receive their pings') then
    v_problems := v_problems || 'the realtime.messages policy is missing'::text;
  end if;
  -- A wipe keeps the realtime and storage schemas, and permissive policies OR
  -- together, so any policy these files didn't make would widen access (an
  -- insert policy here would let any guest send pings on the private topics).
  for r in
    select policyname from pg_policies
    where schemaname = 'realtime' and tablename = 'messages' and policyname <> 'Hurra screens receive their pings'
  loop
    v_problems := v_problems || format('realtime.messages has a policy these files didn''t make: %s', r.policyname);
  end loop;
  for r in
    select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  loop
    v_problems := v_problems || format('%s is in the supabase_realtime publication', r.tablename);
  end loop;

  -- Storage: two buckets, seven policies, nothing else.
  if not exists (select 1 from storage.buckets b where b.id = 'game-media' and b.public
                 and b.file_size_limit = 2097152 and b.allowed_mime_types = array['image/jpeg']) then
    v_problems := v_problems || 'the game-media bucket is missing or has the wrong settings'::text;
  end if;
  -- New: player-photos, with versioning off, so a delete really deletes (to_jsonb: a storage service without the
  -- column passes).
  if not exists (select 1 from storage.buckets b where b.id = 'player-photos' and b.public
                 and b.file_size_limit = 65536 and b.allowed_mime_types = array['image/jpeg']
                 and coalesce(to_jsonb(b) ->> 'versioning_status', 'DISABLED') = 'DISABLED') then
    v_problems := v_problems || 'the player-photos bucket is missing or has the wrong settings'::text;
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('Hosts read game media', 'Hosts upload game media', 'Hosts change game media',
                         'Hosts delete game media')) <> 4 then
    v_problems := v_problems || 'a game-media storage policy is missing'::text;
  end if;
  -- New: the three photo policies, each for its one command, for signed-in users only, and with its rule: the
  -- insert checks the type, the content coding, that it isn't signing an upload URL, and may_upload_photo; the
  -- select owns_photo_path; the delete may_delete_photo.
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and roles = array['authenticated']::name[]
      and ((policyname = 'Guests add their own photo' and cmd = 'INSERT'
            and with_check like '%mimetype%' and with_check like '%contentEncoding%'
            and with_check like '%storage.object.sign_upload_url%' and with_check like '%may_upload_photo(name)%')
        or (policyname = 'Owners and hosts see player photos' and cmd = 'SELECT' and qual like '%owns_photo_path(name)%')
        or (policyname = 'Owners and hosts delete player photos' and cmd = 'DELETE'
            and qual like '%may_delete_photo(name)%'))) <> 3 then
    v_problems := v_problems || 'a player-photos storage policy is missing or changed'::text;
  end if;
  -- Checking names is enough: these files have just recreated their own seven.
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname not in ('Hosts read game media', 'Hosts upload game media', 'Hosts change game media',
                             'Hosts delete game media', 'Guests add their own photo',
                             'Owners and hosts see player photos', 'Owners and hosts delete player photos')
  loop
    v_problems := v_problems || format('storage.objects has a policy these files didn''t make: %s', r.policyname);
  end loop;

  -- New: the snapshot still carries each player's photo. A later file that replaces session_snapshot from an older
  -- body would drop it without an error, and every screen would show initials.
  if pg_get_functiondef('public.session_snapshot(uuid, text)'::regprocedure) not like '%''photo'', p.photo%' then
    v_problems := v_problems || 'session_snapshot no longer carries players[].photo'::text;
  end if;
  -- New: and the party's sound volume (20261115230000_tv_sound_volume.sql), which a body from before that file
  -- would drop the same way: every TV would play at full volume, whatever the host set.
  if pg_get_functiondef('public.session_snapshot(uuid, text)'::regprocedure) not like '%''sound_volume'', v_session.sound_volume%' then
    v_problems := v_problems || 'session_snapshot no longer carries session.sound_volume'::text;
  end if;

  -- Exactly one relationship between parties and games, so PostgREST embeds stay unambiguous.
  if (select count(*) from pg_constraint c
      where c.contype = 'f'
        and ((c.conrelid = 'public.session_games'::regclass and c.confrelid = 'public.sessions'::regclass)
          or (c.conrelid = 'public.sessions'::regclass and c.confrelid = 'public.session_games'::regclass))) <> 1 then
    v_problems := v_problems || 'there must be exactly one foreign key between sessions and session_games'::text;
  end if;

  if cardinality(v_problems) > 0 then
    raise exception 'Hurra self-check failed: %', array_to_string(v_problems, '; ');
  end if;
end;
$$;
