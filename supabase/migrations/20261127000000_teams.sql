-- Hurra hotfix: teams (docs/user-flows.md, "Teams").
--
-- Additive on top of the v2 init file and the hotfixes up to the guest list
-- (20261126000000_guest_list.sql). A party can have teams: the host splits the
-- guests who are here into 2 to 6 balanced teams, renames them, moves a guest
-- from one to another and clears them. A team follows the guest all night. A
-- game whose module opts in (GameModule.teamPlay) can be played in teams: the
-- host switches session_games.team_play on before it starts, and then one
-- answer from any member counts for the whole team. submit_answer writes the
-- same answer, with the same time, for every member still in the party, so
-- every member simply has the answer and the game scores each of them as
-- always. With team_play off, or for a guest in no team, submit_answer does
-- exactly what it did before.
--
-- Safe on production while the v2-rc7 app is live: three new nullable or
-- defaulted columns (players.team_id, session_games.team_play false,
-- game_submissions.answered_by), one new table, new host functions, one new
-- trigger that does nothing while a party has no teams, and two replaced
-- functions (submit_answer and session_snapshot) that keep their signatures
-- and return a superset, the same as before for a party without teams.
-- Nothing is renamed or dropped.
--
-- Rules as in the init file (docs/engine-v2.md, 2.1): set search_path = '' and
-- fully qualified names, security definer only where a function must read or
-- write past row level security, every function revoked and then granted
-- exactly, custom SQLSTATEs with the machine code in DETAIL, and a copy of the
-- self-checks at the end, updated for this file. The file holds no data.

-- A busy players table makes this wait at most 5 s; then the whole file rolls
-- back and nothing is applied. Push again a minute later.
set lock_timeout = '5s';

-- 1. The teams table, and the three columns -----------------------------------------
-- A team belongs to one party. Its colour is a key into the app's palette
-- (src/lib/teams.ts): the confetti's gold, pink, teal and violet, then the
-- guest tokens' sky and lime. Names are stored clean, like guests' names, and
-- two teams of a party can't share one.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40 and public.name_key(name) <> ''),
  colour text not null check (colour in ('gold', 'pink', 'teal', 'violet', 'sky', 'lime')),
  position int not null default 0,
  created_at timestamptz not null default now(),
  unique (id, session_id)
);
create index teams_session_idx on public.teams (session_id, position);
create unique index teams_session_name_key on public.teams (session_id, public.name_key(name));
-- The players' own trigger function: it only cleans new.name.
create trigger teams_clean_name before insert or update of name on public.teams
  for each row execute function public.clean_player_name();

-- A guest's team; null for none. The pair keeps a guest in a team of their own
-- party; clearing a team sets only team_id back to null.
alter table public.players add column team_id uuid;
alter table public.players add constraint players_team_fkey foreign key (team_id, session_id)
  references public.teams (id, session_id) on delete set null (team_id);
create index players_team_idx on public.players (team_id) where team_id is not null;

-- Whether a game is played in teams. Changed only while it isn't live.
alter table public.session_games add column team_play boolean not null default false;

-- Who gave the answer, when submit_answer wrote it for a whole team (the
-- teammate who answered, possibly this player); null for an answer of one's own.
alter table public.game_submissions add column answered_by uuid;

-- 2. Row level security and grants ----------------------------------------------------
-- Hosts and members of the party read its teams (as they read its players);
-- nobody writes them directly: only the host functions below.

alter table public.teams enable row level security;
revoke all on public.teams from anon, authenticated;
grant select on public.teams to authenticated;
grant select, insert, update, delete on public.teams to service_role;
create policy "Hosts and members read teams" on public.teams
  for select to authenticated
  using ((select public.is_host()) or session_id = any ((select public.my_session_ids())::uuid[]));

-- The new columns need no grant of their own: players, session_games and
-- game_submissions grant clients only named columns or reads, so team_id,
-- team_play and answered_by are in no client write grant (the self-checks
-- below say so), and service_role's table grants cover them.

-- 3. A guest who joins goes into the smallest team --------------------------------------
-- While a party has teams, a guest who joins (join_session, or a name taken
-- from the guest list by claim_guest or a host's move code) goes into the team
-- with the fewest joined members; a tie goes to the lowest position. Nothing
-- happens for a party without teams, a name added to the list, a phone move or
-- a row host_free_guest adds back. Locking the party's teams makes two joins
-- at the same moment take turns, so they don't both land in the same team.

create function public.join_smallest_team() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.user_id is null or new.team_id is not null or (tg_op = 'UPDATE' and old.user_id is not null) then
    return new;
  end if;
  perform 1 from public.teams t where t.session_id = new.session_id for no key update;
  if not found then
    return new;
  end if;
  select t.id into new.team_id
  from public.teams t
  left join public.players p on p.team_id = t.id and p.joined_at is not null and p.id <> new.id
  where t.session_id = new.session_id
  group by t.id, t.position, t.created_at
  order by count(p.id), t.position, t.created_at, t.id
  limit 1;
  return new;
end;
$$;
create trigger players_join_team before insert or update of user_id on public.players
  for each row execute function public.join_smallest_team();

-- 4. Host functions ----------------------------------------------------------------------
-- Each checks is_host(), logs one row and pings the room once, so every
-- phone, the TV and the host page see the change at once.

-- A team's default name and colour by its place: Team Gold, Team Pink, Team
-- Teal, Team Violet, Team Sky, Team Lime.
create function public.team_colours() returns text[]
language sql immutable set search_path = '' as $$
  select array['gold', 'pink', 'teal', 'violet', 'sky', 'lime']
$$;

-- Refuses while a game of the party played in teams is live: making or
-- clearing teams then would change who answers for whom in the middle of it.
create function public.refuse_while_team_game_live(p_session_id uuid, p_what text) returns void
language plpgsql stable security definer set search_path = '' as $$
declare
  v_title text;
begin
  select g.title into v_title from public.session_games g
  where g.session_id = p_session_id and g.status = 'active' and g.archived_at is null and g.team_play
  order by g.position, g.created_at limit 1;
  if found then
    raise exception 'End % before you % teams', v_title, p_what using errcode = 'PT409', detail = 'team_game_live';
  end if;
end;
$$;

-- Makes p_count teams (2 to 6) and splits the guests who are here between them
-- at random, as evenly as it goes (sizes differ by one at most). Run again, it
-- shuffles everyone again: teams up to the new count keep their names and
-- colours, the rest go, and missing ones come with the next free colour.
-- Guests still expected stay out of every team until they join.
create function public.host_make_teams(p_session_id uuid, p_count int) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_session public.sessions;
  v_colours text[] := public.team_colours();
  v_teams uuid[];
  v_colour text;
  v_name text;
  v_n int;
  v_id uuid;
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
  if p_count is null or p_count < 2 or p_count > 6 then
    raise exception 'Make 2 to 6 teams' using errcode = 'PT400', detail = 'bad_count';
  end if;
  perform public.refuse_while_team_game_live(p_session_id, 'make new');
  perform 1 from public.teams where session_id = p_session_id for update;

  -- Teams past the new count go; their guests' team_id goes back to null.
  delete from public.teams where session_id = p_session_id and id not in (
    select t.id from public.teams t where t.session_id = p_session_id
    order by t.position, t.created_at, t.id limit p_count);
  -- The rest keep their order, from 0.
  update public.teams t set position = o.n - 1
  from (select t0.id, row_number() over (order by t0.position, t0.created_at, t0.id) as n
        from public.teams t0 where t0.session_id = p_session_id) o
  where t.id = o.id and t.position is distinct from o.n - 1;
  -- Then the missing ones, each in the first colour no team has.
  select count(*) into v_n from public.teams where session_id = p_session_id;
  while v_n < p_count loop
    select c into v_colour from unnest(v_colours) with ordinality as x(c, i)
    where not exists (select 1 from public.teams t where t.session_id = p_session_id and t.colour = x.c)
    order by i limit 1;
    v_name := 'Team ' || initcap(v_colour);
    if exists (select 1 from public.teams t where t.session_id = p_session_id and public.name_key(t.name) = public.name_key(v_name)) then
      v_name := v_name || ' ' || (v_n + 1);
    end if;
    insert into public.teams (session_id, name, colour, position) values (p_session_id, v_name, v_colour, v_n);
    v_n := v_n + 1;
  end loop;

  -- Everyone here, shuffled, dealt round the teams in order.
  select array_agg(t.id order by t.position, t.created_at, t.id) into v_teams from public.teams t where t.session_id = p_session_id;
  update public.players p set team_id = v_teams[1 + ((d.n - 1) % p_count)::int]
  from (select p0.id, row_number() over (order by random()) as n
        from public.players p0 where p0.session_id = p_session_id and p0.joined_at is not null) d
  where p.id = d.id;

  insert into public.event_log (session_id, kind, actor, user_id, data)
  values (p_session_id, 'teams.made', 'host', auth.uid(), jsonb_build_object('count', p_count,
    'teams', (select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'colour', t.colour,
        'members', (select coalesce(jsonb_agg(p.id order by p.id), '[]'::jsonb) from public.players p where p.team_id = t.id))
      order by t.position) from public.teams t where t.session_id = p_session_id)));
  perform public.ping_session(p_session_id, 'room');
  return (select jsonb_build_object('teams', jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'colour', t.colour,
      'position', t.position) order by t.position)) from public.teams t where t.session_id = p_session_id);
end;
$$;

-- Moves a guest who is here into a team of their party, or into none (null).
-- Allowed while a game is live: from the next answer on, they answer with
-- their new team.
create function public.host_move_to_team(p_player_id uuid, p_team_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_player public.players;
  v_team public.teams;
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  select * into v_player from public.players where id = p_player_id for update;
  if not found then
    raise exception 'That guest isn''t in the party any more' using errcode = 'PT404', detail = 'not_found';
  end if;
  if v_player.joined_at is null then
    raise exception '% hasn''t joined yet. They go into a team when they join.', v_player.name
      using errcode = 'PT409', detail = 'not_joined';
  end if;
  if p_team_id is not null then
    select * into v_team from public.teams where id = p_team_id and session_id = v_player.session_id;
    if not found then
      raise exception 'That team is gone' using errcode = 'PT404', detail = 'team_not_found';
    end if;
  end if;
  if v_player.team_id is not distinct from p_team_id then
    return jsonb_build_object('id', v_player.id, 'team_id', p_team_id, 'changed', false);
  end if;
  update public.players set team_id = p_team_id where id = v_player.id;
  insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
  values (v_player.session_id, 'team.joined', 'host', v_player.id, auth.uid(), array[v_player.id],
    jsonb_build_object('player_id', v_player.id, 'name', v_player.name, 'team_id', p_team_id, 'team', v_team.name,
      'from', v_player.team_id));
  perform public.ping_session(v_player.session_id, 'room');
  return jsonb_build_object('id', v_player.id, 'team_id', p_team_id, 'changed', true);
end;
$$;

-- Renames a team. 1 to 40 characters you can see; two teams of a party can't share a name.
create function public.host_rename_team(p_team_id uuid, p_name text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_team public.teams;
  v_name text := public.clean_name(p_name);
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  select * into v_team from public.teams where id = p_team_id for update;
  if not found then
    raise exception 'That team is gone' using errcode = 'PT404', detail = 'team_not_found';
  end if;
  if public.name_key(v_name) = '' or char_length(v_name) > 40 then
    raise exception 'Team names are 1 to 40 characters' using errcode = 'PT400', detail = 'bad_name';
  end if;
  if v_name = v_team.name then
    return jsonb_build_object('id', v_team.id, 'name', v_team.name);
  end if;
  begin
    update public.teams set name = v_name where id = v_team.id;
  exception when unique_violation then
    raise exception 'Another team is already called "%"', v_name using errcode = 'PT409', detail = 'name_taken';
  end;
  insert into public.event_log (session_id, kind, actor, user_id, data)
  values (v_team.session_id, 'team.renamed', 'host', auth.uid(),
    jsonb_build_object('team_id', v_team.id, 'name', v_name, 'from', v_team.name));
  perform public.ping_session(v_team.session_id, 'room');
  return jsonb_build_object('id', v_team.id, 'name', v_name);
end;
$$;

-- Clears every team of the party: everyone is in no team again. Games set to
-- team play keep the setting, and play alone until there are teams again.
create function public.host_clear_teams(p_session_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_n int;
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  if not exists (select 1 from public.sessions where id = p_session_id) then
    raise exception 'Party not found' using errcode = 'PT404', detail = 'not_found';
  end if;
  perform public.refuse_while_team_game_live(p_session_id, 'clear the');
  with gone as (delete from public.teams where session_id = p_session_id returning 1)
  select count(*) into v_n from gone;
  if v_n > 0 then
    insert into public.event_log (session_id, kind, actor, user_id, data)
    values (p_session_id, 'teams.cleared', 'host', auth.uid(), jsonb_build_object('count', v_n));
    perform public.ping_session(p_session_id, 'room');
  end if;
  return jsonb_build_object('cleared', v_n);
end;
$$;

-- Switches a game's team play on or off, while it isn't live (before it
-- starts, or between rounds): a round is played the one way all through.
create function public.host_set_team_play(p_game_id uuid, p_on boolean) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_game public.session_games;
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  if p_on is null then
    raise exception 'Say on or off' using errcode = 'PT400', detail = 'bad_request';
  end if;
  select * into v_game from public.session_games where id = p_game_id for update;
  if not found then
    raise exception 'That game is gone' using errcode = 'PT404', detail = 'not_found';
  end if;
  if v_game.status = 'active' then
    raise exception 'Team play can''t change while % is live' , v_game.title using errcode = 'PT409', detail = 'active';
  end if;
  if v_game.team_play = p_on then
    return jsonb_build_object('id', v_game.id, 'team_play', p_on, 'changed', false);
  end if;
  update public.session_games set team_play = p_on where id = v_game.id;
  insert into public.event_log (session_id, kind, game_id, game_type, actor, user_id, data)
  values (v_game.session_id, 'game.team_play', v_game.id, v_game.game_type, 'host', auth.uid(),
    jsonb_build_object('title', v_game.title, 'team_play', p_on));
  perform public.ping_session(v_game.session_id, 'room', jsonb_build_object('game', v_game.id));
  return jsonb_build_object('id', v_game.id, 'team_play', p_on, 'changed', true);
end;
$$;

-- 5. One answer for the whole team ------------------------------------------------------
-- submit_answer's team path. Internal: only submit_answer calls it, after its
-- own checks (signed in, the prompt open and not past its deadline, the game
-- running, the caller a player, the answer valid for the caller), all in the
-- same transaction and under the same share lock on the prompt row.
--
-- One team and one prompt at a time (an advisory lock), so the latest answer
-- wins and two teammates' taps never cross. The team is the caller's team's
-- members who are in the party now. Each member's write follows the prompt's
-- rules: a final prompt keeps the first answer, so once any member locked one
-- in, the whole team is locked (members who have it keep it, and nobody gets
-- a second); any other prompt takes the latest answer until it closes, at
-- most 20 changes a guest. A prompt with exclude_self checks the answer for
-- each member, and a member it doesn't hold for is left out. A new row gets
-- the caller's time as its first_at, so the whole team has the same speed.
-- Every member whose row changed gets a ping on their own topic, so their
-- phone shows the team's answer; the answer count goes to the stage as before.
create function public.submit_team_answer(p_game public.session_games, p_prompt public.game_prompts, p_player uuid, p_team uuid,
  p_answer jsonb, p_request_id uuid, p_uid uuid, p_now timestamptz)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_final boolean := coalesce((p_prompt.spec ->> 'final')::boolean, false);
  v_each boolean := coalesce((p_prompt.spec ->> 'exclude_self')::boolean, false);
  v_members uuid[];
  v_mine public.game_submissions;
  v_claim bigint;
  v_member uuid;
  v_changed uuid[] := '{}';
  v_new int := 0;
  v_count int;
begin
  perform pg_advisory_xact_lock(hashtextextended('hurra.team_answer:' || p_team || ':' || p_prompt.game_id || ':' || p_prompt.key, 0));

  select coalesce(array_agg(p.id order by p.id), '{}') into v_members from public.players p
  where p.team_id = p_team and p.session_id = p_game.session_id and p.joined_at is not null;
  if not (p_player = any (v_members)) then
    v_members := v_members || p_player;
  end if;

  -- The same answer again (a teammate gave it, or a resend) counts as success.
  select * into v_mine from public.game_submissions where game_id = p_game.id and key = p_prompt.key and player_id = p_player;
  if found and v_mine.payload = p_answer then
    return jsonb_build_object('accepted', true, 'replayed', true, 'answer', v_mine.payload,
      'at', public.epoch_ms(v_mine.first_at), 'ms', public.epoch_ms(v_mine.first_at) - public.epoch_ms(p_prompt.opened_at));
  end if;
  if v_final then
    if v_mine.player_id is not null or exists (
        select 1 from public.game_submissions s
        where s.game_id = p_game.id and s.key = p_prompt.key and s.player_id = any (v_members) and s.answered_by = any (v_members)) then
      raise exception 'Your team already answered' using errcode = 'PT409', detail = 'already_answered';
    end if;
  elsif v_mine.player_id is not null and v_mine.changes >= 20 then
    raise exception 'That''s enough changes for this one' using errcode = 'PT409', detail = 'too_many_changes';
  end if;

  -- The claim, as on the path of one: a copy racing its original stops here.
  insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, player_id, user_id, request_id, about, data)
  values (p_game.session_id, p_now, 'prompt.answered', p_game.id, p_game.game_type, p_prompt.round, 'player', p_player,
    p_uid, p_request_id, array[p_player],
    jsonb_build_object('key', p_prompt.key, 'answer', p_answer,
      'ms', public.epoch_ms(p_now) - public.epoch_ms(p_prompt.opened_at), 'round', p_prompt.round,
      'team', p_team, 'for', to_jsonb(v_members)))
  on conflict (user_id, request_id) where request_id is not null do nothing
  returning id into v_claim;
  if v_claim is null then
    return jsonb_build_object('accepted', true, 'replayed', true) || coalesce((
      select jsonb_build_object('answer', s.payload, 'at', public.epoch_ms(s.first_at),
        'ms', public.epoch_ms(s.first_at) - public.epoch_ms(p_prompt.opened_at))
      from public.game_submissions s where s.game_id = p_game.id and s.key = p_prompt.key and s.player_id = p_player), '{}'::jsonb);
  end if;

  -- Every member's row, in id order (so two writers never lock rows in opposite orders).
  foreach v_member in array v_members loop
    if v_each and v_member <> p_player then
      begin
        perform public.check_answer(p_prompt.spec, p_answer, p_game.session_id, v_member);
      exception when sqlstate 'PT400' then
        continue;
      end;
    end if;
    if not v_final then
      update public.game_submissions
      set payload = p_answer, at = p_now, changes = least(changes + 1, 20), answered_by = p_player
      where game_id = p_game.id and key = p_prompt.key and player_id = v_member and payload is distinct from p_answer;
      if found then
        v_changed := v_changed || v_member;
        continue;
      end if;
    end if;
    insert into public.game_submissions (game_id, key, player_id, payload, first_at, at, answered_by)
    values (p_game.id, p_prompt.key, v_member, p_answer, p_now, p_now, p_player)
    on conflict (game_id, key, player_id) do nothing;
    if found then
      v_changed := v_changed || v_member;
      v_new := v_new + 1;
    end if;
  end loop;

  -- Each teammate's phone reads its answers again; the caller has its reply.
  perform public.ping_player(p_game.session_id, m) from unnest(v_changed) m where m <> p_player;
  if v_new > 0 then
    select count(*) into v_count from public.game_submissions where game_id = p_game.id and key = p_prompt.key;
    perform public.ping('stage:' || p_game.session_id, 'tally',
      jsonb_build_object('game', p_game.id, 'key', p_prompt.key, 'count', v_count));
  end if;

  select * into v_mine from public.game_submissions where game_id = p_game.id and key = p_prompt.key and player_id = p_player;
  return jsonb_build_object('accepted', true, 'answer', v_mine.payload, 'at', public.epoch_ms(v_mine.first_at),
    'ms', public.epoch_ms(v_mine.first_at) - public.epoch_ms(p_prompt.opened_at),
    'team', jsonb_build_object('id', p_team, 'written', cardinality(v_changed)));
end;
$$;

-- The hot path: the init file's function, copied exactly, with two changes.
-- The caller's team is read with their player (the same row), and when the
-- game is played in teams and the caller has a team, the answer goes to
-- submit_team_answer after every check above it. Everything else, team play
-- off or a guest in no team, runs exactly as before.
create or replace function public.submit_answer(p_game_id uuid, p_key text, p_payload jsonb, p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_prompt public.game_prompts;
  v_game public.session_games;
  v_player uuid;
  v_team uuid;
  v_answer jsonb;
  v_now timestamptz;
  v_claim bigint;
  v_row public.game_submissions;
  v_count int;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'PT401', detail = 'not_signed_in';
  end if;
  select * into v_prompt from public.game_prompts where game_id = p_game_id and key = p_key for share;
  if not found then
    raise exception 'This question is not open' using errcode = 'PT409', detail = 'closed';
  end if;
  -- A resent copy of a tap that was saved counts as success, even once the
  -- question has closed (the first attempt's answer was lost on the way back).
  if p_request_id is not null
     and exists (select 1 from public.event_log e where e.user_id = v_uid and e.request_id = p_request_id) then
    return jsonb_build_object('accepted', true, 'replayed', true) || coalesce((
      select jsonb_build_object('answer', s.payload, 'at', public.epoch_ms(s.first_at),
        'ms', public.epoch_ms(s.first_at) - public.epoch_ms(v_prompt.opened_at))
      from public.game_submissions s
      join public.players pl on pl.id = s.player_id and pl.user_id = v_uid
      where s.game_id = p_game_id and s.key = p_key), '{}'::jsonb);
  end if;
  v_now := clock_timestamp();
  if v_prompt.closed_at is not null or v_prompt.closes_at <= v_now then
    raise exception 'Too late, answers are closed' using errcode = 'PT409', detail = 'closed';
  end if;
  select * into v_game from public.session_games where id = p_game_id;
  if v_game.status is distinct from 'active' or v_game.archived_at is not null then
    raise exception 'This game is not running' using errcode = 'PT409', detail = 'not_running';
  end if;
  select id, team_id into v_player, v_team from public.players where session_id = v_game.session_id and user_id = v_uid;
  if v_player is null then
    raise exception 'You''re not a player in this party' using errcode = 'PT403', detail = 'not_player';
  end if;
  v_answer := public.check_answer(v_prompt.spec, p_payload, v_game.session_id, v_player);

  -- Played in teams: one answer for the whole team (section 5 of the teams file).
  if v_game.team_play and v_team is not null then
    return public.submit_team_answer(v_game, v_prompt, v_player, v_team, v_answer, p_request_id, v_uid, v_now);
  end if;

  -- The same answer again (a resend after a reload) counts as success.
  select * into v_row from public.game_submissions where game_id = p_game_id and key = p_key and player_id = v_player;
  if found and v_row.payload = v_answer then
    return jsonb_build_object('accepted', true, 'replayed', true, 'answer', v_row.payload,
      'at', public.epoch_ms(v_row.first_at), 'ms', public.epoch_ms(v_row.first_at) - public.epoch_ms(v_prompt.opened_at));
  end if;

  -- The claim: a copy racing its original stops here.
  insert into public.event_log (session_id, at, kind, game_id, game_type, round, actor, player_id, user_id, request_id, about, data)
  values (v_game.session_id, v_now, 'prompt.answered', p_game_id, v_game.game_type, v_prompt.round, 'player', v_player,
    v_uid, p_request_id, array[v_player],
    jsonb_build_object('key', p_key, 'answer', v_answer,
      'ms', public.epoch_ms(v_now) - public.epoch_ms(v_prompt.opened_at), 'round', v_prompt.round))
  on conflict (user_id, request_id) where request_id is not null do nothing
  returning id into v_claim;
  if v_claim is null then
    return jsonb_build_object('accepted', true, 'replayed', true) || coalesce((
      select jsonb_build_object('answer', s.payload, 'at', public.epoch_ms(s.first_at),
        'ms', public.epoch_ms(s.first_at) - public.epoch_ms(v_prompt.opened_at))
      from public.game_submissions s where s.game_id = p_game_id and s.key = p_key and s.player_id = v_player), '{}'::jsonb);
  end if;

  insert into public.game_submissions (game_id, key, player_id, payload, first_at, at)
  values (p_game_id, p_key, v_player, v_answer, v_now, v_now)
  on conflict (game_id, key, player_id) do nothing
  returning * into v_row;
  if not found then
    -- Answered before: a vote may change until the prompt closes; a quiz answer may not.
    select * into v_row from public.game_submissions
    where game_id = p_game_id and key = p_key and player_id = v_player for update;
    if v_row.payload = v_answer then
      return jsonb_build_object('accepted', true, 'replayed', true, 'answer', v_row.payload,
        'at', public.epoch_ms(v_row.first_at), 'ms', public.epoch_ms(v_row.first_at) - public.epoch_ms(v_prompt.opened_at));
    end if;
    if coalesce((v_prompt.spec ->> 'final')::boolean, false) then
      raise exception 'You already answered' using errcode = 'PT409', detail = 'already_answered';
    end if;
    if v_row.changes >= 20 then
      raise exception 'That''s enough changes for this one' using errcode = 'PT409', detail = 'too_many_changes';
    end if;
    update public.game_submissions set payload = v_answer, at = v_now, changes = changes + 1
    where game_id = p_game_id and key = p_key and player_id = v_player
    returning * into v_row;
    return jsonb_build_object('accepted', true, 'answer', v_answer, 'at', public.epoch_ms(v_row.first_at),
      'ms', public.epoch_ms(v_row.first_at) - public.epoch_ms(v_prompt.opened_at));
  end if;

  -- A new answer: the count, to the TV and the host page. Counts only: no answer leaves the database.
  select count(*) into v_count from public.game_submissions where game_id = p_game_id and key = p_key;
  perform public.ping('stage:' || v_game.session_id, 'tally',
    jsonb_build_object('game', p_game_id, 'key', p_key, 'count', v_count));
  return jsonb_build_object('accepted', true, 'answer', v_answer, 'at', public.epoch_ms(v_row.first_at),
    'ms', public.epoch_ms(v_row.first_at) - public.epoch_ms(v_prompt.opened_at));
end;
$$;

-- 6. The snapshot: the guest list's body with teams ----------------------------------------
-- Copied exactly from 20261126000000_guest_list.sql, plus: teams (the party's
-- teams, by position), players[].team_id, games[].team_play, and the phone's
-- me.answered_by: for each answer a teammate wrote for the whole team, who
-- gave it and when it was last changed.
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
      'players', '[]'::jsonb, 'standings', '[]'::jsonb, 'feed', '[]'::jsonb, 'teams', '[]'::jsonb,
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
        'archived_at', public.epoch_ms(g.archived_at), 'created_at', public.epoch_ms(g.created_at),
        'team_play', g.team_play)
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
        'created_at', public.epoch_ms(p.created_at), 'team_id', p.team_id) order by p.joined_at, p.id), '[]'::jsonb)
      from public.players p where p.session_id = p_session_id and p.joined_at is not null),
    'standings', (select coalesce(jsonb_agg(jsonb_build_object('player_id', b.player_id, 'name', b.name,
        'code', b.code, 'points', b.points, 'profile', b.profile) order by b.points desc, b.name, b.player_id), '[]'::jsonb)
      from public.scoreboard b where b.session_id = p_session_id),
    -- The party's teams, in order; who is in each is players[].team_id.
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'colour', t.colour,
        'position', t.position) order by t.position, t.created_at, t.id), '[]'::jsonb)
      from public.teams t where t.session_id = p_session_id),
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
            where s.player_id = v_me and s.game_id = any (v_active) group by s.game_id) a),
        'answered_by', (select coalesce(jsonb_object_agg(a.game_id, a.answers), '{}'::jsonb) from (
            select s.game_id, jsonb_object_agg(s.key, jsonb_build_object('by', s.answered_by, 'at', public.epoch_ms(s.at))) as answers
            from public.game_submissions s
            where s.player_id = v_me and s.game_id = any (v_active) and s.answered_by is not null group by s.game_id) a))
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

-- 7. Function grants: everything revoked, then exactly what each role needs -------------------

revoke execute on function
  public.join_smallest_team(), public.team_colours(), public.refuse_while_team_game_live(uuid, text),
  public.host_make_teams(uuid, int), public.host_move_to_team(uuid, uuid), public.host_rename_team(uuid, text),
  public.host_clear_teams(uuid), public.host_set_team_play(uuid, boolean),
  public.submit_team_answer(public.session_games, public.game_prompts, uuid, uuid, jsonb, uuid, uuid, timestamptz),
  public.submit_answer(uuid, text, jsonb, uuid), public.session_snapshot(uuid, text)
from public, anon, authenticated;

-- What the app calls.
grant execute on function
  public.host_make_teams(uuid, int), public.host_move_to_team(uuid, uuid), public.host_rename_team(uuid, text),
  public.host_clear_teams(uuid), public.host_set_team_play(uuid, boolean),
  public.submit_answer(uuid, text, jsonb, uuid), public.session_snapshot(uuid, text)
to authenticated, service_role;

-- The definer functions call these as their owner; the tests and scripts may too.
grant execute on function
  public.team_colours(), public.refuse_while_team_game_live(uuid, text),
  public.submit_team_answer(public.session_games, public.game_prompts, uuid, uuid, jsonb, uuid, uuid, timestamptz)
to service_role;

-- PostgREST reloads its schema cache on DDL by itself (pgrst_ddl_watch); this
-- makes sure the new RPCs answer the moment the file commits.
notify pgrst, 'reload schema';

-- 8. Self-checks: the guest list hotfix's, updated for this file ------------------------------
-- From here on this block is the current one: a later hotfix copies it, not an
-- older file's. A later file that replaces submit_answer or session_snapshot
-- from an older copy then fails here instead of quietly dropping team play.

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
    if r.proname in ('is_photo_path', 'owns_photo_path', 'may_upload_photo', 'may_delete_photo', 'set_my_photo',
                     'host_remove_photo', 'my_exit', 'guest_list', 'claim_guest', 'host_add_guests', 'host_free_guest',
                     'join_session', 'claim_player', 'session_snapshot', 'submit_answer', 'host_make_teams',
                     'host_move_to_team', 'host_rename_team', 'host_clear_teams', 'host_set_team_play')
       and not (has_function_privilege('authenticated', r.oid, 'execute')
                and has_function_privilege('service_role', r.oid, 'execute')) then
      v_problems := v_problems || format('authenticated or service_role can''t execute %s', r.proname);
    end if;
  end loop;
  -- The photo functions exist, and the guest list's. New: and the teams functions.
  foreach v_name in array array['is_photo_path', 'owns_photo_path', 'may_upload_photo', 'may_delete_photo',
                                'log_player_photo', 'set_my_photo', 'host_remove_photo', 'my_exit', 'guest_list',
                                'claim_guest', 'host_add_guests', 'host_free_guest', 'join_smallest_team',
                                'host_make_teams', 'host_move_to_team', 'host_rename_team', 'host_clear_teams',
                                'host_set_team_play', 'submit_team_answer'] loop
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
