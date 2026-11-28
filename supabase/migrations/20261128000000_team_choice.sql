-- Hurra hotfix: a guest picks their own team (docs/user-flows.md, "Teams").
--
-- Additive on top of the teams file (20261127000000_teams.sql). The host makes
-- the teams, before anyone is here or with whoever is; each guest then picks
-- one on their phone, and may switch until a game played in teams goes live.
-- A guest who never picks still lands in the smallest team as they join (the
-- players_join_team trigger, unchanged), so nobody is left out. The host's
-- functions are unchanged: the host can still move anyone, any time.
--
-- Safe on production while the v2-rc8 app is live: one new function, nothing
-- replaced, renamed or dropped. The file holds no data.
--
-- Rules as in the init file (docs/engine-v2.md, 2.1): set search_path = '' and
-- fully qualified names, security definer only where a function must read or
-- write past row level security, every function revoked and then granted
-- exactly, custom SQLSTATEs with the machine code in DETAIL, and a copy of the
-- self-checks at the end, updated for this file.

-- A busy players table makes this wait at most 5 s; then the whole file rolls
-- back and nothing is applied. Push again a minute later.
set lock_timeout = '5s';

-- 1. A guest picks a team ------------------------------------------------------------------
-- The caller's own player goes into p_team_id, a team of the party they are a
-- player in. The same team again changes nothing and counts as success (a
-- double tap, a resend). Refused while a game of the party played in teams is
-- live, so nobody hops teams in the middle of a round; there is no way out of
-- every team for a guest (only the host's Move to team has No team). Logged
-- as host_move_to_team logs a move, with the guest as the actor, and the room
-- pinged once, so the TV, the host page and every phone see it at once.
create function public.choose_team(p_team_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_team public.teams;
  v_player public.players;
  v_from public.teams;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'PT401', detail = 'not_signed_in';
  end if;
  if p_team_id is null then
    raise exception 'Pick a team' using errcode = 'PT400', detail = 'bad_request';
  end if;
  select * into v_team from public.teams where id = p_team_id;
  if not found then
    raise exception 'That team is gone' using errcode = 'PT404', detail = 'team_not_found';
  end if;
  -- Only a guest who joined has a user_id (players_joined): a name still on the list is nobody's.
  select * into v_player from public.players
  where session_id = v_team.session_id and user_id = v_uid and joined_at is not null
  for update;
  if not found then
    raise exception 'You''re not a player in this party' using errcode = 'PT403', detail = 'not_player';
  end if;
  if exists (select 1 from public.sessions s where s.id = v_team.session_id and s.archived_at is not null) then
    raise exception 'This party is over' using errcode = 'PT409', detail = 'archived';
  end if;
  if v_player.team_id is not distinct from p_team_id then
    return jsonb_build_object('id', v_player.id, 'team_id', p_team_id, 'changed', false);
  end if;
  -- The host's words ("End X before you ...") are for the host; a guest hears when they can switch.
  begin
    perform public.refuse_while_team_game_live(v_team.session_id, 'switch');
  exception when sqlstate 'PT409' then
    raise exception 'Teams stay as they are while a team game is live. You can switch once it ends.'
      using errcode = 'PT409', detail = 'team_game_live';
  end;

  select * into v_from from public.teams where id = v_player.team_id;
  update public.players set team_id = p_team_id where id = v_player.id;
  insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
  values (v_player.session_id, 'team.joined', 'player', v_player.id, v_uid, array[v_player.id],
    jsonb_build_object('player_id', v_player.id, 'name', v_player.name, 'team_id', p_team_id, 'team', v_team.name,
      'from', v_player.team_id, 'chosen', true));
  perform public.ping_session(v_player.session_id, 'room');
  return jsonb_build_object('id', v_player.id, 'team_id', p_team_id, 'changed', true,
    'from', case when v_from.id is not null then v_from.name end);
end;
$$;

-- 2. Function grants: everything revoked, then exactly what each role needs -------------------

revoke execute on function public.choose_team(uuid) from public, anon, authenticated;
grant execute on function public.choose_team(uuid) to authenticated, service_role;

-- PostgREST reloads its schema cache on DDL by itself (pgrst_ddl_watch); this
-- makes sure the new RPC answers the moment the file commits.
notify pgrst, 'reload schema';

-- 3. Self-checks: the teams file's, updated for this file -----------------------------------
-- From here on this block is the current one: a later hotfix copies it, not an
-- older file's. The teams file's "New:" notes stay as they were; this file's
-- additions say "And now:".

do $$
declare
  v_problems text[] := '{}';
  v_name text;
  v_def text;
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
    -- New: the team path of submit_answer takes its caller's checks on trust, so no client may call it.
    if (r.proname in ('game_load', 'game_commit', 'ping', 'ping_session', 'ping_player', 'check_answer',
                      'submit_team_answer', 'refuse_while_team_game_live', 'team_colours')
        or r.prorettype = 'trigger'::regtype)
       and has_function_privilege('authenticated', r.oid, 'execute') then
      v_problems := v_problems || format('authenticated can execute %s', r.proname);
    end if;
    if r.proname in ('game_load', 'game_commit', 'ping', 'ping_session', 'ping_player')
       and not has_function_privilege('service_role', r.oid, 'execute') then
      v_problems := v_problems || format('service_role can''t execute %s', r.proname);
    end if;
    -- The storage policies call the four helpers as the caller, the app calls the photo functions, the snapshot
    -- calls my_exit as the caller, and the app calls the guest list's functions. New: and the teams functions.
    -- And now: a guest's choose_team.
    if r.proname in ('is_photo_path', 'owns_photo_path', 'may_upload_photo', 'may_delete_photo', 'set_my_photo',
                     'host_remove_photo', 'my_exit', 'guest_list', 'claim_guest', 'host_add_guests', 'host_free_guest',
                     'join_session', 'claim_player', 'session_snapshot', 'submit_answer', 'host_make_teams',
                     'host_move_to_team', 'host_rename_team', 'host_clear_teams', 'host_set_team_play', 'choose_team')
       and not (has_function_privilege('authenticated', r.oid, 'execute')
                and has_function_privilege('service_role', r.oid, 'execute')) then
      v_problems := v_problems || format('authenticated or service_role can''t execute %s', r.proname);
    end if;
  end loop;
  -- The photo functions exist, and the guest list's. New: and the teams functions. And now: choose_team.
  foreach v_name in array array['is_photo_path', 'owns_photo_path', 'may_upload_photo', 'may_delete_photo',
                                'log_player_photo', 'set_my_photo', 'host_remove_photo', 'my_exit', 'guest_list',
                                'claim_guest', 'host_add_guests', 'host_free_guest', 'join_smallest_team',
                                'host_make_teams', 'host_move_to_team', 'host_rename_team', 'host_clear_teams',
                                'host_set_team_play', 'submit_team_answer', 'choose_team'] loop
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

  -- authenticated: the engine's tables are read-only. New: and the teams, written only by the host functions.
  foreach v_name in array array['event_log', 'game_states', 'game_player_views', 'game_scores', 'session_feed',
                                'game_prompts', 'game_submissions', 'teams'] loop
    if has_table_privilege('authenticated', ('public.' || v_name)::regclass, 'insert,update')
       or has_any_column_privilege('authenticated', ('public.' || v_name)::regclass, 'insert,update') then
      v_problems := v_problems || format('authenticated can insert into or update %s', v_name);
    end if;
  end loop;
  if has_table_privilege('authenticated', 'public.teams', 'delete,truncate') then
    v_problems := v_problems || 'authenticated can delete teams'::text;
  end if;

  -- Engine-owned columns are never in a client grant: players.photo and players.photo_set_at, written only by the
  -- photo functions; players.joined_at, written only by the guest list's functions. New: players.team_id,
  -- session_games.team_play and game_submissions.answered_by, written only by the teams functions.
  for r in
    select * from (values
      ('session_games', 'status'), ('session_games', 'public_state'), ('session_games', 'started_at'),
      ('session_games', 'finished_at'), ('session_games', 'finished_by'), ('session_games', 'winners'),
      ('session_games', 'wake_at'), ('session_games', 'team_play'), ('sessions', 'data'), ('sessions', 'spotlight_at'),
      ('players', 'profile'), ('players', 'user_id'), ('players', 'session_id'), ('players', 'photo'),
      ('players', 'photo_set_at'), ('players', 'joined_at'), ('players', 'team_id'),
      ('game_submissions', 'answered_by'), ('score_events', 'awarded_by')
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

  -- The photo column is always checked, and logged when it changes.
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.players'::regclass
                 and c.conname = 'players_photo_path' and c.contype = 'c') then
    v_problems := v_problems || 'the players_photo_path check is missing'::text;
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.players'::regclass
                 and t.tgname = 'players_photo_logged' and not t.tgisinternal and t.tgenabled <> 'D') then
    v_problems := v_problems || 'the players_photo_logged trigger is missing or disabled'::text;
  end if;

  -- Joined and expected guests. The check that ties joined_at to user_id, the members' read policy that hides
  -- expected rows from guests and TVs, the scoreboard view's filter, and the trigger that logs the list.
  if not exists (select 1 from pg_attribute a where a.attrelid = 'public.players'::regclass
                 and a.attname = 'joined_at' and not a.attisdropped) then
    v_problems := v_problems || 'players.joined_at is missing'::text;
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.players'::regclass
                 and c.conname = 'players_joined' and c.contype = 'c') then
    v_problems := v_problems || 'the players_joined check is missing'::text;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'players'
                 and policyname = 'Hosts and members read players' and cmd = 'SELECT'
                 and qual like '%joined_at IS NOT NULL%') then
    v_problems := v_problems || 'the players read policy is missing or shows expected guests to members'::text;
  end if;
  if pg_get_viewdef('public.scoreboard'::regclass) not like '%joined_at IS NOT NULL%' then
    v_problems := v_problems || 'the scoreboard view shows expected guests'::text;
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'score_events'
                 and policyname = 'Hosts give points' and cmd = 'INSERT'
                 and with_check like '%is_host()%' and with_check like '%joined_at IS NOT NULL%') then
    v_problems := v_problems || 'the host award policy is missing or gives points to expected guests'::text;
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.players'::regclass
                 and t.tgname = 'players_logged' and not t.tgisinternal and t.tgenabled <> 'D') then
    v_problems := v_problems || 'the players_logged trigger is missing or disabled'::text;
  end if;

  -- New: teams. The columns, the read policy for hosts and members, the trigger that puts a guest who joins into
  -- the smallest team, and the foreign key that keeps a guest in a team of their own party.
  foreach v_name in array array['players.team_id', 'session_games.team_play', 'game_submissions.answered_by'] loop
    if not exists (select 1 from pg_attribute a where a.attrelid = ('public.' || split_part(v_name, '.', 1))::regclass
                   and a.attname = split_part(v_name, '.', 2) and not a.attisdropped) then
      v_problems := v_problems || format('%s is missing', v_name);
    end if;
  end loop;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'teams'
                 and policyname = 'Hosts and members read teams' and cmd = 'SELECT'
                 and qual like '%is_host()%' and qual like '%my_session_ids()%') then
    v_problems := v_problems || 'the teams read policy is missing or changed'::text;
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'teams') <> 1 then
    v_problems := v_problems || 'teams has a policy besides its read policy'::text;
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.players'::regclass
                 and t.tgname = 'players_join_team' and not t.tgisinternal and t.tgenabled <> 'D') then
    v_problems := v_problems || 'the players_join_team trigger is missing or disabled'::text;
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.players'::regclass
                 and c.conname = 'players_team_fkey' and c.contype = 'f' and c.confrelid = 'public.teams'::regclass) then
    v_problems := v_problems || 'the players_team_fkey foreign key is missing'::text;
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
  -- player-photos, with versioning off, so a delete really deletes (to_jsonb: a storage service without the
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
  -- The three photo policies, each for its one command, for signed-in users only, and with its rule: the
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

  -- The snapshot still carries each player's photo and the party's sound volume. A later file that replaces
  -- session_snapshot from an older body would drop them without an error.
  if pg_get_functiondef('public.session_snapshot(uuid, text)'::regprocedure) not like '%''photo'', p.photo%' then
    v_problems := v_problems || 'session_snapshot no longer carries players[].photo'::text;
  end if;
  if pg_get_functiondef('public.session_snapshot(uuid, text)'::regprocedure) not like '%''sound_volume'', v_session.sound_volume%' then
    v_problems := v_problems || 'session_snapshot no longer carries session.sound_volume'::text;
  end if;

  -- Every function that hands players to a screen or a game keeps only joined guests. A later file that
  -- replaces one from a body older than the guest list's would show expected guests on the TV, the phones and in games.
  v_def := pg_get_functiondef('public.session_snapshot(uuid, text)'::regprocedure);
  if v_def not like '%p.joined_at is not null%' or v_def not like '%''guests''%' or v_def not like '%''freed''%' then
    v_problems := v_problems || 'session_snapshot no longer keeps players to joined guests, or lacks guests or freed'::text;
  end if;
  -- New: and the snapshot carries the teams, each player's team and each game's team play.
  if v_def not like '%''teams''%' or v_def not like '%''team_id'', p.team_id%' or v_def not like '%''team_play'', g.team_play%'
     or v_def not like '%''answered_by''%' then
    v_problems := v_problems || 'session_snapshot lacks teams, players[].team_id, games[].team_play or me.answered_by'::text;
  end if;
  v_def := pg_get_functiondef('public.game_load(uuid, uuid, text[], uuid)'::regprocedure);
  if v_def not like '%p.joined_at is not null%' or v_def not like '%''guests''%' or v_def not like '%''saved_at''%' then
    v_problems := v_problems || 'game_load no longer keeps players to joined guests, or lacks guests or saved_at'::text;
  end if;
  -- New: and it hands the game its team play.
  if v_def not like '%''team_play'', g.team_play%' then
    v_problems := v_problems || 'game_load lacks game.team_play'::text;
  end if;
  v_def := pg_get_functiondef('public.game_commit(jsonb)'::regprocedure);
  if (length(v_def) - length(replace(v_def, 'pl.joined_at is not null', ''))) / length('pl.joined_at is not null') < 6 then
    v_problems := v_problems || 'game_commit writes for expected guests (fewer than six joined filters)'::text;
  end if;
  if pg_get_functiondef('public.check_answer(jsonb, jsonb, uuid, uuid)'::regprocedure) not like '%joined_at is not null%' then
    v_problems := v_problems || 'check_answer''s players option counts expected guests'::text;
  end if;
  if pg_get_functiondef('public.session_recap(uuid)'::regprocedure) not like '%joined_at is not null%' then
    v_problems := v_problems || 'session_recap counts expected guests'::text;
  end if;
  -- New: submit_answer hands a team game's answers to the team path, and the team path writes for joined members
  -- only. A later file that replaces submit_answer from the init file's body would quietly drop team play.
  v_def := pg_get_functiondef('public.submit_answer(uuid, text, jsonb, uuid)'::regprocedure);
  if v_def not like '%v_game.team_play and v_team is not null%' or v_def not like '%public.submit_team_answer(%' then
    v_problems := v_problems || 'submit_answer no longer hands team games to submit_team_answer'::text;
  end if;
  if pg_get_functiondef('public.submit_team_answer(public.session_games, public.game_prompts, uuid, uuid, jsonb, uuid, uuid, timestamptz)'::regprocedure)
     not like '%p.joined_at is not null%' then
    v_problems := v_problems || 'submit_team_answer writes for guests who haven''t joined'::text;
  end if;

  -- And now: choose_team writes a guest's own team past row level security, so it is a definer function that
  -- keeps the search path empty, and it refuses a switch while a team game is live. A later file that replaces it
  -- from a body without that check would let guests hop teams in the middle of a round.
  if not exists (select 1 from pg_proc p where p.oid = 'public.choose_team(uuid)'::regprocedure and p.prosecdef
                 and p.proconfig @> array['search_path=""']) then
    v_problems := v_problems || 'choose_team is not security definer with an empty search_path'::text;
  end if;
  v_def := pg_get_functiondef('public.choose_team(uuid)'::regprocedure);
  if v_def not like '%public.refuse_while_team_game_live(%' or v_def not like '%user_id = v_uid%' then
    v_problems := v_problems || 'choose_team no longer refuses while a team game is live, or checks its caller'::text;
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
