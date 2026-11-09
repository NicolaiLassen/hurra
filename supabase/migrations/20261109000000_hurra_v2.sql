-- Hurra v2: the whole schema, from scratch (docs/engine-v2.md, section 2).
--
-- One init file for an empty database: parties, players, games and their
-- state, prompts everyone answers from their phone, the points ledger, the
-- event log of the night, paired TVs and the published recap.
--
-- Rules: every table has row level security, `revoke all` and exact grants;
-- every function has `set search_path = ''`, fully qualified names and exact
-- grants. The self-checks at the end abort the migration if any of that is
-- missing. The file holds no data: no host, no user ids, no emails.

-- 1. Schema usage and default privileges ----------------------------------------
-- Stated here because a wipe that drops and recreates the schema loses them.

grant usage on schema public to anon, authenticated, service_role;

-- Nothing new is ever opened by accident: a later hotfix migration states its
-- own grants (and ends with a copy of the self-checks).
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;
-- Postgres grants EXECUTE to PUBLIC globally, and a per-schema revoke can't
-- undo a global grant, so this one has no "in schema".
alter default privileges for role postgres revoke execute on functions from public;

-- 2. Helpers that need no tables -------------------------------------------------

-- Short human-friendly codes (no 0/O/1/I) for join links, player QR codes and
-- the host's one-off codes.
create function public.random_code(len int) returns text
language sql volatile set search_path = '' as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, len)
$$;

-- Milliseconds since epoch; null in, null out. Every time a client or the
-- engine sees is one of these.
create function public.epoch_ms(t timestamptz) returns bigint
language sql immutable set search_path = '' as $$
  select (extract(epoch from t) * 1000)::bigint
$$;

-- The uuid, or null when the text isn't one (topic names and payload keys come from clients).
create function public.try_uuid(t text) returns uuid
language sql immutable set search_path = '' as $$
  select case when t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then t::uuid end
$$;

-- 3. Tables ---------------------------------------------------------------------

-- Hosts are email and password users listed here by id, so signing up with a
-- host's address grants nothing. Read only through is_host().
create table public.hosts (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  join_code text not null unique default public.random_code(6)
    check (join_code ~ '^[A-Z0-9]{4,12}$'),
  -- 'closed' stops new players from joining; everyone in keeps playing.
  status text not null default 'open' check (status in ('open', 'closed')),
  -- Each game type's shared data, written through game effects.
  data jsonb not null default '{}' check (jsonb_typeof(data) = 'object'),
  -- The game on the TV stage, live or finished. No foreign key on purpose: a
  -- second sessions/session_games relationship makes PostgREST embeds
  -- ambiguous. Triggers clear it when that game is archived or deleted.
  spotlight_game_id uuid,
  -- Set by a trigger whenever spotlight_game_id changes (database clock).
  spotlight_at timestamptz,
  tv_scene text not null default 'live' check (tv_scene in ('live', 'recap')),
  archived_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  -- Encoded in the player's personal QR code.
  code text not null unique default public.random_code(5) check (code ~ '^[A-Z0-9]{5}$'),
  -- Each game type's public data on this player (badges), written through game effects.
  profile jsonb not null default '{}' check (jsonb_typeof(profile) = 'object'),
  created_at timestamptz not null default now(),
  unique (session_id, user_id),
  unique (id, session_id)
);
create unique index players_session_name_key on public.players (session_id, lower(name));
create index players_user_idx on public.players (user_id);

create table public.session_games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  -- Key into the game registries (src/games/logic.ts and registry.ts).
  game_type text not null check (game_type ~ '^[a-z][a-z0-9-]{1,39}$'),
  title text not null check (char_length(title) between 1 and 80),
  position int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'active', 'finished')),
  public_state jsonb,                      -- null until the first start
  started_at timestamptz,
  finished_at timestamptz,
  finished_by text check (finished_by in ('game', 'host')),
  winners uuid[] not null default '{}',     -- set when it finishes; no foreign key
  wake_at timestamptz,                      -- when the game wants a sync; public
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, session_id),
  check ((status = 'finished') = (finished_at is not null)),
  check (finished_by is null or status = 'finished')
);
create index session_games_session_idx on public.session_games (session_id, position, created_at);
create index session_games_live_idx on public.session_games (session_id) where status = 'active';

-- Host-only settings (quiz questions and answers, who is in each picture).
create table public.game_settings (
  game_id uuid primary key references public.session_games (id) on delete cascade,
  config jsonb not null default '{}'
    check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 262144),
  updated_at timestamptz not null default now()
);

-- A game's full state. Written only by game_commit; hosts read it.
create table public.game_states (
  game_id uuid primary key references public.session_games (id) on delete cascade,
  round int not null default 1 check (round >= 1),   -- bumped by every (re)start
  version int not null default 1,                     -- bumped by every save
  state jsonb not null,
  config jsonb not null default '{}',                 -- the settings this round started with
  members uuid[] not null default '{}',               -- players the game knows about
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

-- Points per player from a game's scores(), recomputed on every save.
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

-- The points ledger: host awards and games' one-off bonuses (awarded_by null).
create table public.score_events (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  player_id uuid not null,
  game_id uuid,
  points int not null check (points <> 0),
  reason text check (char_length(reason) <= 200),
  awarded_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (player_id, session_id) references public.players (id, session_id) on delete cascade,
  foreign key (game_id, session_id) references public.session_games (id, session_id) on delete set null (game_id)
);
create index score_events_session_idx on public.score_events (session_id);
create index score_events_player_idx on public.score_events (player_id, created_at desc);
create index score_events_game_idx on public.score_events (game_id) where game_id is not null;

-- Announcements: toasts on phones, the banner on the TV.
create table public.session_feed (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  game_id uuid references public.session_games (id) on delete set null,
  message text not null check (char_length(message) between 1 and 280),
  detail text check (char_length(detail) <= 280),
  audience uuid[],                          -- null: everyone; else only these players (and hosts) can read it
  sound text check (char_length(sound) <= 40),
  icon text check (char_length(icon) <= 40),
  tone text check (char_length(tone) <= 20),
  interrupt boolean not null default false, -- the TV banners it even from a background game
  created_at timestamptz not null default now()
);
create index session_feed_session_idx on public.session_feed (session_id, id desc);

-- Questions everyone answers from their phone (a quiz question, a fused picture).
create table public.game_prompts (
  game_id uuid not null references public.session_games (id) on delete cascade,
  key text not null check (key ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  round int not null,
  spec jsonb not null check (jsonb_typeof(spec) = 'object' and pg_column_size(spec) < 32768),
  opened_at timestamptz not null default clock_timestamp(),
  closes_at timestamptz,                    -- deadline by the database clock; null for none
  closed_at timestamptz,
  revealed_at timestamptz,
  primary key (game_id, key)
);

-- One answer per player and prompt. Written only by submit_answer.
create table public.game_submissions (
  game_id uuid not null,
  key text not null,
  player_id uuid not null references public.players (id) on delete cascade,
  payload jsonb not null,
  first_at timestamptz not null default clock_timestamp(),
  at timestamptz not null default clock_timestamp(),
  changes int not null default 0 check (changes between 0 and 20),
  primary key (game_id, key, player_id),
  foreign key (game_id, key) references public.game_prompts (game_id, key) on delete cascade
);

-- The night's story. Append-only (section 2.5), hosts only, never published to Realtime.
create table public.event_log (
  id bigint generated always as identity primary key,
  session_id uuid not null references public.sessions (id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  kind text not null check (kind ~ '^[a-z][a-z_]*(\.[a-z][a-z_]*)+$'),
  game_id uuid,                             -- no foreign keys: the log outlives a deleted game
  game_type text,
  round int,
  actor text not null check (actor in ('player', 'host', 'game', 'timer', 'system')),
  player_id uuid,                           -- or a removed guest
  user_id uuid,
  request_id uuid,                          -- the tap's id: the claim
  cause_id bigint,                          -- the row this one follows from
  about uuid[] not null default '{}',       -- players it is about
  -- 256 KB a row, except the two snapshots a round writes once (game.started,
  -- game.finished): they copy game_states.state, which has no cap, and a log
  -- row must never stop a game from starting or finishing (a 50-question quiz
  -- with 45 guests holds about 270 KB of answers).
  data jsonb not null default '{}'
    check (jsonb_typeof(data) = 'object'
      and (kind in ('game.started', 'game.finished') or pg_column_size(data) < 262144))
);
create index event_log_session_idx on public.event_log (session_id, id);
create index event_log_game_idx on public.event_log (game_id, id) where game_id is not null;
create unique index event_log_request_key on public.event_log (user_id, request_id)
  where request_id is not null;

-- Move a player to a new phone (gap G4). Only the three RPCs touch it. A
-- code works for 5 minutes: the host shows it to a guest standing beside
-- them, closing the dialog cancels it, and Get a new code is one tap.
create table public.player_transfers (
  code text primary key default public.random_code(6),
  player_id uuid not null unique references public.players (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '5 minutes'
);

-- TVs the host paired: anonymous users with a guest's read access and the
-- right to send timer syncs. Rows come only from claim_screen; hosts read and
-- delete them (Unpair).
create table public.session_screens (
  user_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid not null references public.sessions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id)
);
create index session_screens_session_idx on public.session_screens (session_id);

-- Pairing codes, the player_transfers pattern. Only the two RPCs touch it.
create table public.screen_codes (
  code text primary key default public.random_code(6),
  session_id uuid not null unique references public.sessions (id) on delete cascade,
  expires_at timestamptz not null default now() + interval '15 minutes'
);

-- The recap the host published: room-safe facts only.
create table public.session_recaps (
  session_id uuid primary key references public.sessions (id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) < 1048576),
  published_at timestamptz,                 -- set to now() by touch_recap whenever it is written non-null
  updated_at timestamptz not null default now()
);

-- 4. Helpers that read tables ----------------------------------------------------
-- Policies call these wrapped in (select ...), so Postgres evaluates them once per query.

create function public.is_host() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.hosts where user_id = auth.uid())
$$;

-- The caller's players (one per party joined).
create function public.my_player_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(id), '{}') from public.players where user_id = auth.uid()
$$;

-- The parties the caller is a player in, or a paired screen of. Every "member"
-- rule therefore covers paired TVs too; anything tied to a player does not.
create function public.my_session_ids() returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array_agg(distinct x.session_id), '{}') from (
    select session_id from public.players where user_id = auth.uid()
    union all
    select session_id from public.session_screens where user_id = auth.uid()
  ) x
$$;

-- Whether the party exists, whoever asks: a removed guest tells "removed" from "party deleted".
create function public.session_exists(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.sessions where id = p_session_id)
$$;

-- Whether the caller's player in the party moved to another phone (claim_player),
-- so an old phone that slept through the "moved" ping still says so when it wakes.
create function public.moved_away(p_session_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.event_log e
    where e.session_id = p_session_id and e.kind = 'player.moved' and e.data ->> 'from_user' = auth.uid()::text)
$$;

-- 5. Row level security, policies and grants -----------------------------------------
-- "Member" means session_id = any ((select public.my_session_ids())::uuid[]); "host"
-- means (select public.is_host()).

alter table public.hosts enable row level security;
revoke all on public.hosts from anon, authenticated;

alter table public.sessions enable row level security;
revoke all on public.sessions from anon, authenticated;
grant select, delete on public.sessions to authenticated;
grant insert (name, join_code) on public.sessions to authenticated;
grant update (name, status, archived_at, spotlight_game_id, tv_scene) on public.sessions to authenticated;
create policy "Hosts and members read parties" on public.sessions
  for select to authenticated
  using ((select public.is_host()) or id = any ((select public.my_session_ids())::uuid[]));
create policy "Hosts create parties" on public.sessions
  for insert to authenticated with check ((select public.is_host()));
create policy "Hosts change parties" on public.sessions
  for update to authenticated using ((select public.is_host())) with check ((select public.is_host()));
create policy "Hosts delete parties" on public.sessions
  for delete to authenticated using ((select public.is_host()));

alter table public.players enable row level security;
revoke all on public.players from anon, authenticated;
grant select, delete on public.players to authenticated;
grant update (name) on public.players to authenticated;
create policy "Hosts and members read players" on public.players
  for select to authenticated
  using ((select public.is_host()) or session_id = any ((select public.my_session_ids())::uuid[]));
create policy "Hosts rename players" on public.players
  for update to authenticated using ((select public.is_host())) with check ((select public.is_host()));
create policy "Hosts remove players" on public.players
  for delete to authenticated using ((select public.is_host()));

alter table public.session_games enable row level security;
revoke all on public.session_games from anon, authenticated;
grant select, delete on public.session_games to authenticated;
grant insert (session_id, game_type, title, position) on public.session_games to authenticated;
grant update (title, position, archived_at) on public.session_games to authenticated;
create policy "Hosts and members read games" on public.session_games
  for select to authenticated
  using ((select public.is_host()) or session_id = any ((select public.my_session_ids())::uuid[]));
create policy "Hosts add games" on public.session_games
  for insert to authenticated with check ((select public.is_host()));
create policy "Hosts change games" on public.session_games
  for update to authenticated using ((select public.is_host())) with check ((select public.is_host()));
create policy "Hosts delete games" on public.session_games
  for delete to authenticated using ((select public.is_host()));

alter table public.game_settings enable row level security;
revoke all on public.game_settings from anon, authenticated;
grant select, insert, update, delete on public.game_settings to authenticated;
create policy "Hosts manage game settings" on public.game_settings
  for all to authenticated using ((select public.is_host())) with check ((select public.is_host()));

alter table public.game_states enable row level security;
revoke all on public.game_states from anon, authenticated;
grant select on public.game_states to authenticated;
create policy "Hosts read game states" on public.game_states
  for select to authenticated using ((select public.is_host()));

alter table public.game_player_views enable row level security;
revoke all on public.game_player_views from anon, authenticated;
grant select on public.game_player_views to authenticated;
create policy "Players read their own views" on public.game_player_views
  for select to authenticated
  using (player_id = any ((select public.my_player_ids())::uuid[]) or (select public.is_host()));

alter table public.game_scores enable row level security;
revoke all on public.game_scores from anon, authenticated;
grant select on public.game_scores to authenticated;
create policy "Hosts and members read game scores" on public.game_scores
  for select to authenticated
  using ((select public.is_host()) or session_id = any ((select public.my_session_ids())::uuid[]));

alter table public.score_events enable row level security;
revoke all on public.score_events from anon, authenticated;
grant select, delete on public.score_events to authenticated;
grant insert (session_id, player_id, game_id, points, reason) on public.score_events to authenticated;
create policy "Hosts and members read points" on public.score_events
  for select to authenticated
  using ((select public.is_host()) or session_id = any ((select public.my_session_ids())::uuid[]));
create policy "Hosts give points" on public.score_events
  for insert to authenticated with check ((select public.is_host()));
create policy "Hosts undo points" on public.score_events
  for delete to authenticated using ((select public.is_host()));

alter table public.session_feed enable row level security;
revoke all on public.session_feed from anon, authenticated;
grant select on public.session_feed to authenticated;
create policy "Members read the feed meant for them" on public.session_feed
  for select to authenticated
  using (
    (select public.is_host())
    or (session_id = any ((select public.my_session_ids())::uuid[])
        and (audience is null or audience && (select public.my_player_ids())))
  );

alter table public.game_prompts enable row level security;
revoke all on public.game_prompts from anon, authenticated;
grant select on public.game_prompts to authenticated;
create policy "Hosts and members read prompts" on public.game_prompts
  for select to authenticated
  using (
    (select public.is_host())
    or game_id in (select g.id from public.session_games g
                   where g.session_id = any ((select public.my_session_ids())::uuid[]))
  );

alter table public.game_submissions enable row level security;
revoke all on public.game_submissions from anon, authenticated;
grant select on public.game_submissions to authenticated;
create policy "Players read their own answers" on public.game_submissions
  for select to authenticated
  using (player_id = any ((select public.my_player_ids())::uuid[]) or (select public.is_host()));

alter table public.event_log enable row level security;
revoke all on public.event_log from anon, authenticated;
grant select on public.event_log to authenticated;
create policy "Hosts read the event log" on public.event_log
  for select to authenticated using ((select public.is_host()));

alter table public.player_transfers enable row level security;
revoke all on public.player_transfers from anon, authenticated;

alter table public.session_screens enable row level security;
revoke all on public.session_screens from anon, authenticated;
grant select, delete on public.session_screens to authenticated;
create policy "Hosts read paired screens" on public.session_screens
  for select to authenticated using ((select public.is_host()));
create policy "Hosts unpair screens" on public.session_screens
  for delete to authenticated using ((select public.is_host()));

alter table public.screen_codes enable row level security;
revoke all on public.screen_codes from anon, authenticated;

alter table public.session_recaps enable row level security;
revoke all on public.session_recaps from anon, authenticated;
grant select, insert, update, delete on public.session_recaps to authenticated;
create policy "Hosts and members read published recaps" on public.session_recaps
  for select to authenticated
  using (
    (select public.is_host())
    or (published_at is not null and session_id = any ((select public.my_session_ids())::uuid[]))
  );
create policy "Hosts write recaps" on public.session_recaps
  for insert to authenticated with check ((select public.is_host()));
create policy "Hosts change recaps" on public.session_recaps
  for update to authenticated using ((select public.is_host())) with check ((select public.is_host()));
create policy "Hosts delete recaps" on public.session_recaps
  for delete to authenticated using ((select public.is_host()));

-- 6. The scoreboard view, then service_role's grants --------------------------------

-- The day's scoreboard: host awards and game bonuses plus every game's scores.
create view public.scoreboard with (security_invoker = true) as
select p.session_id, p.id as player_id, p.name, p.code,
  (coalesce((select sum(e.points) from public.score_events e where e.player_id = p.id), 0)
   + coalesce((select sum(g.points) from public.game_scores g where g.player_id = p.id), 0))::int as points,
  p.profile
from public.players p;
revoke all on public.scoreboard from anon, authenticated;
grant select on public.scoreboard to authenticated;

-- The engine, the tests and the scripts. After every table and view, so
-- `on all tables` covers them all. service_role can only read and append log rows.
grant select, insert, update, delete on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
revoke update, delete, truncate on public.event_log from service_role;

-- 7. Realtime: pings on private Broadcast topics -----------------------------------
-- room:<session>   hosts, players of the party and its paired screens
-- stage:<session>  hosts and the party's paired screens (the TV and the host page)
-- player:<player>  the user who owns that player
-- A ping is written to realtime.messages inside the saving transaction, so it
-- is delivered only after the commit and never after a rollback.

-- One "changed" per topic per transaction (tracked in hurra.pinged); other
-- events always go out. realtime.send never raises: a failure is a warning,
-- and screens heal by polling.
create function public.ping(p_topic text, p_event text default 'changed', p_payload jsonb default '{}')
returns void language plpgsql volatile security definer set search_path = '' as $$
declare
  v_sent text := coalesce(nullif(current_setting('hurra.pinged', true), ''), '|');
begin
  if p_event = 'changed' then
    if strpos(v_sent, '|' || p_topic || '|') > 0 then
      return;
    end if;
    perform set_config('hurra.pinged', v_sent || p_topic || '|', true);
  end if;
  perform realtime.send(coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('at', public.epoch_ms(clock_timestamp())),
    p_event, p_topic, true);
end;
$$;

-- 'room' reaches every screen of the party, 'stage' only the TV and the host
-- page. A stage ping is skipped when the room was already pinged.
create function public.ping_session(p_session_id uuid, p_audience text, p_payload jsonb default '{}')
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_session_id is null or p_audience not in ('room', 'stage') then
    return;
  end if;
  if p_audience = 'stage'
     and strpos(coalesce(current_setting('hurra.pinged', true), ''), '|room:' || p_session_id || '|') > 0 then
    return;
  end if;
  perform public.ping(p_audience || ':' || p_session_id, 'changed',
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('session', p_session_id));
end;
$$;

-- A player's own topic. A 'changed' is skipped when the room was already pinged.
create function public.ping_player(p_session_id uuid, p_player_id uuid, p_event text default 'changed')
returns void language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_player_id is null then
    return;
  end if;
  if p_event = 'changed'
     and strpos(coalesce(current_setting('hurra.pinged', true), ''), '|room:' || p_session_id || '|') > 0 then
    return;
  end if;
  perform public.ping('player:' || p_player_id, p_event, jsonb_build_object('player', p_player_id));
end;
$$;

-- Who may join which private topic. Realtime evaluates the policy below as the
-- connecting user, with realtime.topic() set, when a channel joins.
create function public.can_listen(p_topic text) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_kind text := split_part(coalesce(p_topic, ''), ':', 1);
  v_id uuid := public.try_uuid(substr(coalesce(p_topic, ''), length(split_part(coalesce(p_topic, ''), ':', 1)) + 2));
  v_uid uuid := auth.uid();
begin
  if v_id is null or v_uid is null then
    return false;
  end if;
  if v_kind = 'room' then
    return public.is_host()
      or exists (select 1 from public.players where session_id = v_id and user_id = v_uid)
      or exists (select 1 from public.session_screens where session_id = v_id and user_id = v_uid);
  elsif v_kind = 'stage' then
    return public.is_host()
      or exists (select 1 from public.session_screens where session_id = v_id and user_id = v_uid);
  elsif v_kind = 'player' then
    return exists (select 1 from public.players where id = v_id and user_id = v_uid);
  end if;
  return false;
end;
$$;

-- No insert policy: clients can't send on these topics.
drop policy if exists "Hurra screens receive their pings" on realtime.messages;
create policy "Hurra screens receive their pings" on realtime.messages
  for select to authenticated
  using (realtime.messages.extension = 'broadcast'
         and (select public.can_listen((select realtime.topic()))));

-- 8. Triggers: what hosts and guests change directly is logged and pinged ---------
-- While game_commit runs (hurra.engine = on) the logging triggers stay quiet:
-- the engine logs and pings exactly once itself. Logging and ping bodies fail
-- open (a warning), so a logging bug can never block a join, an award or a
-- removal. The archive guard is the exception: it is meant to refuse.
-- Actor: host when is_host(), player when the caller has a player in the
-- party, else system.

create function public.touch_spotlight() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.spotlight_game_id is distinct from old.spotlight_game_id then
    new.spotlight_at := now();
  end if;
  return new;
end;
$$;
create trigger sessions_touch_spotlight before update of spotlight_game_id on public.sessions
  for each row execute function public.touch_spotlight();

create function public.log_session_change() returns trigger
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
    if v_changed then
      perform public.ping_session(new.id, 'room');
    end if;
  exception when others then
    raise warning 'Hurra event log (sessions): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
create trigger sessions_logged_insert after insert on public.sessions
  for each row execute function public.log_session_change();
create trigger sessions_logged_update after update of name, status, archived_at, spotlight_game_id, tv_scene
  on public.sessions for each row execute function public.log_session_change();

-- A deleted party takes its log with it; open screens still hear about it once.
create function public.ping_session_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    perform public.ping('room:' || old.id, 'changed', jsonb_build_object('session', old.id, 'deleted', true));
  exception when others then
    raise warning 'Hurra ping (sessions): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
create trigger sessions_deleted after delete on public.sessions
  for each row execute function public.ping_session_deleted();

create function public.log_player_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_actor text;
begin
  if current_setting('hurra.engine', true) = 'on' then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      v_actor := case
        when public.is_host() then 'host'
        when new.user_id = v_uid then 'player'
        else 'system' end;
      insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
      values (new.session_id, 'player.joined', v_actor, new.id, v_uid, array[new.id],
        jsonb_build_object('name', new.name, 'player_id', new.id));
      perform public.ping_session(new.session_id, 'stage');
    elsif tg_op = 'UPDATE' then
      v_actor := case
        when public.is_host() then 'host'
        when exists (select 1 from public.players p where p.session_id = new.session_id and p.user_id = v_uid) then 'player'
        else 'system' end;
      if new.name is distinct from old.name then
        insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
        values (new.session_id, 'player.renamed', v_actor, new.id, v_uid, array[new.id],
          jsonb_build_object('name', new.name, 'player_id', new.id, 'from', old.name));
        perform public.ping_session(new.session_id, 'room');
      end if;
      if new.user_id is distinct from old.user_id then
        insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
        values (new.session_id, 'player.moved', v_actor, new.id, v_uid, array[new.id],
          jsonb_build_object('name', new.name, 'player_id', new.id, 'from_user', old.user_id));
        -- The old phone is still joined on player:<id>, so it hears this.
        perform public.ping_player(new.session_id, new.id, 'moved');
        perform public.ping_session(new.session_id, 'stage');
      end if;
    else
      -- Skipped when the whole party is being deleted.
      if not exists (select 1 from public.sessions where id = old.session_id) then
        return null;
      end if;
      v_actor := case when public.is_host() then 'host' else 'system' end;
      insert into public.event_log (session_id, kind, actor, player_id, user_id, about, data)
      values (old.session_id, 'player.removed', v_actor, old.id, v_uid, array[old.id],
        jsonb_build_object('name', old.name, 'player_id', old.id));
      perform public.ping_session(old.session_id, 'room');
    end if;
  exception when others then
    raise warning 'Hurra event log (players): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
create trigger players_logged after insert or update of name, user_id or delete on public.players
  for each row execute function public.log_player_change();

-- Host awards and their Undo. The engine logs its own points.
create function public.log_score_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_row public.score_events;
  v_kind text;
begin
  if current_setting('hurra.engine', true) = 'on' then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      v_row := new;
      v_kind := 'points.awarded';
    else
      v_row := old;
      v_kind := 'points.undone';
      -- Skipped when the player (or the whole party) is being removed.
      if not exists (select 1 from public.players where id = old.player_id) then
        return null;
      end if;
    end if;
    insert into public.event_log (session_id, kind, game_id, game_type, actor, player_id, user_id, about, data)
    select v_row.session_id, v_kind, v_row.game_id, g.game_type,
      case when public.is_host() then 'host' else 'system' end,
      v_row.player_id, auth.uid(), array[v_row.player_id],
      jsonb_build_object('player_id', v_row.player_id, 'points', v_row.points, 'reason', v_row.reason,
        'game_id', v_row.game_id, 'score_event_id', v_row.id)
    from (select 1) one left join public.session_games g on g.id = v_row.game_id;
    perform public.ping_session(v_row.session_id, 'stage');
    perform public.ping_player(v_row.session_id, v_row.player_id);
  exception when others then
    raise warning 'Hurra event log (score_events): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
create trigger score_events_logged after insert or delete on public.score_events
  for each row execute function public.log_score_change();

-- Not fail open: archiving a live game is refused.
create function public.guard_game_archive() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.archived_at is not null and old.archived_at is null and new.status = 'active' then
    raise exception 'End the game before archiving it' using errcode = 'PT409', detail = 'active';
  end if;
  return new;
end;
$$;
create trigger session_games_guard_archive before update of archived_at on public.session_games
  for each row execute function public.guard_game_archive();

create function public.log_game_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_actor text := case when public.is_host() then 'host' else 'system' end;
  v_room boolean := false;
begin
  if current_setting('hurra.engine', true) = 'on' then
    return null;
  end if;
  begin
    if tg_op = 'INSERT' then
      insert into public.event_log (session_id, kind, game_id, game_type, actor, user_id, data)
      values (new.session_id, 'game.added', new.id, new.game_type, v_actor, v_uid,
        jsonb_build_object('title', new.title, 'game_type', new.game_type));
      perform public.ping_session(new.session_id, 'stage');
      return null;
    end if;
    if tg_op = 'DELETE' then
      -- Skipped when the whole party is being deleted.
      if not exists (select 1 from public.sessions where id = old.session_id) then
        return null;
      end if;
      insert into public.event_log (session_id, kind, game_id, game_type, actor, user_id, data)
      values (old.session_id, 'game.deleted', old.id, old.game_type, v_actor, v_uid,
        jsonb_build_object('title', old.title, 'game_type', old.game_type));
      perform set_config('hurra.stage_reason', 'deleted', true);
      update public.sessions set spotlight_game_id = null where id = old.session_id and spotlight_game_id = old.id;
      perform set_config('hurra.stage_reason', '', true);
      perform public.ping_session(old.session_id, 'room', jsonb_build_object('game', old.id));
      return null;
    end if;
    if new.title is distinct from old.title then
      insert into public.event_log (session_id, kind, game_id, game_type, actor, user_id, data)
      values (new.session_id, 'game.renamed', new.id, new.game_type, v_actor, v_uid,
        jsonb_build_object('title', new.title, 'game_type', new.game_type, 'from', old.title));
      v_room := v_room or new.status = 'active';
    end if;
    if new.archived_at is distinct from old.archived_at then
      insert into public.event_log (session_id, kind, game_id, game_type, actor, user_id, data)
      values (new.session_id, case when new.archived_at is null then 'game.unarchived' else 'game.archived' end,
        new.id, new.game_type, v_actor, v_uid, jsonb_build_object('title', new.title, 'game_type', new.game_type));
      if new.archived_at is not null then
        perform set_config('hurra.stage_reason', 'archived', true);
        update public.sessions set spotlight_game_id = null where id = new.session_id and spotlight_game_id = new.id;
        perform set_config('hurra.stage_reason', '', true);
        v_room := true;
      end if;
    end if;
    perform public.ping_session(new.session_id, case when v_room then 'room' else 'stage' end,
      jsonb_build_object('game', new.id));
  exception when others then
    raise warning 'Hurra event log (session_games): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
create trigger session_games_logged after insert or update of title, position, archived_at or delete
  on public.session_games for each row execute function public.log_game_change();

-- Never the values: they hold the answers.
create function public.log_settings_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    insert into public.event_log (session_id, kind, game_id, game_type, actor, user_id, data)
    select g.session_id, 'game.settings_changed', g.id, g.game_type,
      case when public.is_host() then 'host' else 'system' end, auth.uid(),
      jsonb_build_object('title', g.title, 'game_type', g.game_type)
    from public.session_games g where g.id = new.game_id;
  exception when others then
    raise warning 'Hurra event log (game_settings): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
create trigger game_settings_logged after insert or update on public.game_settings
  for each row execute function public.log_settings_change();

-- The host page counts screens; an unpaired TV reads member: false and shows its pairing screen.
create function public.log_screen_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_session uuid;
  v_user uuid;
begin
  begin
    if tg_op = 'INSERT' then
      v_session := new.session_id;
      v_user := new.user_id;
    else
      v_session := old.session_id;
      v_user := old.user_id;
      if not exists (select 1 from public.sessions where id = old.session_id) then
        return null;
      end if;
    end if;
    insert into public.event_log (session_id, kind, actor, user_id, data)
    values (v_session, case when tg_op = 'INSERT' then 'screen.paired' else 'screen.unpaired' end,
      case when public.is_host() then 'host' else 'system' end, auth.uid(), jsonb_build_object('user_id', v_user));
    perform public.ping_session(v_session, 'stage');
  exception when others then
    raise warning 'Hurra event log (session_screens): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
create trigger session_screens_logged after insert or delete on public.session_screens
  for each row execute function public.log_screen_change();

-- Every Publish and every Update carries the database clock, so the revision
-- screens follow (snapshot.recap.published_at) changes each time.
create function public.touch_recap() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if new.published_at is not null then
    new.published_at := now();
  end if;
  return new;
end;
$$;
create trigger session_recaps_touch before insert or update on public.session_recaps
  for each row execute function public.touch_recap();

create function public.log_recap_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  begin
    if tg_op = 'INSERT' and new.published_at is null then
      return null;
    end if;
    if tg_op = 'UPDATE' and new.published_at is not distinct from old.published_at then
      return null;
    end if;
    insert into public.event_log (session_id, kind, actor, user_id, data)
    values (new.session_id, case when new.published_at is null then 'recap.unpublished' else 'recap.published' end,
      case when public.is_host() then 'host' else 'system' end, auth.uid(), '{}');
    perform public.ping_session(new.session_id, 'room');
  exception when others then
    raise warning 'Hurra event log (session_recaps): % %', sqlstate, sqlerrm;
  end;
  return null;
end;
$$;
create trigger session_recaps_logged after insert or update on public.session_recaps
  for each row execute function public.log_recap_change();

-- 9. Client RPCs ---------------------------------------------------------------------
-- Errors use custom SQLSTATEs that PostgREST maps to HTTP statuses (PT400,
-- PT401, PT403, PT404, PT409), with the machine code in DETAIL. Never 40001:
-- PostgREST retries a transaction that raises it, in a tight loop.

-- The only way a non-member finds a party.
create function public.session_by_code(p_join_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when auth.uid() is null then null else (
    select jsonb_build_object('id', s.id, 'name', s.name, 'join_code', s.join_code, 'status', s.status,
      'archived_at', public.epoch_ms(s.archived_at))
    from public.sessions s where s.join_code = upper(btrim(p_join_code))
  ) end
$$;

-- Adds the caller to a party, or returns their player when they rejoin from the same browser.
create function public.join_session(p_join_code text, p_name text) returns public.players
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_join_code, '')));
  v_name text := btrim(coalesce(p_name, ''));
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
  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'Names are 1 to 40 characters' using errcode = 'PT400', detail = 'bad_name';
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

-- Checks an answer against a prompt's spec and returns it normalised: choices
-- sorted, text trimmed. Internal: only submit_answer calls it.
create function public.check_answer(p_spec jsonb, p_payload jsonb, p_session_id uuid, p_player_id uuid)
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

-- The hot path: one answer or vote from a phone, in one round trip. The share
-- lock on the prompt row lets any number of answers in at once, while closing
-- the prompt (an update) waits for the ones in flight, so a reveal sees every
-- accepted answer and nothing lands after it. Never touches the game state row.
create function public.submit_answer(p_game_id uuid, p_key text, p_payload jsonb, p_request_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_prompt public.game_prompts;
  v_game public.session_games;
  v_player uuid;
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
  select id into v_player from public.players where session_id = v_game.session_id and user_id = v_uid;
  if v_player is null then
    raise exception 'You''re not a player in this party' using errcode = 'PT403', detail = 'not_player';
  end if;
  v_answer := public.check_answer(v_prompt.spec, p_payload, v_game.session_id, v_player);

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

-- How many have answered each unrevealed prompt of the party's live games. Counts only.
create function public.prompt_tallies(p_session_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(t.game_id, t.counts), '{}'::jsonb)
  from (
    select p.game_id, jsonb_object_agg(p.key,
      (select count(*) from public.game_submissions s where s.game_id = p.game_id and s.key = p.key)) as counts
    from public.game_prompts p
    join public.session_games g on g.id = p.game_id
    where g.session_id = p_session_id and g.status = 'active' and p.revealed_at is null
      and (public.is_host() or p_session_id = any (public.my_session_ids()))
    group by p.game_id
  ) t
$$;

-- One read per refresh, for every screen. Runs as the caller, so row level
-- security decides what each screen gets. Every time is epoch ms.
create function public.session_snapshot(p_session_id uuid, p_screen text) returns jsonb
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

-- The raw material for the recap builder (src/lib/recap.ts). Hosts only: the
-- rounds' state and config hold live secrets, which the builder never publishes.
create function public.session_recap(p_session_id uuid) returns jsonb
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
    -- Everyone who ever joined: current players, plus removed ones from their player.removed rows.
    'players', (select coalesce(jsonb_agg(x.player order by x.joined, x.id), '[]'::jsonb) from (
        select p.id, p.created_at as joined, jsonb_build_object('id', p.id, 'name', p.name,
          'joined_at', public.epoch_ms(p.created_at), 'removed_at', null, 'profile', p.profile) as player
        from public.players p where p.session_id = p_session_id
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

-- Move a player to a new phone: the host shows this code, the guest types it.
create function public.host_issue_transfer(p_player_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  if not exists (select 1 from public.players where id = p_player_id) then
    raise exception 'That player isn''t in the party any more' using errcode = 'PT404', detail = 'not_found';
  end if;
  delete from public.player_transfers where player_id = p_player_id or expires_at <= now();
  insert into public.player_transfers (player_id) values (p_player_id) returning code into v_code;
  return v_code;
end;
$$;

create function public.claim_player(p_code text) returns public.players
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
  -- The players trigger logs player.moved and pings the old phone.
  update public.players set user_id = v_uid where id = v_player.id returning * into v_player;
  return v_player;
end;
$$;

-- The host closed the move dialog: its code stops working at once, so nobody
-- who read it over the host's shoulder can claim the player later. By code,
-- not by player, so closing and reopening the dialog never cancels the new one.
create function public.host_revoke_transfer(p_code text) returns void
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  delete from public.player_transfers where code = upper(btrim(coalesce(p_code, '')));
end;
$$;

-- Pair a TV: the host page shows this code, the TV laptop types it.
create function public.host_issue_screen_code(p_session_id uuid) returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_code text;
begin
  if not public.is_host() then
    raise exception 'Only hosts can do that' using errcode = 'PT403', detail = 'not_host';
  end if;
  if not exists (select 1 from public.sessions where id = p_session_id) then
    raise exception 'Party not found' using errcode = 'PT404', detail = 'not_found';
  end if;
  delete from public.screen_codes where session_id = p_session_id or expires_at <= now();
  insert into public.screen_codes (session_id) values (p_session_id) returning code into v_code;
  return v_code;
end;
$$;

-- Pairs the caller's browser as a TV of the party and returns the party's id.
-- A screen reads what a guest reads, listens on room: and stage: and sends
-- timer syncs; it has no player, so it can't answer, vote or move.
create function public.claim_screen(p_code text) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_session uuid;
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = 'PT401', detail = 'not_signed_in';
  end if;
  delete from public.screen_codes
  where code = upper(btrim(coalesce(p_code, ''))) and expires_at > now()
  returning session_id into v_session;
  if not found then
    raise exception 'That code is wrong or has expired. Get a new one from the host page.'
      using errcode = 'PT404', detail = 'bad_code';
  end if;
  -- The session_screens trigger logs screen.paired and pings stage.
  insert into public.session_screens (user_id, session_id) values (v_uid, v_session) on conflict do nothing;
  return v_session;
end;
$$;

-- The daily keep-alive (netlify/functions/keep-alive.mts). The one function anon may run.
create function public.keep_alive() returns boolean
language sql stable security invoker set search_path = '' as $$
  select true
$$;

-- 10. Engine RPCs: one read and one write per request -------------------------------
-- Both run as service_role (the secret key) and never as a client.

-- Everything a game may read for one request, from one snapshot. First it
-- closes the prompts a host action names and any past their deadline, waiting
-- for answers in flight, so the answers it returns are final.
create function public.game_load(p_game_id uuid, p_user_id uuid, p_close text[] default '{}', p_request_id uuid default null)
returns jsonb language plpgsql volatile security invoker set search_path = '' as $$
declare
  v_session uuid;
  v_closed int := 0;
  v_n int;
  v jsonb;
begin
  select g.session_id into v_session from public.session_games g where g.id = p_game_id;
  if v_session is null then
    return null;
  end if;

  -- Only a host's close counts, so a guest can never close a question.
  if coalesce(cardinality(p_close), 0) > 0 and exists (select 1 from public.hosts h where h.user_id = p_user_id) then
    update public.game_prompts set closed_at = clock_timestamp()
    where game_id = p_game_id and closed_at is null and key = any (p_close);
    get diagnostics v_n = row_count;
    v_closed := v_closed + v_n;
  end if;
  update public.game_prompts set closed_at = closes_at
  where game_id = p_game_id and closed_at is null and closes_at <= clock_timestamp();
  get diagnostics v_n = row_count;
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
        'config', st.config, 'members', to_jsonb(st.members))
      from public.game_states st where st.game_id = g.id),
    'session', (select jsonb_build_object('id', s.id, 'name', s.name, 'data', s.data,
        'spotlight_game_id', s.spotlight_game_id)
      from public.sessions s where s.id = g.session_id),
    'players', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'profile', p.profile)
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

-- Saves one request's outcome: the state and its projections, the effects,
-- the log rows and one ping, in one transaction. One jsonb argument (the
-- CommitPayload of src/games/core/runtime.ts), so new fields never change the
-- signature. The first write claims the request id: a copy returns
-- { replayed: true } and saves nothing.
create function public.game_commit(p jsonb) returns jsonb
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
      join public.players pl on pl.id = public.try_uuid(v.key) and pl.session_id = v_session
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
      join public.players pl on pl.id = public.try_uuid(s.key) and pl.session_id = v_session
    )
    select coalesce(jsonb_object_agg(coalesce(n.player_id, o.player_id), coalesce(n.points, 0) - coalesce(o.points, 0)), '{}'::jsonb)
    into v_scores_delta
    from old o full join new n on n.player_id = o.player_id
    where coalesce(n.points, 0) <> coalesce(o.points, 0);

    delete from public.game_scores gs where gs.game_id = v_game.id and not ((p -> 'scores') ? gs.player_id::text);
    insert into public.game_scores as gs (game_id, player_id, session_id, points)
    select v_game.id, pl.id, v_session, round((s.value)::numeric)::int
    from jsonb_each_text(p -> 'scores') s
    join public.players pl on pl.id = public.try_uuid(s.key) and pl.session_id = v_session
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
    join public.players pl on pl.id = public.try_uuid(e.value ->> 'player_id') and pl.session_id = v_session
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
    where pl.id = public.try_uuid(patch.key) and pl.session_id = v_session
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
        join public.players pl on pl.id = public.try_uuid(t.value) and pl.session_id = v_session) end as ids
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

-- 11. Storage: game-media (fusion pictures) ---------------------------------------------
-- 2 MB and JPEG only: the browser re-encodes every upload first (src/lib/media.ts).
-- Only hosts write; everyone else reads through the bucket's public URL.
-- Paths are <session id>/<game id>/<random uuid>.jpg (+ .thumb.jpg), so a file
-- name never says who is in a picture.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-media', 'game-media', true, 2097152, array['image/jpeg'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Hosts read game media" on storage.objects;
create policy "Hosts read game media" on storage.objects
  for select to authenticated
  using (bucket_id = 'game-media' and (select public.is_host()));
drop policy if exists "Hosts upload game media" on storage.objects;
create policy "Hosts upload game media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'game-media' and (select public.is_host()));
drop policy if exists "Hosts change game media" on storage.objects;
create policy "Hosts change game media" on storage.objects
  for update to authenticated
  using (bucket_id = 'game-media' and (select public.is_host()))
  with check (bucket_id = 'game-media' and (select public.is_host()));
drop policy if exists "Hosts delete game media" on storage.objects;
create policy "Hosts delete game media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'game-media' and (select public.is_host()));

-- 12. Function grants: everything revoked, then exactly what each role needs -------------

revoke execute on function
  public.random_code(int), public.epoch_ms(timestamptz), public.try_uuid(text),
  public.is_host(), public.my_player_ids(), public.my_session_ids(), public.session_exists(uuid),
  public.moved_away(uuid),
  public.ping(text, text, jsonb), public.ping_session(uuid, text, jsonb), public.ping_player(uuid, uuid, text),
  public.can_listen(text),
  public.touch_spotlight(), public.log_session_change(), public.ping_session_deleted(), public.log_player_change(),
  public.log_score_change(), public.guard_game_archive(), public.log_game_change(), public.log_settings_change(),
  public.log_screen_change(), public.touch_recap(), public.log_recap_change(),
  public.session_by_code(text), public.join_session(text, text), public.check_answer(jsonb, jsonb, uuid, uuid),
  public.submit_answer(uuid, text, jsonb, uuid), public.prompt_tallies(uuid), public.session_snapshot(uuid, text),
  public.session_recap(uuid), public.host_issue_transfer(uuid), public.claim_player(text),
  public.host_revoke_transfer(text), public.host_issue_screen_code(uuid), public.claim_screen(text),
  public.keep_alive(), public.game_load(uuid, uuid, text[], uuid), public.game_commit(jsonb)
from public, anon, authenticated;

-- Helpers: policies and the invoker functions run as the caller.
grant execute on function
  public.random_code(int), public.epoch_ms(timestamptz), public.try_uuid(text),
  public.is_host(), public.my_player_ids(), public.my_session_ids(), public.session_exists(uuid),
  public.moved_away(uuid)
to authenticated, service_role;

-- What the app calls.
grant execute on function
  public.can_listen(text),
  public.session_by_code(text), public.join_session(text, text), public.submit_answer(uuid, text, jsonb, uuid),
  public.prompt_tallies(uuid), public.session_snapshot(uuid, text), public.session_recap(uuid),
  public.host_issue_transfer(uuid), public.claim_player(text), public.host_revoke_transfer(text),
  public.host_issue_screen_code(uuid), public.claim_screen(text), public.keep_alive()
to authenticated, service_role;

-- The keep-alive is the one function anon may run.
grant execute on function public.keep_alive() to anon;

-- The engine (and the scripts with the secret key). Stated, not left to default privileges.
grant execute on function
  public.ping(text, text, jsonb), public.ping_session(uuid, text, jsonb), public.ping_player(uuid, uuid, text),
  public.check_answer(jsonb, jsonb, uuid, uuid),
  public.game_load(uuid, uuid, text[], uuid), public.game_commit(jsonb)
to service_role;

-- 13. Self-checks: abort the migration when a rule above doesn't hold --------------------

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
