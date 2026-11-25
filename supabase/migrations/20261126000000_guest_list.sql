-- Hurra hotfix: the guest list (docs/guest-list.md).
--
-- Additive on top of the v2 init file, the TV sound volume hotfix and the
-- guest photos hotfix (20261116000000_guest_photos.sql). Before the party the
-- host adds every guest's name; a guest who joins taps their name instead of
-- typing it, and game settings can name guests who have not joined yet. A
-- guest on the list is a players row the host made with no user yet (user_id
-- null), so its id stays the same from the list to the night; taking the name
-- (claim_guest) sets user_id in one atomic step. The new public column
-- players.joined_at (null while expected) tells joined guests from expected
-- ones, and every place guests play (the snapshot's players and standings, the
-- scoreboard view, game_load, game_commit, check_answer, session_recap, the
-- members' read policy) keeps only joined guests. Hosts see the whole list
-- (the snapshot's guests, game_load's guests); anyone with the join code sees
-- only the free names (guest_list).
--
-- Safe on production with today's data: every existing row gets joined_at =
-- created_at, and nothing else changes. Safe while the old app is live for a
-- few minutes: old code never makes a row without a user (joined_at defaults
-- to now() for its inserts), and every replaced function keeps its signature
-- and returns a superset, the same as before for a party without a list.
--
-- Rules as in the init file (docs/engine-v2.md, 2.1): set search_path = '' and
-- fully qualified names, security definer only where a function must read or
-- write past row level security, every function revoked and then granted
-- exactly, custom SQLSTATEs with the machine code in DETAIL, and a copy of the
-- self-checks at the end, updated for this file. The file holds no data.

-- A busy players table makes this wait at most 5 s; then the whole file rolls
-- back and nothing is applied. Push again a minute later.
set lock_timeout = '5s';

-- 1. Columns, constraint, index -----------------------------------------------------
-- user_id null: a guest on the list who has not joined yet (expected).
-- joined_at: when the guest joined (took the name, or typed their own); null
-- while expected. Public: it tells joined from expected without user ids.

alter table public.players alter column user_id drop not null;
alter table public.players add column joined_at timestamptz;
-- Everyone already in a party joined when their row was made. The players
-- triggers fire only on name, user_id and photo, so this logs nothing.
update public.players set joined_at = created_at where joined_at is null;
-- Every insert with a user (join_session, the scripts) is joined at once. A
-- row without a user must pass joined_at => null, or the check refuses it.
alter table public.players alter column joined_at set default now();
alter table public.players add constraint players_joined
  check ((user_id is null) = (joined_at is null));
-- The free names of a party (guest_list, the host's counts).
create index players_expected_idx on public.players (session_id) where user_id is null;

-- 2. Grants and the read policy ---------------------------------------------------
-- The players' grants again, exactly (2.5): joined_at is in no client write
-- grant. Only the functions below and the scripts with the secret key write it.

revoke all on public.players from anon, authenticated;
grant select, delete on public.players to authenticated;
grant update (name) on public.players to authenticated;
grant select, insert, update, delete on public.players to service_role;

-- Members (guests and paired TVs) read only joined rows; hosts read all (the
-- guest list, its rename and its remove). The update and delete policies stay
-- host only, so they work on expected rows as on joined ones.
alter policy "Hosts and members read players" on public.players
  using ((select public.is_host())
         or (session_id = any ((select public.my_session_ids())::uuid[]) and joined_at is not null));

-- 3. The scoreboard view: joined guests only ------------------------------------------
-- The init file's view with one line added (the same columns). It feeds the
-- snapshot's standings, game_load's scoreboard, session_recap's standings and
-- the host's direct reads.

create or replace view public.scoreboard with (security_invoker = true) as
select p.session_id, p.id as player_id, p.name, p.code,
  (coalesce((select sum(e.points) from public.score_events e where e.player_id = p.id), 0)
   + coalesce((select sum(g.points) from public.game_scores g where g.player_id = p.id), 0))::int as points,
  p.profile
from public.players p
where p.joined_at is not null;
revoke all on public.scoreboard from anon, authenticated;
grant select on public.scoreboard to authenticated, service_role;

-- 4. Helper: how the caller's player left a party ---------------------------------------
-- The kind of the newest of this user's player.moved, player.freed and
-- player.removed rows in the party, or null. The snapshot tells a phone
-- whether it moved or was freed (moved_away stays for anything that calls it).

create function public.my_exit(p_session_id uuid) returns text
language sql stable security definer set search_path = '' as $$
  select e.kind from public.event_log e
  where e.session_id = p_session_id and e.kind in ('player.moved', 'player.freed', 'player.removed')
    and e.data ->> 'from_user' = auth.uid()::text
  order by e.id desc limit 1
$$;

-- 5. The players trigger: the guest list's own log rows -----------------------------------
-- The init file's function with the guest list: a row without a user is a
-- guest on the list (guest.added, guest.renamed, guest.removed, pinging only
-- the stage, since phones never show expected guests); taking a name is a
-- join (player.joined with listed: true); a removed player's row carries
-- from_user (my_exit). Quiet for the row host_free_guest deletes and adds
-- back, which logs player.freed itself. Fails open as before.

create or replace function public.log_player_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_actor text;
  v_id uuid;
begin
  if current_setting('hurra.engine', true) = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_id := old.id;
  else
    v_id := new.id;
  end if;
  if coalesce(current_setting('hurra.freeing', true), '') = v_id::text then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      if new.user_id is null then
        insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
        values (new.session_id, 'guest.added', case when public.is_host() then 'host' else 'system' end,
          new.id, v_uid, array[new.id], jsonb_build_object('name', new.name, 'player_id', new.id));
        perform public.ping_session(new.session_id, 'stage');
      else
        v_actor := case
          when public.is_host() then 'host'
          when new.user_id = v_uid then 'player'
          else 'system' end;
        insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
        values (new.session_id, 'player.joined', v_actor, new.id, v_uid, array[new.id],
          jsonb_build_object('name', new.name, 'player_id', new.id));
        perform public.ping_session(new.session_id, 'stage');
      end if;
    elsif tg_op = 'UPDATE' then
      v_actor := case
        when public.is_host() then 'host'
        when exists (select 1 from public.players p where p.session_id = new.session_id and p.user_id = v_uid) then 'player'
        else 'system' end;
      if new.name is distinct from old.name then
        if old.user_id is null and new.user_id is null then
          insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
          values (new.session_id, 'guest.renamed', v_actor, new.id, v_uid, array[new.id],
            jsonb_build_object('name', new.name, 'player_id', new.id, 'from', old.name));
          perform public.ping_session(new.session_id, 'stage');
        else
          insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
          values (new.session_id, 'player.renamed', v_actor, new.id, v_uid, array[new.id],
            jsonb_build_object('name', new.name, 'player_id', new.id, 'from', old.name));
          perform public.ping_session(new.session_id, 'room');
        end if;
      end if;
      if new.user_id is distinct from old.user_id then
        if old.user_id is null then
          -- A name on the list taken (claim_guest, or a host's move code used on it): a join.
          insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
          values (new.session_id, 'player.joined', case when new.user_id = v_uid then 'player' else v_actor end,
            new.id, v_uid, array[new.id], jsonb_build_object('name', new.name, 'player_id', new.id, 'listed', true));
          perform public.ping_session(new.session_id, 'stage');
        elsif new.user_id is null then
          -- No app path does this (host_free_guest deletes and adds back); a script might.
          insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
          values (new.session_id, 'player.freed', v_actor, new.id, v_uid, array[new.id],
            jsonb_build_object('name', new.name, 'player_id', new.id, 'from_user', old.user_id));
          perform public.ping_session(new.session_id, 'room');
        else
          insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
          values (new.session_id, 'player.moved', v_actor, new.id, v_uid, array[new.id],
            jsonb_build_object('name', new.name, 'player_id', new.id, 'from_user', old.user_id));
          -- The old phone is still joined on player:<id>, so it hears this.
          perform public.ping_player(new.session_id, new.id, 'moved');
          perform public.ping_session(new.session_id, 'stage');
        end if;
      end if;
    else
      -- Skipped when the whole party is being deleted.
      if not exists (select 1 from public.sessions where id = old.session_id) then
        return null;
      end if;
      v_actor := case when public.is_host() then 'host' else 'system' end;
      if old.user_id is null then
        insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
        values (old.session_id, 'guest.removed', v_actor, old.id, v_uid, array[old.id],
          jsonb_build_object('name', old.name, 'player_id', old.id));
        perform public.ping_session(old.session_id, 'stage');
      else
        insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
        values (old.session_id, 'player.removed', v_actor, old.id, v_uid, array[old.id],
          jsonb_build_object('name', old.name, 'player_id', old.id, 'from_user', old.user_id));
        perform public.ping_session(old.session_id, 'room');
      end if;
    end if;
  exception when others then
    raise warning 'Hurra event log (players): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;

-- 6. Client RPCs ----------------------------------------------------------------------

-- Adds the caller to a party, or returns their player when they rejoin from
-- the same browser. The init file's function, plus: a typed name that is free
-- on the guest list is refused with on_list (the listed name in HINT), so the
-- phone asks "Yes, I'm Ana" and takes it with claim_guest. A party without a
-- list joins exactly as before.
create or replace function public.join_session(p_join_code text, p_name text) returns public.players
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_join_code, '')));
  v_name text := public.clean_name(p_name);
  v_session public.sessions;
  v_player public.players;
  v_constraint text;
  v_listed text;
begin
  if v_uid is null then
    raise exception 'You need to be signed in to join' using errcode = 'PT401', detail = 'not_signed_in';
  end if;
  select * into v_session from public.sessions where join_code = v_code;
  if not found then
    raise exception 'No party with code %', v_code using errcode = 'PT404', detail = 'not_found';
  end if;
  select * into v_player from public.players where session_id = v_session.id and user_id = v_uid;
  if found then
    return v_player;
  end if;
  if v_session.archived_at is not null then
    raise exception 'This party is over' using errcode = 'PT409', detail = 'archived';
  end if;
  if v_session.status <> 'open' then
    raise exception 'This party is closed for new players' using errcode = 'PT409', detail = 'closed';
  end if;
  if public.name_key(v_name) = '' or char_length(v_name) > 40 then
    raise exception 'Names are 1 to 40 characters' using errcode = 'PT400', detail = 'bad_name';
  end if;
  -- A name on the guest list that nobody has taken yet: the phone offers it
  -- (claim_guest), so the guest confirms it is them. The listed name in HINT.
  select p.name into v_listed from public.players p
  where p.session_id = v_session.id and p.user_id is null
    and public.name_key(p.name) = public.name_key(v_name);
  if found then
    raise exception '"%" is on the guest list. If that''s you, pick it from the list.', v_listed
      using errcode = 'PT409', detail = 'on_list', hint = v_listed;
  end if;
  -- A clash on the random player code (rare) is retried; one on the name is the guest's to fix.
  for i in 1..5 loop
    begin
      insert into public.players (session_id, user_id, name)
      values (v_session.id, v_uid, v_name)
      returning * into v_player;
      return v_player;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint = 'players_session_name_key' then
        -- The host listed the name in between: offer it, as above.
        select p.name into v_listed from public.players p
        where p.session_id = v_session.id and p.user_id is null
          and public.name_key(p.name) = public.name_key(v_name);
        if found then
          raise exception '"%" is on the guest list. If that''s you, pick it from the list.', v_listed
            using errcode = 'PT409', detail = 'on_list', hint = v_listed;
        end if;
        raise exception 'Someone already joined as "%". Try another name.', v_name
          using errcode = 'PT409', detail = 'name_taken';
      elsif v_constraint = 'players_session_id_user_id_key' then
        -- The same browser joined twice at once: the other call won.
        select * into v_player from public.players where session_id = v_session.id and user_id = v_uid;
        return v_player;
      elsif i = 5 then
        raise;
      end if;
    end;
  end loop;
  return v_player;
end;
$$;

-- The free names of a party, for the join page's "Who are you?", and nothing
-- else about them: no ids, no codes, no times. Null when signed out or the
-- code is unknown (as session_by_code); empty while joining is closed or the
-- party is over, since nobody may take a name then.
create function public.guest_list(p_join_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else (
    select case
      when s.id is null then null
      when s.archived_at is not null or s.status <> 'open' then '[]'::jsonb
      else coalesce((select jsonb_agg(p.name order by public.name_key(p.name), p.id)
                     from public.players p where p.session_id = s.id and p.user_id is null), '[]'::jsonb)
    end
    from (select 1) one left join public.sessions s on s.join_code = upper(btrim(coalesce(p_join_code, '')))
  ) end
$$;

-- Takes a free name on the guest list: taking a name is joining, so the party
-- must be open and not over, and a user has at most one player per party.
-- By name, so no id or code of an expected guest ever leaves the database to
-- someone who is not in the party. The update is the one atomic step: a
-- second phone on the same name waits on the row lock, then finds user_id set
-- and updates nothing (guest_taken). A retry of the same claim returns the
-- player. The players trigger logs player.joined (listed) and pings the stage.
create function public.claim_guest(p_join_code text, p_name text) returns public.players
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_join_code, '')));
  v_key text := public.name_key(p_name);
  v_session public.sessions;
  v_player public.players;
  v_constraint text;
begin
  if v_uid is null then
    raise exception 'You need to be signed in to join' using errcode = 'PT401', detail = 'not_signed_in';
  end if;
  select * into v_session from public.sessions where join_code = v_code;
  if not found then
    raise exception 'No party with code %', v_code using errcode = 'PT404', detail = 'not_found';
  end if;
  -- Already in the party: a retry of this same claim returns the player; anything else is a second name.
  select * into v_player from public.players where session_id = v_session.id and user_id = v_uid;
  if found then
    if public.name_key(v_player.name) = v_key then
      return v_player;
    end if;
    raise exception 'This phone is already in the party as %', v_player.name
      using errcode = 'PT409', detail = 'already_player';
  end if;
  if v_session.archived_at is not null then
    raise exception 'This party is over' using errcode = 'PT409', detail = 'archived';
  end if;
  if v_session.status <> 'open' then
    raise exception 'This party is closed for new players' using errcode = 'PT409', detail = 'closed';
  end if;
  if v_key = '' then
    raise exception 'Names are 1 to 40 characters' using errcode = 'PT400', detail = 'bad_name';
  end if;
  -- Twice at most: a name the host freed while this claim waited on its row
  -- comes back as a new row the first update could not see.
  for i in 1..2 loop
    begin
      update public.players set user_id = v_uid, joined_at = now()
      where session_id = v_session.id and user_id is null and public.name_key(name) = v_key
      returning * into v_player;
    exception when unique_violation then
      -- The same browser took two names at once in two tabs: the other call won.
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'players_session_id_user_id_key' then
        raise;
      end if;
      select * into v_player from public.players where session_id = v_session.id and user_id = v_uid;
      if public.name_key(v_player.name) = v_key then
        return v_player;
      end if;
      raise exception 'This phone is already in the party as %', v_player.name
        using errcode = 'PT409', detail = 'already_player';
    end;
    -- The earlier select left v_player empty, so a row here means this update took it.
    if v_player.id is not null then
      return v_player;
    end if;
    select * into v_player from public.players where session_id = v_session.id and public.name_key(name) = v_key;
    if not found then
      raise exception '% isn''t on the guest list any more. Pick your name again.', public.clean_name(p_name)
        using errcode = 'PT404', detail = 'not_on_list';
    end if;
    if v_player.user_id is not null then
      raise exception 'Someone just took %. If that''s you, ask the host to free your name.', v_player.name
        using errcode = 'PT409', detail = 'guest_taken';
    end if;
    v_player := null;
  end loop;
  raise exception 'Someone just took that name. If that''s you, ask the host to free your name.'
    using errcode = 'PT409', detail = 'guest_taken';
end;
$$;

-- The host adds names to the guest list (one or a pasted list), in order. A
-- row without a user is a guest still expected. Clients never insert into
-- players, so this is the only way in. Blank lines are skipped without a
-- word; a name over 40 characters, a repeat within the call, or a name
-- already in the party (joined or expected, look-alikes included) is skipped
-- with its reason. At most 100 names a call and 200 expected names a party
-- (two pastes at the same instant may pass that by one paste; harmless).
-- The players trigger logs guest.added per row and pings the stage once.
create function public.host_add_guests(p_session_id uuid, p_names text[]) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_name text;
  v_key text;
  v_seen text[] := '{}';
  v_add int[] := '{}';
  v_skipped jsonb := '[]';
  v_added jsonb := '[]';
  v_expected int;
  v_player public.players;
  v_constraint text;
  v_i int;
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  select * into v_session from public.sessions where id = p_session_id;
  if not found then
    raise exception 'Party not found' using errcode = 'PT404', detail = 'not_found';
  end if;
  if v_session.archived_at is not null then
    raise exception 'This party is over' using errcode = 'PT409', detail = 'archived';
  end if;
  if p_names is null or coalesce(cardinality(p_names), 0) > 100 then
    raise exception 'Add at most 100 names at a time' using errcode = 'PT400', detail = 'too_many';
  end if;

  -- First pass, in order: what to add, and what to skip with its reason.
  for v_i in coalesce(array_lower(p_names, 1), 1) .. coalesce(array_upper(p_names, 1), 0) loop
    v_name := public.clean_name(p_names[v_i]);
    v_key := public.name_key(v_name);
    if v_key = '' then
      continue;
    elsif char_length(v_name) > 40 then
      v_skipped := v_skipped || jsonb_build_object('i', v_i, 'name', p_names[v_i], 'reason', 'too_long');
    elsif v_key = any (v_seen) then
      v_skipped := v_skipped || jsonb_build_object('i', v_i, 'name', p_names[v_i], 'reason', 'repeat');
    elsif exists (select 1 from public.players p where p.session_id = p_session_id and public.name_key(p.name) = v_key) then
      v_skipped := v_skipped || jsonb_build_object('i', v_i, 'name', p_names[v_i], 'reason', 'taken');
    else
      v_add := v_add || v_i;
    end if;
    v_seen := v_seen || v_key;
  end loop;

  select count(*) into v_expected from public.players p where p.session_id = p_session_id and p.user_id is null;
  if v_expected + cardinality(v_add) > 200 then
    raise exception 'The guest list holds at most 200 names that haven''t joined yet. % more fit.', greatest(200 - v_expected, 0)
      using errcode = 'PT409', detail = 'list_full';
  end if;

  -- Then each, in order, made a moment apart (clock_timestamp), so the list
  -- keeps the order they were added in (game_load's guests). A clash on the
  -- random player code (rare) is retried; one on the name (a guest joined
  -- with it meanwhile) is a taken skip.
  foreach v_i in array v_add loop
    v_name := public.clean_name(p_names[v_i]);
    for attempt in 1..5 loop
      begin
        insert into public.players (session_id, user_id, joined_at, name, created_at)
        values (p_session_id, null, null, v_name, clock_timestamp())
        returning * into v_player;
        v_added := v_added || jsonb_build_object('id', v_player.id, 'name', v_player.name);
        exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint = 'players_session_name_key' then
          v_skipped := v_skipped || jsonb_build_object('i', v_i, 'name', p_names[v_i], 'reason', 'taken');
          exit;
        elsif attempt = 5 then
          raise;
        end if;
      end;
    end loop;
  end loop;

  return jsonb_build_object('added', v_added,
    'skipped', (select coalesce(jsonb_agg(s - 'i' order by (s ->> 'i')::int), '[]'::jsonb)
                from jsonb_array_elements(v_skipped) s));
end;
$$;

-- The host frees a name someone took by mistake: the guest goes back on the
-- list as still expected, under the same id, name and created_at, with a new
-- player code (the old phone's QR code is dead). Deleting the row takes
-- everything the taker earned with it through the foreign keys (points,
-- scores, views, answers, a move code, and any later table that cascades);
-- their targeted announcements go too. The delete waits for a running
-- game_commit. The players trigger stays quiet for this row: one player.freed
-- row and one room ping, from here. The freed phone's snapshot then reads
-- member: false, freed: true. Returns the photo it had, so the host page
-- deletes the file.
create function public.host_free_guest(p_player_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_old public.players;
  v_constraint text;
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  select * into v_old from public.players where id = p_player_id for update;
  if not found then
    raise exception 'That guest isn''t in the party any more' using errcode = 'PT404', detail = 'not_found';
  end if;
  if v_old.user_id is null then
    raise exception '% is already free', v_old.name using errcode = 'PT409', detail = 'not_joined';
  end if;

  perform set_config('hurra.freeing', v_old.id::text, true);
  delete from public.players where id = v_old.id;
  for attempt in 1..5 loop
    begin
      insert into public.players (id, session_id, user_id, joined_at, name, created_at)
      values (v_old.id, v_old.session_id, null, null, v_old.name, v_old.created_at);
      exit;
    exception when unique_violation then
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint <> 'players_code_key' or attempt = 5 then
        raise;
      end if;
    end;
  end loop;
  -- Announcements only the taker could read go with them.
  update public.session_feed set audience = array_remove(audience, v_old.id)
  where session_id = v_old.session_id and audience @> array[v_old.id];
  delete from public.session_feed where session_id = v_old.session_id and audience = '{}'::uuid[];
  perform set_config('hurra.freeing', '', true);

  insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
  values (v_old.session_id, 'player.freed', 'host', v_old.id, auth.uid(), array[v_old.id],
    jsonb_build_object('name', v_old.name, 'player_id', v_old.id, 'from_user', v_old.user_id));
  perform public.ping_session(v_old.session_id, 'room');
  return jsonb_build_object('id', v_old.id, 'name', v_old.name, 'previous_photo', v_old.photo);
end;
$$;

-- Move a player to a new phone: the init file's function, joining a guest
-- still expected when the host issued the code for one.
create or replace function public.claim_player(p_code text) returns public.players
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_transfer public.player_transfers;
  v_player public.players;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'PT401', detail = 'not_signed_in';
  end if;
  delete from public.player_transfers
  where code = upper(btrim(coalesce(p_code, ''))) and expires_at > now()
  returning * into v_transfer;
  if not found then
    raise exception 'That code is wrong or has expired. Ask the host for a new one.'
      using errcode = 'PT404', detail = 'bad_code';
  end if;
  select * into v_player from public.players where id = v_transfer.player_id;
  if exists (select 1 from public.players where session_id = v_player.session_id and user_id = v_uid) then
    raise exception 'This phone already has a player in this party' using errcode = 'PT409', detail = 'already_player';
  end if;
  -- The players trigger logs player.moved and pings the old phone, or, for a
  -- guest still expected (a code the host issued for a name on the list),
  -- player.joined: then this phone takes the name, joined from now.
  update public.players set user_id = v_uid, joined_at = coalesce(joined_at, now())
  where id = v_player.id returning * into v_player;
  return v_player;
end;
$$;

-- Checks an answer against a prompt's spec and returns it normalised: the init
-- file's function, with options 'players' meaning the guests who joined, and
-- the new options 'guests': every name on the guest list, joined or not, so a
-- game can let the room name a guest who never came. Internal: only
-- submit_answer calls it.
create or replace function public.check_answer(p_spec jsonb, p_payload jsonb, p_session_id uuid, p_player_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
declare
  v_kind text := p_spec ->> 'kind';
  v_choice jsonb;
  v_options text[];
  v_n int;
  v_distinct int;
  v_min int;
  v_max int;
  v_value numeric;
  v_text text;
  v_max_length int;
begin
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' or octet_length(p_payload::text) > 2048 then
    raise exception 'That answer is not valid' using errcode = 'PT400', detail = 'answer_invalid';
  end if;
  if v_kind = 'choice' then
    v_choice := case jsonb_typeof(p_payload -> 'choice')
      when 'string' then jsonb_build_array(p_payload -> 'choice')
      when 'array' then p_payload -> 'choice'
    end;
    if v_choice is null or jsonb_array_length(v_choice) = 0 then
      raise exception 'Pick an option' using errcode = 'PT400', detail = 'answer_invalid';
    end if;
    if p_spec -> 'options' = '"players"'::jsonb then
      select coalesce(array_agg(p.id::text), '{}') into v_options from public.players p
      where p.session_id = p_session_id and p.joined_at is not null
        and not (coalesce((p_spec ->> 'exclude_self')::boolean, false) and p.id = p_player_id);
    elsif p_spec -> 'options' = '"guests"'::jsonb then
      -- Every name on the guest list, joined or not (fusion: a guest who never came can still be named).
      select coalesce(array_agg(p.id::text), '{}') into v_options from public.players p
      where p.session_id = p_session_id
        and not (coalesce((p_spec ->> 'exclude_self')::boolean, false) and p.id = p_player_id);
    elsif jsonb_typeof(p_spec -> 'options') = 'array' then
      select coalesce(array_agg(x), '{}') into v_options from jsonb_array_elements_text(p_spec -> 'options') x;
    else
      raise exception 'This question takes no answers' using errcode = 'PT400', detail = 'answer_invalid';
    end if;
    if exists (select 1 from jsonb_array_elements(v_choice) c
               where jsonb_typeof(c) <> 'string' or not ((c #>> '{}') = any (v_options))) then
      raise exception 'That is not one of the options' using errcode = 'PT400', detail = 'answer_invalid';
    end if;
    select count(*), count(distinct c) into v_n, v_distinct from jsonb_array_elements_text(v_choice) c;
    if v_n <> v_distinct then
      raise exception 'Pick each option only once' using errcode = 'PT400', detail = 'answer_invalid';
    end if;
    v_min := coalesce((p_spec ->> 'min')::int, 1);
    v_max := coalesce((p_spec ->> 'max')::int, 1);
    if v_n < v_min or v_n > v_max then
      raise exception '%', case when v_min = v_max then format('Pick %s', v_min) else format('Pick %s to %s', v_min, v_max) end
        using errcode = 'PT400', detail = 'answer_invalid';
    end if;
    return jsonb_build_object('choice',
      (select jsonb_agg(c order by c collate "C") from jsonb_array_elements_text(v_choice) c));
  elsif v_kind = 'number' then
    if jsonb_typeof(p_payload -> 'value') is distinct from 'number' then
      raise exception 'Enter a number' using errcode = 'PT400', detail = 'answer_invalid';
    end if;
    v_value := (p_payload ->> 'value')::numeric;
    if (jsonb_typeof(p_spec -> 'min') = 'number' and v_value < (p_spec ->> 'min')::numeric)
       or (jsonb_typeof(p_spec -> 'max') = 'number' and v_value > (p_spec ->> 'max')::numeric)
       or (coalesce((p_spec ->> 'integer')::boolean, false) and v_value <> trunc(v_value)) then
      raise exception 'That number is out of range' using errcode = 'PT400', detail = 'answer_invalid';
    end if;
    return jsonb_build_object('value', v_value);
  elsif v_kind = 'text' then
    v_max_length := coalesce((p_spec ->> 'max_length')::int, 80);
    if jsonb_typeof(p_payload -> 'text') is distinct from 'string' then
      raise exception 'Answers are 1 to % characters', v_max_length using errcode = 'PT400', detail = 'answer_invalid';
    end if;
    v_text := btrim(p_payload ->> 'text', E' \t\r\n');
    if v_text = '' or char_length(v_text) > v_max_length then
      raise exception 'Answers are 1 to % characters', v_max_length using errcode = 'PT400', detail = 'answer_invalid';
    end if;
    return jsonb_build_object('text', v_text);
  end if;
  raise exception 'This question takes no answers' using errcode = 'PT400', detail = 'answer_invalid';
end;
$$;

-- One read per refresh, for every screen: the guest photos hotfix's body with
-- the guest list. players (and standings, through the view) are the guests who
-- joined, in join order, each with joined_at; guests is the host's whole list;
-- freed tells a phone the host gave its name back to the list. Runs as the
-- caller, so row level security decides what each screen gets. Every time is
-- epoch ms.
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
  v_exit text;
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
    -- How this phone's player left the party, the newest way: moved to another
    -- phone, its name freed by the host, or removed.
    v_exit := case when v_exists and p_screen = 'phone' then public.my_exit(p_session_id) end;
    return jsonb_build_object('now', public.epoch_ms(v_now), 'member', false, 'exists', v_exists, 'session', null,
      'games', '[]'::jsonb, 'prompts', '[]'::jsonb, 'tallies', '{}'::jsonb, 'game_points', '{}'::jsonb,
      'players', '[]'::jsonb, 'standings', '[]'::jsonb, 'feed', '[]'::jsonb,
      'me', null, 'states', null, 'screens', null, 'recap', null, 'guests', null,
      'moved', v_exit is not distinct from 'player.moved',
      'freed', v_exit is not distinct from 'player.freed');
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
    'freed', false,
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
    -- The guests who joined, in join order. A name on the guest list that
    -- nobody has taken is in no screen's players, standings or counts.
    'players', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'code', p.code,
        'profile', p.profile, 'photo', p.photo, 'joined_at', public.epoch_ms(p.joined_at),
        'created_at', public.epoch_ms(p.created_at)) order by p.joined_at, p.id), '[]'::jsonb)
      from public.players p where p.session_id = p_session_id and p.joined_at is not null),
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
    -- The host's guest list: everyone, joined or still expected (joined_at null), by name.
    'guests', case when p_screen = 'host' and v_host then (
        select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
          'joined_at', public.epoch_ms(p.joined_at), 'created_at', public.epoch_ms(p.created_at))
          order by public.name_key(p.name), p.id), '[]'::jsonb)
        from public.players p where p.session_id = p_session_id)
      end,
    'recap', (select jsonb_build_object('published_at', public.epoch_ms(r.published_at))
      from public.session_recaps r where r.session_id = p_session_id and r.published_at is not null)
  );
end;
$$;

-- The raw material for the recap builder (src/lib/recap.ts): the init file's
-- function with players reading the guests who joined and their join time.
-- Standings come from the filtered view, so the recap counts guests who came.
create or replace function public.session_recap(p_session_id uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  v jsonb;
begin
  if not public.is_host() then
    raise exception 'Only hosts can read this' using errcode = 'PT403', detail = 'not_host';
  end if;
  select jsonb_build_object(
    'session', (select jsonb_build_object('id', s.id, 'name', s.name, 'created_at', public.epoch_ms(s.created_at),
        'archived_at', public.epoch_ms(s.archived_at)) from public.sessions s where s.id = p_session_id),
    -- Everyone who ever joined: current players who joined (never a guest still
    -- expected), plus removed ones from their player.removed rows.
    'players', (select coalesce(jsonb_agg(x.player order by x.joined, x.id), '[]'::jsonb) from (
        select p.id, p.joined_at as joined, jsonb_build_object('id', p.id, 'name', p.name,
          'joined_at', public.epoch_ms(p.joined_at), 'removed_at', null, 'profile', p.profile) as player
        from public.players p where p.session_id = p_session_id and p.joined_at is not null
        union all
        select r.player_id, coalesce(j.at, r.at), jsonb_build_object('id', r.player_id, 'name', r.data ->> 'name',
          'joined_at', public.epoch_ms(coalesce(j.at, r.at)), 'removed_at', public.epoch_ms(r.at), 'profile', '{}'::jsonb)
        from public.event_log r
        left join lateral (select j0.at from public.event_log j0
          where j0.session_id = p_session_id and j0.kind = 'player.joined' and j0.player_id = r.player_id
          order by j0.id limit 1) j on true
        where r.session_id = p_session_id and r.kind = 'player.removed' and r.player_id is not null
          and not exists (select 1 from public.players p2 where p2.id = r.player_id)
      ) x),
    'games', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'title', g.title, 'game_type', g.game_type,
        'position', g.position, 'status', g.status) order by g.position, g.created_at, g.id), '[]'::jsonb)
      from public.session_games g where g.session_id = p_session_id),
    -- One per game.started row, joined to its game.finished row. A round still
    -- running uses the current game_states row.
    'rounds', (select coalesce(jsonb_agg(jsonb_build_object(
        'game_id', s.game_id, 'round', s.round, 'started_at', public.epoch_ms(s.at),
        'finished_at', public.epoch_ms(f.at), 'finished_by', f.data ->> 'by',
        'config', coalesce(s.data -> 'config', '{}'::jsonb),
        'state', case when f.id is not null then f.data -> 'state' else st.state end,
        'public_state', case when f.id is not null then f.data -> 'public_state' else g.public_state end,
        'scores', case when f.id is not null then coalesce(f.data -> 'scores', '{}'::jsonb) else coalesce(cur.scores, '{}'::jsonb) end,
        'points', case when f.id is not null then coalesce(f.data -> 'points', '{}'::jsonb) else coalesce(cur.points, '{}'::jsonb) end,
        'winners', case when f.id is not null then coalesce(f.data -> 'winners', '[]'::jsonb) else '[]'::jsonb end)
        order by s.id), '[]'::jsonb)
      from public.event_log s
      left join lateral (select f0.* from public.event_log f0
        where f0.session_id = p_session_id and f0.kind = 'game.finished' and f0.game_id = s.game_id and f0.round = s.round
        order by f0.id limit 1) f on true
      left join public.game_states st on st.game_id = s.game_id and st.round = s.round
      left join public.session_games g on g.id = s.game_id
      left join lateral (
        select
          (select coalesce(jsonb_object_agg(gs.player_id, gs.points), '{}'::jsonb)
            from public.game_scores gs where gs.game_id = s.game_id) as scores,
          (select coalesce(jsonb_object_agg(z.player_id, z.points), '{}'::jsonb) from (
            select y.player_id, sum(y.points)::int as points from (
              select gs.player_id, gs.points from public.game_scores gs where gs.game_id = s.game_id
              union all
              select se.player_id, se.points from public.score_events se
              where se.game_id = s.game_id and se.created_at >= s.at
            ) y group by y.player_id) z) as points
        where f.id is null
      ) cur on true
      where s.session_id = p_session_id and s.kind = 'game.started'),
    -- The whole log, without the bulky data of game.started and game.finished rows.
    'log', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'at', public.epoch_ms(e.at), 'kind', e.kind,
        'game_id', e.game_id, 'game_type', e.game_type, 'round', e.round, 'actor', e.actor, 'player_id', e.player_id,
        'about', to_jsonb(e.about),
        'data', case when e.kind in ('game.started', 'game.finished') then '{}'::jsonb else e.data end)
        order by e.id), '[]'::jsonb)
      from public.event_log e where e.session_id = p_session_id),
    'standings', (select coalesce(jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', b.name,
        'points', b.points) order by b.points desc, b.name, b.player_id), '[]'::jsonb)
      from public.scoreboard b where b.session_id = p_session_id)
  ) into v;
  return v;
end;
$$;

-- 7. Engine RPCs ------------------------------------------------------------------------
-- Games get only joined guests as their players. game_load adds the whole
-- guest list (names for settings and keys only), each player's joined_at and
-- the time of the game's last save, so the engine can tell an id the host
-- freed and someone took again (docs/engine-v2.md, 3.3).

-- The init file's function with players, guests and saved_at as above.
create or replace function public.game_load(p_game_id uuid, p_user_id uuid, p_close text[] default '{}', p_request_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_session uuid;
  v_type text;
  v_closed int := 0;
  v_n int;
  v jsonb;
begin
  select g.session_id, g.game_type into v_session, v_type from public.session_games g where g.id = p_game_id;
  if v_session is null then
    return null;
  end if;

  -- Only a host's close counts, so a guest can never close a question. Every
  -- close is logged here, in the same statement, because the request may
  -- still skip or be refused, and game_commit then finds the prompt closed.
  -- No request_id on these rows: the request's own claim must not look like
  -- a replay. The close time is in data, since a deadline close is in the past.
  if coalesce(cardinality(p_close), 0) > 0 and exists (select 1 from public.hosts h where h.user_id = p_user_id) then
    with closed as (
      update public.game_prompts set closed_at = clock_timestamp()
      where game_id = p_game_id and closed_at is null and key = any (p_close)
      returning key, round, closed_at
    ), logged as (
      insert into public.event_log (session_id, kind, game_id, game_type, round, actor, user_id, data)
      select v_session, 'prompt.closed', p_game_id, v_type, c.round, 'host', p_user_id,
        jsonb_build_object('key', c.key, 'round', c.round, 'closed_at', public.epoch_ms(c.closed_at))
      from closed c
      returning 1
    ) select count(*) into v_n from logged;
    v_closed := v_closed + v_n;
  end if;
  with closed as (
    update public.game_prompts set closed_at = closes_at
    where game_id = p_game_id and closed_at is null and closes_at <= clock_timestamp()
    returning key, round, closed_at
  ), logged as (
    insert into public.event_log (session_id, kind, game_id, game_type, round, actor, data)
    select v_session, 'prompt.closed', p_game_id, v_type, c.round, 'timer',
      jsonb_build_object('key', c.key, 'round', c.round, 'closed_at', public.epoch_ms(c.closed_at))
    from closed c
    returning 1
  ) select count(*) into v_n from logged;
  v_closed := v_closed + v_n;
  -- Phones learn of the close even when the request then skips or is refused.
  if v_closed > 0 then
    perform public.ping_session(v_session, 'room', jsonb_build_object('game', p_game_id));
  end if;

  select jsonb_build_object(
    'now', public.epoch_ms(clock_timestamp()),
    'claimed', p_request_id is not null and exists (
      select 1 from public.event_log e where e.user_id = p_user_id and e.request_id = p_request_id),
    'game', jsonb_build_object('id', g.id, 'session_id', g.session_id, 'game_type', g.game_type, 'title', g.title,
      'status', g.status, 'archived_at', public.epoch_ms(g.archived_at), 'wake_at', public.epoch_ms(g.wake_at)),
    'settings', coalesce((select gs.config from public.game_settings gs where gs.game_id = g.id), '{}'::jsonb),
    'current', (select jsonb_build_object('state', st.state, 'version', st.version, 'round', st.round,
        'config', st.config, 'members', to_jsonb(st.members), 'saved_at', public.epoch_ms(st.updated_at))
      from public.game_states st where st.game_id = g.id),
    'session', (select jsonb_build_object('id', s.id, 'name', s.name, 'data', s.data,
        'spotlight_game_id', s.spotlight_game_id)
      from public.sessions s where s.id = g.session_id),
    -- The guests who joined, in join order: only they play.
    'players', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'profile', p.profile,
        'joined_at', public.epoch_ms(p.joined_at))
        order by p.joined_at, p.id), '[]'::jsonb)
      from public.players p where p.session_id = g.session_id and p.joined_at is not null),
    -- Everyone on the guest list, joined or still expected: names for settings and keys only.
    'guests', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'joined', p.joined_at is not null)
        order by p.created_at, p.id), '[]'::jsonb)
      from public.players p where p.session_id = g.session_id),
    'caller', jsonb_build_object(
      'player_id', (select p.id from public.players p where p.session_id = g.session_id and p.user_id = p_user_id),
      'is_host', exists (select 1 from public.hosts h where h.user_id = p_user_id),
      'is_screen', exists (select 1 from public.session_screens sc
        where sc.session_id = g.session_id and sc.user_id = p_user_id)),
    'scoreboard', (select coalesce(jsonb_object_agg(b.player_id, b.points), '{}'::jsonb)
      from public.scoreboard b where b.session_id = g.session_id),
    -- This round's score_events for this game: host awards and game bonuses.
    'awards', (select coalesce(jsonb_object_agg(a.player_id, a.points), '{}'::jsonb) from (
        select se.player_id, sum(se.points)::int as points from public.score_events se
        where se.game_id = g.id and g.started_at is not null and se.created_at >= g.started_at
        group by se.player_id) a),
    'prompts', (select coalesce(jsonb_object_agg(pr.key, jsonb_build_object(
        'spec', pr.spec, 'opened_at', public.epoch_ms(pr.opened_at), 'closes_at', public.epoch_ms(pr.closes_at),
        'closed_at', public.epoch_ms(pr.closed_at), 'revealed_at', public.epoch_ms(pr.revealed_at),
        'submissions', case when pr.closed_at is not null and pr.revealed_at is null then (
          select coalesce(jsonb_agg(jsonb_build_object('player_id', su.player_id, 'answer', su.payload,
              'first_at', public.epoch_ms(su.first_at), 'at', public.epoch_ms(su.at),
              'ms', public.epoch_ms(su.first_at) - public.epoch_ms(pr.opened_at), 'changes', su.changes)
            order by su.first_at, su.player_id), '[]'::jsonb)
          from public.game_submissions su where su.game_id = pr.game_id and su.key = pr.key) end)), '{}'::jsonb)
      from public.game_prompts pr
      where pr.game_id = g.id and pr.round = (select st.round from public.game_states st where st.game_id = g.id))
  ) into v
  from public.session_games g where g.id = p_game_id;
  return v;
end;
$$;

-- The init file's function, copied exactly, with "and pl.joined_at is not null"
-- added to each of its six joins and filters on players. A request loads the
-- party, runs the game, then commits: if the host frees a guest in between,
-- the row is back (expected) under the same id, and without the filter this
-- commit would write that request's view, score, bonus, badge or toast onto
-- it, which the next person to take the name would inherit. With it, the
-- commit skips them, as it skips a removed guest.
create or replace function public.game_commit(p jsonb) returns jsonb
language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_req jsonb := coalesce(p -> 'request', '{}'::jsonb);
  v_type text := v_req ->> 'type';
  v_status text := p ->> 'status';
  v_now timestamptz := clock_timestamp();
  v_starting boolean := (p -> 'request' ->> 'type') = 'start';
  v_finishing boolean := (p ->> 'status') = 'finished';
  v_game public.session_games;
  v_state public.game_states;
  v_session uuid;
  v_round int;
  v_version int;
  v_cause bigint;
  v_n int;
  v_room boolean := false;
  v_prompt_opened boolean := false;
  v_players uuid[] := '{}';
  v_changed uuid[];
  v_members uuid[];
  v_winners uuid[];
  v_wake timestamptz;
  v_started_at timestamptz;
  v_public_state jsonb;
  v_scores_delta jsonb := '{}';
  v_points jsonb := '[]';
  v_profiles jsonb := '{}';
  v_session_data jsonb;
  v_announcements jsonb := '[]';
  v_public_announcement boolean := false;
  v_targeted uuid[] := '{}';
  v_opened jsonb := '[]';
  v_closed jsonb := '[]';
  v_revealed jsonb := '[]';
  v_effects jsonb;
  v_spot uuid;
  v_spot_at timestamptz;
  v_scene text;
  v_free boolean;
begin
  if v_type is null or v_type not in ('start', 'end', 'action', 'host-action', 'sync') then
    raise exception 'Unknown request type' using errcode = 'PT400', detail = 'bad_request';
  end if;
  perform set_config('hurra.engine', 'on', true);

  -- The game row lock serialises every save of this game (a copy racing its original waits here).
  select * into v_game from public.session_games where id = public.try_uuid(p ->> 'game_id') for no key update;
  if not found then
    raise exception 'Game not found' using errcode = 'PT404', detail = 'not_found';
  end if;
  v_session := v_game.session_id;
  -- A removal in flight finishes first, and one that starts later waits for
  -- this save, so every statement below sees the same players: a view row of
  -- a guest being removed is never written back (a foreign key error), and the
  -- save and the removal never deadlock over it.
  perform 1 from public.players where session_id = v_session for key share;
  select * into v_state from public.game_states where game_id = v_game.id for update;
  v_round := case when v_starting then coalesce(v_state.round, 0) + 1 else v_state.round end;

  -- The claim, the first write. Nothing inserted: a copy of a saved request.
  insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, player_id, user_id, request_id, about, data)
  values (v_session, v_now,
    case v_type when 'start' then 'game.start' when 'end' then 'game.end' when 'action' then 'game.action'
      when 'host-action' then 'game.host_action' else 'game.sync' end,
    v_game.id, v_game.game_type, v_round,
    case when v_req ->> 'actor' in ('player', 'host', 'timer', 'system') then v_req ->> 'actor' else 'system' end,
    public.try_uuid(v_req ->> 'player_id'), public.try_uuid(v_req ->> 'user_id'), public.try_uuid(v_req ->> 'id'),
    case when public.try_uuid(v_req ->> 'player_id') is not null then array[public.try_uuid(v_req ->> 'player_id')] else '{}'::uuid[] end,
    case v_type
      when 'start' then jsonb_build_object('stage', coalesce(p -> 'stage', 'null'::jsonb))
      when 'end' then '{}'::jsonb
      when 'action' then jsonb_build_object('action', coalesce(v_req -> 'action', 'null'::jsonb))
      when 'host-action' then jsonb_build_object('action', coalesce(v_req -> 'action', 'null'::jsonb),
        'close', coalesce(v_req -> 'close', '[]'::jsonb))
      else jsonb_build_object('woke', coalesce(p #> '{log,woke}', '0'::jsonb))
    end)
  on conflict (user_id, request_id) where request_id is not null do nothing
  returning id into v_cause;
  if v_cause is null then
    return jsonb_build_object('replayed', true);
  end if;

  -- The checks. Any refusal rolls the claim back with it.
  if v_starting and v_game.archived_at is not null then
    raise exception 'Unarchive this game before starting it' using errcode = 'PT409', detail = 'archived';
  elsif v_starting and v_game.status = 'active' then
    raise exception 'This game is already running' using errcode = 'PT409', detail = 'already_running';
  elsif not v_starting and (v_game.status <> 'active' or v_state.game_id is null) then
    raise exception 'This game is not running' using errcode = 'PT409', detail = 'not_running';
  elsif not v_starting and (p ->> 'expected_round') is not null and v_state.round <> (p ->> 'expected_round')::int then
    raise exception 'The game was restarted' using errcode = 'PT409', detail = 'restarted';
  elsif not v_starting and v_state.version is distinct from (p ->> 'expected_version')::int then
    -- Not SQLSTATE 40001: PostgREST retries a transaction that fails with it,
    -- and a version conflict fails the same way every time. The engine retries.
    raise exception 'Game state changed concurrently' using errcode = 'PT409', detail = 'stale';
  end if;

  -- State. A start deals a new round and drops the old round's prompts (their
  -- answers cascade; the log keeps every one).
  v_members := coalesce(array(select public.try_uuid(x) from jsonb_array_elements_text(coalesce(p -> 'members', '[]'::jsonb)) x
    where public.try_uuid(x) is not null), '{}');
  if v_starting then
    insert into public.game_states as st (game_id, round, version, state, config, members)
    values (v_game.id, v_round, 1, coalesce(p -> 'state', 'null'::jsonb), coalesce(p -> 'config', '{}'::jsonb), v_members)
    on conflict (game_id) do update set round = excluded.round, version = st.version + 1, state = excluded.state,
      config = excluded.config, members = excluded.members, updated_at = now()
    returning version into v_version;
    delete from public.game_prompts where game_id = v_game.id;
  else
    update public.game_states set state = coalesce(p -> 'state', 'null'::jsonb), version = version + 1,
      members = v_members, updated_at = now()
    where game_id = v_game.id
    returning version into v_version;
  end if;

  -- Projections, for players still in the party only. Each is skipped when its
  -- key is absent (End's fail-open path keeps the stored ones).
  if p ? 'player_views' and jsonb_typeof(p -> 'player_views') = 'object' then
    with changed as (
      insert into public.game_player_views as gv (game_id, player_id, view)
      select v_game.id, pl.id, v.value
      from jsonb_each(p -> 'player_views') v
      join public.players pl on pl.id = public.try_uuid(v.key) and pl.session_id = v_session and pl.joined_at is not null
      on conflict (game_id, player_id) do update set view = excluded.view
      where gv.view is distinct from excluded.view
      returning gv.player_id
    ) select coalesce(array_agg(player_id), '{}') into v_changed from changed;
    v_players := v_players || v_changed;
  end if;

  if p ? 'scores' and jsonb_typeof(p -> 'scores') = 'object' then
    with old as (
      select gs.player_id, gs.points from public.game_scores gs where gs.game_id = v_game.id
    ), new as (
      select pl.id as player_id, round((s.value)::numeric)::int as points
      from jsonb_each_text(p -> 'scores') s
      join public.players pl on pl.id = public.try_uuid(s.key) and pl.session_id = v_session and pl.joined_at is not null
    )
    select coalesce(jsonb_object_agg(coalesce(n.player_id, o.player_id), coalesce(n.points, 0) - coalesce(o.points, 0)), '{}'::jsonb)
    into v_scores_delta
    from old o full join new n on n.player_id = o.player_id
    where coalesce(n.points, 0) <> coalesce(o.points, 0);

    delete from public.game_scores gs where gs.game_id = v_game.id and not ((p -> 'scores') ? gs.player_id::text);
    insert into public.game_scores as gs (game_id, player_id, session_id, points)
    select v_game.id, pl.id, v_session, round((s.value)::numeric)::int
    from jsonb_each_text(p -> 'scores') s
    join public.players pl on pl.id = public.try_uuid(s.key) and pl.session_id = v_session and pl.joined_at is not null
    on conflict (game_id, player_id) do update set points = excluded.points
    where gs.points is distinct from excluded.points;
    if v_scores_delta <> '{}'::jsonb then
      v_room := true;
    end if;
  end if;

  -- Effects: bonus points, profile and session data, announcements, records.
  with awarded as (
    insert into public.score_events (session_id, player_id, game_id, points, reason, awarded_by, created_at)
    select v_session, pl.id, v_game.id, (e.value ->> 'points')::int, nullif(left(coalesce(e.value ->> 'reason', ''), 200), ''),
      null, v_now
    from jsonb_array_elements(coalesce(p #> '{effects,points}', '[]'::jsonb)) with ordinality e
    join public.players pl on pl.id = public.try_uuid(e.value ->> 'player_id') and pl.session_id = v_session and pl.joined_at is not null
    where (e.value ->> 'points')::int <> 0
    order by e.ordinality
    returning player_id, points, reason
  ) select coalesce(jsonb_agg(jsonb_build_object('player_id', a.player_id, 'points', a.points, 'reason', a.reason)), '[]'::jsonb)
    into v_points from awarded a;
  if v_points <> '[]'::jsonb then
    v_room := true;
  end if;

  with patched as (
    update public.players pl
    set profile = pl.profile || jsonb_build_object(v_game.game_type,
      coalesce(pl.profile -> v_game.game_type, '{}'::jsonb) || patch.value)
    from jsonb_each(coalesce(p #> '{effects,profiles}', '{}'::jsonb)) patch
    where pl.id = public.try_uuid(patch.key) and pl.session_id = v_session and pl.joined_at is not null
      and jsonb_typeof(patch.value) = 'object'
      and (pl.profile -> v_game.game_type) is distinct from
          (coalesce(pl.profile -> v_game.game_type, '{}'::jsonb) || patch.value)
    returning pl.id, patch.value
  ) select coalesce(jsonb_object_agg(x.id, x.value), '{}'::jsonb) into v_profiles from patched x;
  if v_profiles <> '{}'::jsonb then
    v_room := true;
  end if;

  if jsonb_typeof(p #> '{effects,session_data}') = 'object' then
    update public.sessions s
    set data = s.data || jsonb_build_object(v_game.game_type,
      coalesce(s.data -> v_game.game_type, '{}'::jsonb) || (p #> '{effects,session_data}'))
    where s.id = v_session
      and (s.data -> v_game.game_type) is distinct from
          (coalesce(s.data -> v_game.game_type, '{}'::jsonb) || (p #> '{effects,session_data}'));
    get diagnostics v_n = row_count;
    if v_n > 0 then
      v_room := true;
      v_session_data := p #> '{effects,session_data}';
    end if;
  end if;

  -- A targeted announcement keeps only players still present, and is dropped
  -- (never made public) when none are.
  with a as (
    select x.value as a, x.ordinality as i,
      case when jsonb_typeof(x.value -> 'to') = 'array' then (
        select coalesce(array_agg(pl.id order by t.ordinality), '{}')
        from jsonb_array_elements_text(x.value -> 'to') with ordinality t
        join public.players pl on pl.id = public.try_uuid(t.value) and pl.session_id = v_session and pl.joined_at is not null) end as ids
    from jsonb_array_elements(coalesce(p #> '{effects,announcements}', '[]'::jsonb)) with ordinality x
  ), ins as (
    insert into public.session_feed (session_id, game_id, message, detail, audience, sound, icon, tone, interrupt, created_at)
    select v_session, v_game.id, left(a.a ->> 'message', 280), nullif(left(coalesce(a.a ->> 'detail', ''), 280), ''),
      a.ids, left(a.a ->> 'sound', 40), left(a.a ->> 'icon', 40), left(a.a ->> 'tone', 20),
      coalesce((a.a ->> 'interrupt')::boolean, false), v_now
    from a
    where coalesce(a.a ->> 'message', '') <> '' and (a.ids is null or cardinality(a.ids) > 0)
    order by a.i
    returning id, message, detail, audience, sound, icon, tone, interrupt
  )
  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object('id', ins.id, 'message', ins.message, 'detail', ins.detail,
      'to', to_jsonb(ins.audience), 'sound', ins.sound, 'icon', ins.icon, 'tone', ins.tone,
      'interrupt', case when ins.interrupt then true end)) order by ins.id), '[]'::jsonb),
    coalesce(bool_or(ins.audience is null), false),
    coalesce((select array_agg(u) from ins i2, unnest(i2.audience) u), '{}')
  into v_announcements, v_public_announcement, v_targeted
  from ins;
  if v_public_announcement then
    v_room := true;
  end if;
  v_players := v_players || v_targeted;

  insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, cause_id, about, data)
  select v_session, v_now, 'game.record', v_game.id, v_game.game_type, v_round, 'game', v_cause,
    coalesce(array(select public.try_uuid(t) from jsonb_array_elements_text(
      case when jsonb_typeof(r.value -> 'about') = 'array' then r.value -> 'about' else '[]'::jsonb end) t
      where public.try_uuid(t) is not null), '{}'),
    jsonb_build_object('type', r.value ->> 'type')
      || case when jsonb_typeof(r.value -> 'data') = 'object' then r.value -> 'data' else '{}'::jsonb end
  from jsonb_array_elements(coalesce(p #> '{effects,records}', '[]'::jsonb)) with ordinality r
  order by r.ordinality;

  -- Prompts. Closing (and revealing) waits for answers in flight. A finish
  -- closes every prompt still open.
  with opened as (
    insert into public.game_prompts (game_id, key, round, spec, opened_at, closes_at)
    select v_game.id, o.value ->> 'key', v_round, o.value -> 'spec', v_now,
      case when jsonb_typeof(o.value -> 'closes_at') = 'number'
        then timestamptz 'epoch' + round((o.value ->> 'closes_at')::numeric) * interval '1 millisecond' end
    from jsonb_array_elements(coalesce(p #> '{effects,prompts,open}', '[]'::jsonb)) o
    returning key
  ) select coalesce(jsonb_agg(key), '[]'::jsonb) into v_opened from opened;
  if v_opened <> '[]'::jsonb then
    v_room := true;
    v_prompt_opened := true;
  end if;

  with closed as (
    update public.game_prompts pr set closed_at = v_now
    where pr.game_id = v_game.id and pr.closed_at is null
      and (v_finishing
        or pr.key in (select jsonb_array_elements_text(coalesce(p #> '{effects,prompts,close}', '[]'::jsonb)))
        or pr.key in (select jsonb_array_elements_text(coalesce(p #> '{effects,prompts,reveal}', '[]'::jsonb))))
    returning pr.key
  ) select coalesce(jsonb_agg(key), '[]'::jsonb) into v_closed from closed;
  with revealed as (
    update public.game_prompts pr set revealed_at = v_now
    where pr.game_id = v_game.id and pr.revealed_at is null
      and pr.key in (select jsonb_array_elements_text(coalesce(p #> '{effects,prompts,reveal}', '[]'::jsonb)))
    returning pr.key
  ) select coalesce(jsonb_agg(key), '[]'::jsonb) into v_revealed from revealed;
  if v_closed <> '[]'::jsonb or v_revealed <> '[]'::jsonb then
    v_room := true;
  end if;

  -- The game row, only when a value changes.
  v_wake := case
    when v_finishing then null
    when jsonb_typeof(p -> 'wake_at') = 'number' then timestamptz 'epoch' + round((p ->> 'wake_at')::numeric) * interval '1 millisecond'
  end;
  v_winners := case
    when v_finishing then coalesce(array(select public.try_uuid(x) from jsonb_array_elements_text(
      case when jsonb_typeof(p -> 'winners') = 'array' then p -> 'winners' else '[]'::jsonb end) x
      where public.try_uuid(x) is not null), '{}')
    when v_starting then '{}'::uuid[]
    else v_game.winners
  end;
  v_public_state := case when p ? 'public_state' then p -> 'public_state' else v_game.public_state end;
  update public.session_games set
    public_state = v_public_state,
    status = coalesce(v_status, status),
    started_at = case when v_starting then v_now else started_at end,
    finished_at = case when v_finishing then v_now when v_starting then null else finished_at end,
    finished_by = case when v_finishing then coalesce(p ->> 'finished_by', 'host') when v_starting then null else finished_by end,
    winners = v_winners,
    wake_at = v_wake
  where id = v_game.id
    and (v_status is not null
      or public_state is distinct from v_public_state
      or wake_at is distinct from v_wake
      or winners is distinct from v_winners);
  get diagnostics v_n = row_count;
  if v_n > 0 then
    v_room := true;
  end if;
  v_started_at := case when v_starting then v_now else v_game.started_at end;

  -- Log rows, all following the claim.
  v_effects := jsonb_strip_nulls(jsonb_build_object(
    'announcements', nullif(v_announcements, '[]'::jsonb),
    'points', nullif(v_points, '[]'::jsonb),
    'profiles', nullif(v_profiles, '{}'::jsonb),
    'session_data', v_session_data,
    'scores', nullif(v_scores_delta, '{}'::jsonb),
    'prompts', nullif(jsonb_strip_nulls(jsonb_build_object('opened', nullif(v_opened, '[]'::jsonb),
      'closed', nullif(v_closed, '[]'::jsonb), 'revealed', nullif(v_revealed, '[]'::jsonb))), '{}'::jsonb),
    'members', nullif(jsonb_strip_nulls(jsonb_build_object(
      'joined', nullif(coalesce(p #> '{log,joined}', '[]'::jsonb), '[]'::jsonb),
      'left', nullif(coalesce(p #> '{log,left}', '[]'::jsonb), '[]'::jsonb))), '{}'::jsonb),
    'woke', nullif(coalesce(p #> '{log,woke}', '0'::jsonb), '0'::jsonb)
  ));
  if v_effects <> '{}'::jsonb then
    insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, cause_id, about, data)
    values (v_session, v_now, 'game.effects', v_game.id, v_game.game_type, v_round, 'game', v_cause,
      coalesce(array(select distinct x from unnest(v_players || coalesce(array(select public.try_uuid(k)
        from jsonb_object_keys(v_scores_delta) k), '{}')) x where x is not null), '{}'),
      v_effects);
  end if;

  if v_starting then
    insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, cause_id, about, data)
    values (v_session, v_now, 'game.started', v_game.id, v_game.game_type, v_round, 'game', v_cause, v_members,
      jsonb_build_object('title', v_game.title, 'game_type', v_game.game_type, 'config', coalesce(p -> 'config', '{}'::jsonb),
        'state', coalesce(p -> 'state', 'null'::jsonb), 'public_state', coalesce(v_public_state, 'null'::jsonb),
        'members', to_jsonb(v_members)));
  end if;

  if v_finishing then
    insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, cause_id, about, data)
    values (v_session, v_now, 'game.finished', v_game.id, v_game.game_type, v_round,
      case when p ->> 'finished_by' = 'game' then 'game' else 'host' end, v_cause, v_winners,
      jsonb_build_object('title', v_game.title, 'game_type', v_game.game_type,
        'by', coalesce(p ->> 'finished_by', 'host'), 'winners', to_jsonb(v_winners),
        'state', coalesce(p -> 'state', 'null'::jsonb), 'public_state', coalesce(v_public_state, 'null'::jsonb),
        'scores', (select coalesce(jsonb_object_agg(gs.player_id, gs.points), '{}'::jsonb)
          from public.game_scores gs where gs.game_id = v_game.id),
        'points', (select coalesce(jsonb_object_agg(z.player_id, z.points), '{}'::jsonb) from (
          select y.player_id, sum(y.points)::int as points from (
            select gs.player_id, gs.points from public.game_scores gs where gs.game_id = v_game.id
            union all
            select se.player_id, se.points from public.score_events se
            where se.game_id = v_game.id and se.created_at >= v_started_at
          ) y group by y.player_id) z)));
  end if;

  if coalesce(p #>> '{log,wake_stuck}', 'false') = 'true' then
    insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, cause_id, data)
    values (v_session, v_now, 'game.wake_stuck', v_game.id, v_game.game_type, v_round, 'game', v_cause,
      jsonb_build_object('wake_at', public.epoch_ms(v_game.wake_at)));
  end if;

  -- The TV stage. Starting on the stage takes it. A finishing game takes the
  -- stage when it is free or already its own; free means no spotlight, a
  -- missing, archived or pending spotlit game, or one whose final screen
  -- (3 minutes from max(finished_at, spotlight_at)) is over.
  select s.spotlight_game_id, s.spotlight_at, s.tv_scene into v_spot, v_spot_at, v_scene
  from public.sessions s where s.id = v_session for no key update;
  if v_starting and p ->> 'stage' = 'take' then
    if v_spot is distinct from v_game.id or v_scene <> 'live' then
      update public.sessions set spotlight_game_id = v_game.id, tv_scene = 'live' where id = v_session;
      v_room := true;
    end if;
    if v_spot is distinct from v_game.id then
      insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, cause_id, data)
      values (v_session, v_now, 'stage.changed', v_game.id, v_game.game_type, v_round, 'host', v_cause,
        jsonb_build_object('game_id', v_game.id, 'title', v_game.title, 'reason', 'start'));
    end if;
    -- The sessions trigger is quiet while the engine runs, so leaving the recap is logged here.
    if v_scene <> 'live' then
      insert into public.event_log (session_id, at, kind, actor, cause_id, data)
      values (v_session, v_now, 'session.tv_scene', 'host', v_cause,
        jsonb_build_object('tv_scene', 'live', 'reason', 'start'));
    end if;
  elsif v_starting and p ->> 'stage' = 'keep' and v_spot = v_game.id then
    -- A restart in the background of the game whose final screen is up.
    update public.sessions set spotlight_game_id = null where id = v_session;
    insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, cause_id, data)
    values (v_session, v_now, 'stage.changed', null, null, null, 'host', v_cause,
      jsonb_build_object('game_id', null, 'title', null, 'reason', 'start'));
    v_room := true;
  elsif v_finishing and v_spot is distinct from v_game.id then
    v_free := v_spot is null or not exists (
      select 1 from public.session_games o
      where o.id = v_spot and o.archived_at is null
        and (o.status = 'active'
          or (o.status = 'finished' and v_now <= greatest(o.finished_at, v_spot_at) + interval '3 minutes')));
    if v_free then
      update public.sessions set spotlight_game_id = v_game.id where id = v_session;
      insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, cause_id, data)
      values (v_session, v_now, 'stage.changed', v_game.id, v_game.game_type, v_round, 'game', v_cause,
        jsonb_build_object('game_id', v_game.id, 'title', v_game.title, 'reason', 'finish'));
      v_room := true;
    end if;
  end if;

  -- One ping. Anything the room sees: every screen (prompt: true when a prompt
  -- just opened, so phones read at once). Otherwise only the players whose own
  -- view changed or who got a targeted announcement (the room when that's
  -- more than 10), plus the host page, which shows the full state.
  if v_room then
    perform public.ping_session(v_session, 'room', jsonb_build_object('game', v_game.id)
      || case when v_prompt_opened then jsonb_build_object('prompt', true) else '{}'::jsonb end);
  else
    select coalesce(array_agg(distinct x), '{}') into v_players from unnest(v_players) x where x is not null;
    if cardinality(v_players) > 10 then
      perform public.ping_session(v_session, 'room', jsonb_build_object('game', v_game.id));
    else
      perform public.ping_player(v_session, x) from unnest(v_players) x;
      perform public.ping_session(v_session, 'stage', jsonb_build_object('game', v_game.id));
    end if;
  end if;

  return jsonb_build_object('replayed', false, 'version', v_version, 'round', v_round, 'now', public.epoch_ms(v_now));
end;
$$;

-- 8. Function grants: everything revoked, then exactly what each role needs ---------------

revoke execute on function
  public.my_exit(uuid), public.log_player_change(), public.join_session(text, text),
  public.guest_list(text), public.claim_guest(text, text), public.host_add_guests(uuid, text[]),
  public.host_free_guest(uuid), public.claim_player(text), public.check_answer(jsonb, jsonb, uuid, uuid),
  public.session_snapshot(uuid, text), public.session_recap(uuid),
  public.game_load(uuid, uuid, text[], uuid), public.game_commit(jsonb)
from public, anon, authenticated;

-- my_exit: the invoker snapshot calls it as the caller. The rest: what the app calls.
grant execute on function
  public.my_exit(uuid), public.join_session(text, text), public.guest_list(text),
  public.claim_guest(text, text), public.host_add_guests(uuid, text[]), public.host_free_guest(uuid),
  public.claim_player(text), public.session_snapshot(uuid, text), public.session_recap(uuid)
to authenticated, service_role;

-- The engine (and submit_answer, which runs check_answer as its owner).
grant execute on function
  public.check_answer(jsonb, jsonb, uuid, uuid), public.game_load(uuid, uuid, text[], uuid), public.game_commit(jsonb)
to service_role;

-- PostgREST reloads its schema cache on DDL by itself (pgrst_ddl_watch); this
-- makes sure the new RPCs answer the moment the file commits.
notify pgrst, 'reload schema';

-- 9. Self-checks: the guest photos hotfix's, updated for this file ------------------------
-- From here on this block is the current one: a later hotfix copies it, not the init's,
-- the sound volume hotfix's or the guest photos hotfix's. A later file that replaces one of
-- the functions below from an older copy then fails here instead of quietly showing
-- expected guests to the room.

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
    if (r.proname in ('game_load', 'game_commit', 'ping', 'ping_session', 'ping_player', 'check_answer')
        or r.prorettype = 'trigger'::regtype)
       and has_function_privilege('authenticated', r.oid, 'execute') then
      v_problems := v_problems || format('authenticated can execute %s', r.proname);
    end if;
    if r.proname in ('game_load', 'game_commit', 'ping', 'ping_session', 'ping_player')
       and not has_function_privilege('service_role', r.oid, 'execute') then
      v_problems := v_problems || format('service_role can''t execute %s', r.proname);
    end if;
    -- The storage policies call the four helpers as the caller, and the app calls the two photo functions.
    -- New: the snapshot calls my_exit as the caller, and the app calls the guest list's functions.
    if r.proname in ('is_photo_path', 'owns_photo_path', 'may_upload_photo', 'may_delete_photo', 'set_my_photo',
                     'host_remove_photo', 'my_exit', 'guest_list', 'claim_guest', 'host_add_guests', 'host_free_guest',
                     'join_session', 'claim_player', 'session_snapshot')
       and not (has_function_privilege('authenticated', r.oid, 'execute')
                and has_function_privilege('service_role', r.oid, 'execute')) then
      v_problems := v_problems || format('authenticated or service_role can''t execute %s', r.proname);
    end if;
  end loop;
  -- The photo functions exist. New: and the guest list's.
  foreach v_name in array array['is_photo_path', 'owns_photo_path', 'may_upload_photo', 'may_delete_photo',
                                'log_player_photo', 'set_my_photo', 'host_remove_photo', 'my_exit', 'guest_list',
                                'claim_guest', 'host_add_guests', 'host_free_guest'] loop
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

  -- Engine-owned columns are never in a client grant: players.photo and players.photo_set_at, written only by the
  -- photo functions. New: players.joined_at, written only by the guest list's functions.
  for r in
    select * from (values
      ('session_games', 'status'), ('session_games', 'public_state'), ('session_games', 'started_at'),
      ('session_games', 'finished_at'), ('session_games', 'finished_by'), ('session_games', 'winners'),
      ('session_games', 'wake_at'), ('sessions', 'data'), ('sessions', 'spotlight_at'),
      ('players', 'profile'), ('players', 'user_id'), ('players', 'session_id'), ('players', 'photo'),
      ('players', 'photo_set_at'), ('players', 'joined_at'), ('score_events', 'awarded_by')
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

  -- New: joined and expected guests. The check that ties joined_at to user_id, the members' read policy that hides
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
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.players'::regclass
                 and t.tgname = 'players_logged' and not t.tgisinternal and t.tgenabled <> 'D') then
    v_problems := v_problems || 'the players_logged trigger is missing or disabled'::text;
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

  -- New: every function that hands players to a screen or a game keeps only joined guests. A later file that
  -- replaces one from a body older than this file's would show expected guests on the TV, the phones and in games.
  v_def := pg_get_functiondef('public.session_snapshot(uuid, text)'::regprocedure);
  if v_def not like '%p.joined_at is not null%' or v_def not like '%''guests''%' or v_def not like '%''freed''%' then
    v_problems := v_problems || 'session_snapshot no longer keeps players to joined guests, or lacks guests or freed'::text;
  end if;
  v_def := pg_get_functiondef('public.game_load(uuid, uuid, text[], uuid)'::regprocedure);
  if v_def not like '%p.joined_at is not null%' or v_def not like '%''guests''%' or v_def not like '%''saved_at''%' then
    v_problems := v_problems || 'game_load no longer keeps players to joined guests, or lacks guests or saved_at'::text;
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
