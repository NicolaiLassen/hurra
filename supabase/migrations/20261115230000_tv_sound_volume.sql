-- The TV's sound effects volume (docs/engine-v2.md, 2.4 and 7.2): an additive
-- migration on top of the init file, 20261109000000_hurra_v2.sql.
--
-- A party gets sessions.sound_volume, 0 to 100 (100 by default, as loud as
-- before), which the host sets in the control room. Only TV screens follow it
-- (paired TVs and the host's own TV tab), so a laptop that plays the party
-- music as well can keep Hurra's sounds under the music. Phones keep their own
-- volume.
--
-- Rules (2.1): exact grants, `set search_path = ''` and fully qualified names.
-- The self-checks at the end, an updated copy of the init file's, abort the
-- migration if a rule doesn't hold. The file holds no data.

-- Adding the column locks the table for a moment: on a live party, give up
-- rather than queue every screen's read behind a long transaction.
set local lock_timeout = '10s';

-- 1. The column -------------------------------------------------------------------
-- How loud the TV plays its sound effects, in percent: 0 is off.

alter table public.sessions
  add column sound_volume smallint not null default 100 check (sound_volume between 0 and 100);

-- 2. Grants: the party's grants again, exactly (2.5), with the new column ------------
-- A host changes it like the TV scene; the "Hosts change parties" policy lets
-- only hosts update a party, so a guest's or a TV's update changes nothing.

revoke all on public.sessions from anon, authenticated;
grant select, delete on public.sessions to authenticated;
grant insert (name, join_code) on public.sessions to authenticated;
grant update (name, status, archived_at, spotlight_game_id, tv_scene, sound_volume) on public.sessions to authenticated;

-- 3. A change is logged like the party's other changes, and pings the room -----------
-- The TV and the host page hear it at once (TVs never wait out the phones'
-- jitter). The function is the init file's, plus session.sound_volume.

create or replace function public.log_session_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_actor text;
  v_uid uuid := auth.uid();
  v_changed boolean := false;
begin
  if current_setting('hurra.engine', true) = 'on' then
    return null;
  end if;
  begin
    v_actor := case
      when public.is_host() then 'host'
      when exists (select 1 from public.players p where p.session_id = new.id and p.user_id = v_uid) then 'player'
      else 'system' end;
    if tg_op = 'INSERT' then
      insert into public.event_log (session_id, kind, actor, user_id, data)
      values (new.id, 'session.created', v_actor, v_uid,
        jsonb_build_object('name', new.name, 'join_code', new.join_code));
      return null;
    end if;
    if new.name is distinct from old.name then
      insert into public.event_log (session_id, kind, actor, user_id, data)
      values (new.id, 'session.renamed', v_actor, v_uid, jsonb_build_object('from', old.name, 'name', new.name));
      v_changed := true;
    end if;
    if new.status is distinct from old.status then
      insert into public.event_log (session_id, kind, actor, user_id, data)
      values (new.id, case when new.status = 'open' then 'session.opened' else 'session.closed' end, v_actor, v_uid,
        jsonb_build_object('status', new.status));
      v_changed := true;
    end if;
    if new.archived_at is distinct from old.archived_at then
      insert into public.event_log (session_id, kind, actor, user_id, data)
      values (new.id, case when new.archived_at is null then 'session.unarchived' else 'session.archived' end,
        v_actor, v_uid, '{}');
      v_changed := true;
    end if;
    if new.spotlight_game_id is distinct from old.spotlight_game_id then
      insert into public.event_log (session_id, kind, game_id, game_type, actor, user_id, data)
      select new.id, 'stage.changed', new.spotlight_game_id, g.game_type, v_actor, v_uid,
        jsonb_build_object('game_id', new.spotlight_game_id, 'title', g.title,
          'reason', coalesce(nullif(current_setting('hurra.stage_reason', true), ''), 'host'))
      from (select 1) one left join public.session_games g on g.id = new.spotlight_game_id;
      v_changed := true;
    end if;
    if new.tv_scene is distinct from old.tv_scene then
      insert into public.event_log (session_id, kind, actor, user_id, data)
      values (new.id, 'session.tv_scene', v_actor, v_uid, jsonb_build_object('tv_scene', new.tv_scene));
      v_changed := true;
    end if;
    if new.sound_volume is distinct from old.sound_volume then
      insert into public.event_log (session_id, kind, actor, user_id, data)
      values (new.id, 'session.sound_volume', v_actor, v_uid,
        jsonb_build_object('from', old.sound_volume, 'sound_volume', new.sound_volume));
      v_changed := true;
    end if;
    if v_changed then
      perform public.ping_session(new.id, 'room');
    end if;
  exception when others then
    raise warning 'Hurra event log (sessions): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- A trigger's column list can't be altered: replaced, with sound_volume added.
create or replace trigger sessions_logged_update
  after update of name, status, archived_at, spotlight_game_id, tv_scene, sound_volume
  on public.sessions for each row execute function public.log_session_change();

-- 4. The snapshot carries it: the session gains "sound_volume" --------------------------
-- The init file's function, plus that one key. Phones get it too and ignore it.

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
        'profile', p.profile, 'created_at', public.epoch_ms(p.created_at)) order by p.created_at, p.id), '[]'::jsonb)
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

-- 5. Function grants: the replaced functions keep exactly theirs (2.1) ----------------

revoke execute on function public.log_session_change(), public.session_snapshot(uuid, text)
  from public, anon, authenticated;
grant execute on function public.session_snapshot(uuid, text) to authenticated, service_role;

-- PostgREST reloads its schema cache on DDL by itself; this asks once more, at commit,
-- so the control room's update finds the new column at once.
notify pgrst, 'reload schema';

-- 6. Self-checks: an updated copy of the init file's (2.12) ------------------------------
-- New: sessions' insert and update grants name exactly the columns 2.5 lists.

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

  -- Engine-owned columns are never in a client grant.
  for r in
    select * from (values
      ('session_games', 'status'), ('session_games', 'public_state'), ('session_games', 'started_at'),
      ('session_games', 'finished_at'), ('session_games', 'finished_by'), ('session_games', 'winners'),
      ('session_games', 'wake_at'), ('sessions', 'data'), ('sessions', 'spotlight_at'),
      ('players', 'profile'), ('players', 'user_id'), ('players', 'session_id'), ('score_events', 'awarded_by')
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
  -- together, so any policy the init file didn't make would widen access (an
  -- insert policy here would let any guest send pings on the private topics).
  for r in
    select policyname from pg_policies
    where schemaname = 'realtime' and tablename = 'messages' and policyname <> 'Hurra screens receive their pings'
  loop
    v_problems := v_problems || format('realtime.messages has a policy the init file didn''t make: %s', r.policyname);
  end loop;
  for r in
    select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
  loop
    v_problems := v_problems || format('%s is in the supabase_realtime publication', r.tablename);
  end loop;

  -- Storage.
  if not exists (select 1 from storage.buckets b where b.id = 'game-media' and b.public
                 and b.file_size_limit = 2097152 and b.allowed_mime_types = array['image/jpeg']) then
    v_problems := v_problems || 'the game-media bucket is missing or has the wrong settings'::text;
  end if;
  if (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
      and policyname in ('Hosts read game media', 'Hosts upload game media', 'Hosts change game media',
                         'Hosts delete game media')) <> 4 then
    v_problems := v_problems || 'a game-media storage policy is missing'::text;
  end if;
  -- Checking names is enough: the init file made its own four.
  for r in
    select policyname from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname not in ('Hosts read game media', 'Hosts upload game media', 'Hosts change game media',
                             'Hosts delete game media')
  loop
    v_problems := v_problems || format('storage.objects has a policy the init file didn''t make: %s', r.policyname);
  end loop;

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
