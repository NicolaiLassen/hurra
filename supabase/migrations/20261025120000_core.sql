-- Core schema: sessions people join by QR code, players tied to their
-- (anonymous) Supabase auth user, pluggable games, and a points ledger the
-- scoreboard is computed from.

-- Short human-friendly codes (no 0/O/1/I) for join links and player QR codes.
create function public.random_code(len int)
returns text
language sql
volatile
set search_path = ''
as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, len);
$$;

-- Hosts ----------------------------------------------------------------------

-- Hosts are regular email/password users listed here by id. Keyed on the user
-- rather than the email, so signing up with a host's address grants nothing.
create table public.hosts (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.hosts enable row level security;
-- No policies: the list is only read through is_host().

create function public.is_host()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.hosts where user_id = auth.uid());
$$;

-- Tables ---------------------------------------------------------------------

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  join_code text not null unique default public.random_code(6) check (join_code ~ '^[A-Z0-9]{4,12}$'),
  -- 'closed' stops new players from joining; existing players keep playing.
  status text not null default 'open' check (status in ('open', 'closed')),
  created_at timestamptz not null default now()
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  -- Encoded in the player's personal QR code.
  code text not null unique default public.random_code(5),
  created_at timestamptz not null default now(),
  unique (session_id, user_id),
  unique (id, session_id)
);

create unique index players_session_name_key on public.players (session_id, lower(name));

create table public.session_games (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id) on delete cascade,
  -- Key into the frontend game registry (src/games/registry.ts).
  game_type text not null,
  title text not null check (char_length(title) between 1 and 80),
  position int not null default 0,
  status text not null default 'pending' check (status in ('pending', 'active', 'finished')),
  -- Free-form per-game settings and live state, owned by the game module.
  config jsonb not null default '{}',
  state jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (id, session_id)
);

create index session_games_session_idx on public.session_games (session_id, position);
-- At most one game is live per session; that's what players' phones show.
create unique index session_games_one_active_idx on public.session_games (session_id) where status = 'active';

-- Points ledger: the score is the sum of events, so mistakes are undone by
-- deleting the event and every point can be traced to a game and a host.
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

create view public.scoreboard
with (security_invoker = true)
as
select
  p.session_id,
  p.id as player_id,
  p.name,
  p.code,
  coalesce(sum(e.points), 0)::int as points
from public.players p
left join public.score_events e on e.player_id = p.id
group by p.id;

-- Row level security ---------------------------------------------------------
-- Every visitor is signed in (players anonymously), so "authenticated" covers
-- everyone. Players can read everything in the app; only hosts write, and
-- players join through join_session() below.

alter table public.sessions enable row level security;
alter table public.players enable row level security;
alter table public.session_games enable row level security;
alter table public.score_events enable row level security;

create policy "Signed-in users can read sessions" on public.sessions
  for select to authenticated using (true);
create policy "Hosts manage sessions" on public.sessions
  for all to authenticated using ((select public.is_host())) with check ((select public.is_host()));

create policy "Signed-in users can read players" on public.players
  for select to authenticated using (true);
create policy "Hosts manage players" on public.players
  for all to authenticated using ((select public.is_host())) with check ((select public.is_host()));

create policy "Signed-in users can read games" on public.session_games
  for select to authenticated using (true);
create policy "Hosts manage games" on public.session_games
  for all to authenticated using ((select public.is_host())) with check ((select public.is_host()));

create policy "Signed-in users can read scores" on public.score_events
  for select to authenticated using (true);
create policy "Hosts manage scores" on public.score_events
  for all to authenticated using ((select public.is_host())) with check ((select public.is_host()));

-- Functions ------------------------------------------------------------------

-- Adds the calling user to a session, or returns their existing player when
-- they rejoin from the same device.
create function public.join_session(p_join_code text, p_name text)
returns public.players
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session public.sessions;
  v_player public.players;
  v_name text := btrim(p_name);
begin
  if auth.uid() is null then
    raise exception 'You need to be signed in to join';
  end if;

  select * into v_session from public.sessions where join_code = upper(btrim(p_join_code));
  if not found then
    raise exception 'No session with code %', upper(btrim(p_join_code));
  end if;

  select * into v_player from public.players where session_id = v_session.id and user_id = auth.uid();
  if found then
    return v_player;
  end if;

  if v_session.status <> 'open' then
    raise exception 'This session is closed for new players';
  end if;

  if v_name = '' or char_length(v_name) > 40 then
    raise exception 'Names must be between 1 and 40 characters';
  end if;

  begin
    insert into public.players (session_id, user_id, name)
    values (v_session.id, auth.uid(), v_name)
    returning * into v_player;
  exception when unique_violation then
    raise exception 'Someone already joined as "%". Try another name.', v_name;
  end;

  return v_player;
end;
$$;

-- Makes a game the live one, finishing whatever was live before.
create function public.start_game(p_game_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_host() then
    raise exception 'Only hosts can start games';
  end if;

  update public.session_games
  set status = 'finished'
  where status = 'active'
    and id <> p_game_id
    and session_id = (select session_id from public.session_games where id = p_game_id);

  update public.session_games set status = 'active' where id = p_game_id;
end;
$$;

revoke execute on function public.join_session(text, text) from public, anon;
revoke execute on function public.start_game(uuid) from public, anon;
revoke execute on function public.is_host() from public, anon;
-- random_code() stays executable by authenticated: it's evaluated as a column
-- default when hosts insert sessions.
revoke execute on function public.random_code(int) from public, anon;
grant execute on function public.random_code(int) to authenticated;
grant execute on function public.join_session(text, text) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.is_host() to authenticated;

-- Realtime: phones and the scoreboard update live from these tables.
alter publication supabase_realtime add table
  public.sessions,
  public.players,
  public.session_games,
  public.score_events;
