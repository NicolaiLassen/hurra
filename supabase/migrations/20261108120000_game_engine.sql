-- Game engine. Game logic runs on the server (netlify/functions/game.mts) and
-- keeps each game's full state in game_states. Players only ever see
-- projections of it: session_games.public_state for everyone and
-- game_player_views for themselves, so games can keep secrets.
--
-- Games can also reach outside their own state through effects, applied in
-- the same transaction as the state: points on the day's scoreboard, data on a
-- player's profile or the session (namespaced by game type), and
-- announcements on the session feed.

alter table public.session_games rename column state to public_state;

-- Public, per-game data: { "<game type>": { ... } }.
alter table public.players add column profile jsonb not null default '{}';
alter table public.sessions add column data jsonb not null default '{}';

-- Tables ---------------------------------------------------------------------

-- A game's full state. Written only by the engine; hosts can read it.
create table public.game_states (
  game_id uuid primary key references public.session_games (id) on delete cascade,
  state jsonb not null,
  -- Bumped on every save so two players acting at once can't overwrite each other.
  version int not null default 1,
  updated_at timestamptz not null default now()
);

-- Each player's private view of a game, e.g. their secret task.
create table public.game_player_views (
  game_id uuid not null references public.session_games (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  view jsonb not null,
  primary key (game_id, player_id)
);

create index game_player_views_player_idx on public.game_player_views (player_id);

-- Points per player from a game's scores(), recomputed from its state on
-- every save (a snapshot, unlike the score_events ledger).
create table public.game_scores (
  game_id uuid not null references public.session_games (id) on delete cascade,
  player_id uuid not null,
  session_id uuid not null,
  points int not null,
  primary key (game_id, player_id),
  foreign key (player_id, session_id) references public.players (id, session_id) on delete cascade
);

create index game_scores_session_idx on public.game_scores (session_id);
create index game_scores_player_idx on public.game_scores (player_id);

-- Announcements shown on the TV scoreboard and players' phones.
create table public.session_feed (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  game_id uuid references public.session_games (id) on delete set null,
  message text not null check (char_length(message) between 1 and 280),
  created_at timestamptz not null default now()
);

create index session_feed_session_idx on public.session_feed (session_id, created_at desc);

-- The day's scoreboard now adds up host-given points and games' scores.
create or replace view public.scoreboard
with (security_invoker = true)
as
select
  p.session_id,
  p.id as player_id,
  p.name,
  p.code,
  (
    coalesce((select sum(e.points) from public.score_events e where e.player_id = p.id), 0)
    + coalesce((select sum(g.points) from public.game_scores g where g.player_id = p.id), 0)
  )::int as points,
  p.profile
from public.players p;

-- Row level security ---------------------------------------------------------
-- Only the engine (secret key) writes these tables.

alter table public.game_states enable row level security;
alter table public.game_player_views enable row level security;
alter table public.game_scores enable row level security;
alter table public.session_feed enable row level security;

create policy "Hosts can read game states" on public.game_states
  for select to authenticated using ((select public.is_host()));

create policy "Players read their own game views" on public.game_player_views
  for select to authenticated using (
    player_id in (select id from public.players where user_id = (select auth.uid()))
    or (select public.is_host())
  );

create policy "Signed-in users can read game scores" on public.game_scores
  for select to authenticated using (true);

create policy "Signed-in users can read the feed" on public.session_feed
  for select to authenticated using (true);

-- Saving ---------------------------------------------------------------------

-- Saves a game's new state, its projections and its effects in one
-- transaction. p_expected_version is the version the engine read (null when
-- starting the game afresh); a mismatch raises 40001 and the engine retries.
create function public.apply_game_state(
  p_game_id uuid,
  p_expected_version int,
  p_state jsonb,
  p_public_state jsonb,
  p_player_views jsonb, -- { "<player id>": view }
  p_scores jsonb,       -- { "<player id>": points }
  p_effects jsonb,      -- { points: [{ player_id, points, reason }], profiles: { "<player id>": patch }, session_data: patch, announcements: [text] }
  p_status text default null
)
returns int
language plpgsql
set search_path = ''
as $$
declare
  v_version int;
  v_session_id uuid;
  v_type text;
begin
  select session_id, game_type into v_session_id, v_type from public.session_games where id = p_game_id;
  if not found then
    raise exception 'Game % not found', p_game_id;
  end if;

  if p_expected_version is null then
    insert into public.game_states (game_id, state) values (p_game_id, p_state)
    on conflict (game_id) do update
      set state = excluded.state, version = public.game_states.version + 1, updated_at = now()
    returning version into v_version;
  else
    update public.game_states
    set state = p_state, version = version + 1, updated_at = now()
    where game_id = p_game_id and version = p_expected_version
    returning version into v_version;
    if not found then
      raise exception 'Game state changed concurrently' using errcode = '40001';
    end if;
  end if;

  if p_status = 'active' then
    update public.session_games set status = 'finished'
    where session_id = v_session_id and status = 'active' and id <> p_game_id;
  end if;

  update public.session_games
  set public_state = p_public_state, status = coalesce(p_status, status)
  where id = p_game_id;

  insert into public.game_player_views (game_id, player_id, view)
  select p_game_id, key::uuid, value from jsonb_each(p_player_views)
  on conflict (game_id, player_id) do update set view = excluded.view
  where public.game_player_views.view is distinct from excluded.view;

  delete from public.game_scores
  where game_id = p_game_id and not p_scores ? player_id::text;

  insert into public.game_scores (game_id, player_id, session_id, points)
  select p_game_id, key::uuid, v_session_id, value::int from jsonb_each_text(p_scores)
  on conflict (game_id, player_id) do update set points = excluded.points
  where public.game_scores.points is distinct from excluded.points;

  -- Effects

  insert into public.score_events (session_id, player_id, game_id, points, reason, awarded_by)
  select v_session_id, (e ->> 'player_id')::uuid, p_game_id, (e ->> 'points')::int, e ->> 'reason', null
  from jsonb_array_elements(coalesce(p_effects -> 'points', '[]')) e
  where (e ->> 'points')::int <> 0;

  update public.players p
  set profile = p.profile || jsonb_build_object(v_type, coalesce(p.profile -> v_type, '{}') || patch.value)
  from jsonb_each(coalesce(p_effects -> 'profiles', '{}')) patch
  where p.id = patch.key::uuid and p.session_id = v_session_id;

  if p_effects ? 'session_data' then
    update public.sessions
    set data = data || jsonb_build_object(v_type, coalesce(data -> v_type, '{}') || (p_effects -> 'session_data'))
    where id = v_session_id;
  end if;

  insert into public.session_feed (session_id, game_id, message)
  select v_session_id, p_game_id, m
  from jsonb_array_elements_text(coalesce(p_effects -> 'announcements', '[]')) m;

  return v_version;
end;
$$;

-- Only the engine (service role) may call it.
revoke execute on function public.apply_game_state(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;

-- Starting a game now runs the game's setup on the server.
drop function public.start_game(uuid);

alter publication supabase_realtime add table
  public.game_states,
  public.game_player_views,
  public.game_scores,
  public.session_feed;
