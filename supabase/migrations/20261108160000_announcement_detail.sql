-- Announcements get an optional second line: the message is the headline
-- ("Mads got Anna") and the detail a quieter line under it ("Get someone to
-- hum a tune"). Nullable, so engines that don't send it keep working, and
-- older clients simply don't read it.
alter table public.session_feed
  add column detail text check (char_length(detail) <= 280);

comment on column public.session_feed.detail is 'Optional second line under the message. Public like the rest of the feed.';

-- Same as 20261108150000_game_events.sql, plus the detail column.
create or replace function public.apply_game_state(
  p_game_id uuid,
  p_expected_version int,
  p_state jsonb,
  p_public_state jsonb,
  p_player_views jsonb,
  p_scores jsonb,
  p_effects jsonb,
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

  insert into public.session_feed (session_id, game_id, message, detail, audience, sound, icon, tone)
  select
    v_session_id,
    p_game_id,
    case jsonb_typeof(a) when 'string' then a #>> '{}' else a ->> 'message' end,
    a ->> 'detail',
    case when jsonb_typeof(a -> 'to') = 'array'
      then array(select x::uuid from jsonb_array_elements_text(a -> 'to') x)
    end,
    a ->> 'sound',
    a ->> 'icon',
    a ->> 'tone'
  from jsonb_array_elements(coalesce(p_effects -> 'announcements', '[]')) a;

  return v_version;
end;
$$;

revoke execute on function public.apply_game_state(uuid, int, jsonb, jsonb, jsonb, jsonb, jsonb, text)
  from public, anon, authenticated;
