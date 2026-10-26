-- Original-game time controls: main time + per-turn DELAY per active timeline
-- ("20+5/L" = 20 min main time; at the start of each turn the mover gets a
-- delay of 5 s x active timelines during which the main clock does not run;
-- unused delay is lost). Replaces the increment model from clock_timestamps.
--
-- The server can't run the rules engine, so the number of active timelines at
-- the start of each turn is reported by the clients:
-- * create_game(p_first_active_timelines): count at the start of turn 0
--   (variant's starting active timelines; default 1).
-- * submit_action(p_next_active_timelines): count at the start of the
--   opponent's next turn, computed by the submitter's engine. Stored in the
--   action stamp as "nextActiveTimelines" next to "at". Required for timed
--   games; the receiving client can verify it with its own engine.
--
-- Clock settings: {"initial": seconds, "delayPerTimeline": seconds}.
--
-- Model (mirrored by computeClocks() in src/net/clock.ts):
--   L(0) = first_active_timelines, L(k) = actions[k-1].nextActiveTimelines
--   turn k lasts from (actions[k-1].at or started_at) to actions[k].at (or now)
--   main time used in turn k = max(0, duration - delayPerTimeline * L(k))
--   remaining(c) = initial - sum of main time used over c's turns

alter table public.games add column if not exists first_active_timelines int not null default 1;
alter table public.games drop constraint if exists games_first_active_timelines_check;
alter table public.games add constraint games_first_active_timelines_check
  check (first_active_timelines between 1 and 1000);

create or replace function public._clock_remaining_ms(g public.games, p_color text, p_now timestamptz)
returns bigint language plpgsql stable set search_path = '' as $$
declare
  v_initial numeric;
  v_delay numeric;
  v_prev timestamptz;
  v_at timestamptz;
  v_used numeric := 0;
  v_lines int;
  v_len int;
  v_end timestamptz;
  i int;
begin
  if g.clock is null then
    return null;
  end if;
  v_initial := coalesce((g.clock->>'initial')::numeric, 0) * 1000;
  v_delay := coalesce((g.clock->>'delayPerTimeline')::numeric, 0) * 1000;
  if g.started_at is null then
    return floor(v_initial);
  end if;
  v_prev := g.started_at;
  v_lines := coalesce(g.first_active_timelines, 1);
  v_len := jsonb_array_length(g.actions);
  for i in 0 .. v_len - 1 loop
    v_at := coalesce((g.actions->i->>'at')::timestamptz, v_prev);
    if g.actions->i->>'player' = p_color then
      v_used := v_used + greatest(extract(epoch from (v_at - v_prev)) * 1000 - v_delay * v_lines, 0);
    end if;
    v_lines := coalesce((g.actions->i->>'nextActiveTimelines')::int, 1);
    v_prev := v_at;
  end loop;
  if (v_len = 0 and p_color = g.first_player)
     or (v_len > 0 and g.actions->(v_len - 1)->>'player' is distinct from p_color) then
    v_end := case when g.result->>'kind' = 'ongoing' then p_now else coalesce(g.ended_at, p_now) end;
    v_used := v_used + greatest(extract(epoch from (v_end - v_prev)) * 1000 - v_delay * v_lines, 0);
  end if;
  return floor(v_initial - v_used);
end $$;
revoke all on function public._clock_remaining_ms(public.games, text, timestamptz) from public, anon, authenticated;

create or replace function public._game_json(g public.games, p_color text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'code', g.code,
    'variantId', g.variant_id,
    'myColor', p_color,
    'actions', g.actions,
    'result', g.result,
    'clock', g.clock,
    'opponentJoined', g.white_token_hash is not null and g.black_token_hash is not null,
    'firstPlayer', g.first_player,
    'firstActiveTimelines', g.first_active_timelines,
    'startedAt', g.started_at,
    'endedAt', g.ended_at,
    'serverNow', now(),
    'clockMs', case when g.clock is null then null else jsonb_build_object(
      'white', public._clock_remaining_ms(g, 'white', now()),
      'black', public._clock_remaining_ms(g, 'black', now())
    ) end
  )
$$;
revoke all on function public._game_json(public.games, text) from public, anon, authenticated;

drop function if exists public.create_game(text, text, text, jsonb, text);
create or replace function public.create_game(
  p_variant text, p_color text, p_token text, p_clock jsonb default null,
  p_first text default 'white', p_first_active_timelines int default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_color text := p_color;
  v_clock jsonb := p_clock;
  v_initial numeric;
  v_delay numeric := 0;
  v_row public.games;
  i int;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 128 then
    raise exception 'invalid token';
  end if;
  if p_variant is null or length(p_variant) < 1 or length(p_variant) > 64 then
    raise exception 'invalid variant';
  end if;
  if v_color = 'random' then
    v_color := case when random() < 0.5 then 'white' else 'black' end;
  end if;
  if v_color is null or v_color not in ('white', 'black') then
    raise exception 'invalid color';
  end if;
  if p_first is null or p_first not in ('white', 'black') then
    raise exception 'invalid first player';
  end if;
  if p_first_active_timelines is null or p_first_active_timelines < 1 or p_first_active_timelines > 1000 then
    raise exception 'invalid active timeline count';
  end if;
  if v_clock is not null and jsonb_typeof(v_clock) = 'null' then
    v_clock := null;
  end if;
  if v_clock is not null then
    if jsonb_typeof(v_clock) <> 'object' or jsonb_typeof(v_clock->'initial') is distinct from 'number' then
      raise exception 'invalid clock';
    end if;
    if v_clock ? 'increment' then
      raise exception 'invalid clock: increment is not supported, use delayPerTimeline';
    end if;
    if v_clock ? 'delayPerTimeline' and jsonb_typeof(v_clock->'delayPerTimeline') <> 'null' then
      if jsonb_typeof(v_clock->'delayPerTimeline') <> 'number' then
        raise exception 'invalid clock';
      end if;
      v_delay := (v_clock->>'delayPerTimeline')::numeric;
    end if;
    v_initial := (v_clock->>'initial')::numeric;
    if v_initial <= 0 or v_initial > 86400 or v_delay < 0 or v_delay > 600 then
      raise exception 'invalid clock';
    end if;
    v_clock := jsonb_build_object('initial', v_initial, 'delayPerTimeline', v_delay);
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into public.games
        (code, variant_id, white_token_hash, black_token_hash, clock, first_player, first_active_timelines)
      values (
        v_code, p_variant,
        case when v_color = 'white' then public._token_hash(p_token) end,
        case when v_color = 'black' then public._token_hash(p_token) end,
        v_clock, p_first, p_first_active_timelines
      )
      returning * into v_row;
      exit;
    exception when unique_violation then
      -- collision, try another code
    end;
  end loop;
  return public._game_json(v_row, v_color);
end $$;

drop function if exists public.submit_action(text, text, int, jsonb);
create or replace function public.submit_action(
  p_code text, p_token text, p_index int, p_action jsonb, p_next_active_timelines int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_hash text := public._token_hash(p_token);
  v_color text;
  v_len int;
  v_stamp jsonb;
begin
  select * into v_row from public.games where code = upper(p_code) for update;
  if not found then
    raise exception 'game not found';
  end if;
  v_color := case
    when v_row.white_token_hash = v_hash then 'white'
    when v_row.black_token_hash = v_hash then 'black' end;
  if v_color is null then
    raise exception 'not a player in this game';
  end if;
  if v_row.result->>'kind' <> 'ongoing' then
    raise exception 'game is over';
  end if;
  if v_row.white_token_hash is null or v_row.black_token_hash is null then
    raise exception 'waiting for opponent';
  end if;
  if jsonb_typeof(p_action) <> 'object' or octet_length(p_action::text) > 32768 then
    raise exception 'invalid action';
  end if;
  if p_action->>'player' is distinct from v_color then
    raise exception 'action player does not match your seat';
  end if;
  if p_next_active_timelines is not null
     and (p_next_active_timelines < 1 or p_next_active_timelines > 1000) then
    raise exception 'invalid active timeline count';
  end if;
  if p_next_active_timelines is null and v_row.clock is not null then
    raise exception 'missing active timeline count';
  end if;
  v_len := jsonb_array_length(v_row.actions);
  if v_len >= 2000 then
    raise exception 'game too long';
  end if;
  if p_index is distinct from v_len then
    raise exception 'out of sync: expected index %', v_len;
  end if;
  if (v_len = 0 and v_color <> v_row.first_player)
     or (v_len > 0 and v_row.actions->(v_len - 1)->>'player' = v_color) then
    raise exception 'not your turn';
  end if;
  if v_row.clock is not null and public._clock_remaining_ms(v_row, v_color, now()) <= 0 then
    -- Flag fell before the move arrived: the game ends on time, the move is not stored.
    update public.games
      set result = jsonb_build_object('kind', 'timeout', 'winner',
                     case when v_color = 'white' then 'black' else 'white' end),
          ended_at = now(), updated_at = now()
      where code = v_row.code
      returning * into v_row;
    return public._game_json(v_row, v_color);
  end if;
  v_stamp := jsonb_build_object('at', now());
  if p_next_active_timelines is not null then
    v_stamp := v_stamp || jsonb_build_object('nextActiveTimelines', p_next_active_timelines);
  end if;
  update public.games
    set actions = actions || jsonb_build_array((p_action - 'nextActiveTimelines') || v_stamp),
        updated_at = now()
    where code = v_row.code
    returning * into v_row;
  return public._game_json(v_row, v_color);
end $$;

revoke all on function public.create_game(text, text, text, jsonb, text, int) from public;
revoke all on function public.submit_action(text, text, int, jsonb, int) from public;
grant execute on function public.create_game(text, text, text, jsonb, text, int) to anon, authenticated;
grant execute on function public.submit_action(text, text, int, jsonb, int) to anon, authenticated;
