-- Server-authoritative clocks.
--
-- * Every stored action is stamped with the server time it was accepted:
--   actions[i] = client action || {"at": now()}.
-- * games.started_at is stamped when the second seat is claimed (both clocks
--   start then; first_player's clock runs first). games.ended_at when a result is set.
-- * Every RPC response now also carries startedAt, endedAt, serverNow (for
--   client clock-offset estimation) and clockMs ({white, black} remaining
--   milliseconds at serverNow, or null for untimed games).
--
-- Clock model (mirrored client-side by computeClocks() in src/net/clock.ts):
-- (first_player = the side that submits action 0: 'white' normally, 'black'
--  in turn-zero variants; given by the creator via create_game(p_first).)
--   remaining(c) = initial*1000 + increment*1000 * (#completed turns of c)
--                  - sum over c's turns of (action.at - previous action.at or started_at)
--                  - (if c is to move and game ongoing) (now - last action.at or started_at)
-- After the game ends the running clock is frozen at ended_at.
--
-- Additional validation added here:
-- * create_game: rejects a null color (previously slipped through) and
--   malformed clocks; normalises the stored clock to {initial, increment}.
-- * create_game: new optional p_first ('white' default | 'black'): the side
--   that submits the first action. Turn order is strictly alternating from it.
-- * submit_action: both seats must be taken; action 0 must be by first_player; a move
--   arriving after the mover's clock has run out ends the game on time
--   (result set to timeout, action NOT stored) instead of being accepted.
-- * set_result: winner must be 'white'/'black' for checkmate/resignation/
--   timeout; you can only resign for yourself; timeout claims are checked
--   against the server clock ("clock not expired: N ms remaining").

alter table public.games add column if not exists started_at timestamptz;
alter table public.games add column if not exists ended_at timestamptz;
alter table public.games add column if not exists first_player text not null default 'white';
alter table public.games drop constraint if exists games_first_player_check;
alter table public.games add constraint games_first_player_check check (first_player in ('white', 'black'));

update public.games set started_at = updated_at
  where started_at is null and white_token_hash is not null and black_token_hash is not null;
update public.games set ended_at = updated_at
  where ended_at is null and result->>'kind' <> 'ongoing';

-- Remaining clock time in ms for p_color at p_now (null for untimed games).
create or replace function public._clock_remaining_ms(g public.games, p_color text, p_now timestamptz)
returns bigint language plpgsql stable set search_path = '' as $$
declare
  v_initial numeric;
  v_inc numeric;
  v_prev timestamptz;
  v_at timestamptz;
  v_used numeric := 0;
  v_turns int := 0;
  v_len int;
  v_end timestamptz;
  i int;
begin
  if g.clock is null then
    return null;
  end if;
  v_initial := coalesce((g.clock->>'initial')::numeric, 0) * 1000;
  v_inc := coalesce((g.clock->>'increment')::numeric, 0) * 1000;
  if g.started_at is null then
    return floor(v_initial);
  end if;
  v_prev := g.started_at;
  v_len := jsonb_array_length(g.actions);
  for i in 0 .. v_len - 1 loop
    v_at := coalesce((g.actions->i->>'at')::timestamptz, v_prev);
    if g.actions->i->>'player' = p_color then
      v_used := v_used + extract(epoch from (v_at - v_prev)) * 1000;
      v_turns := v_turns + 1;
    end if;
    v_prev := v_at;
  end loop;
  if (v_len = 0 and p_color = g.first_player)
     or (v_len > 0 and g.actions->(v_len - 1)->>'player' is distinct from p_color) then
    v_end := case when g.result->>'kind' = 'ongoing' then p_now else coalesce(g.ended_at, p_now) end;
    v_used := v_used + greatest(extract(epoch from (v_end - v_prev)) * 1000, 0);
  end if;
  return floor(v_initial + v_inc * v_turns - v_used);
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

-- Signature gains p_first, so replace the 4-arg version (named-arg callers
-- that omit p_first keep working through the default).
drop function if exists public.create_game(text, text, text, jsonb);
create or replace function public.create_game(
  p_variant text, p_color text, p_token text, p_clock jsonb default null, p_first text default 'white')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_color text := p_color;
  v_clock jsonb := p_clock;
  v_initial numeric;
  v_inc numeric := 0;
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
  if v_clock is not null and jsonb_typeof(v_clock) = 'null' then
    v_clock := null;
  end if;
  if v_clock is not null then
    if jsonb_typeof(v_clock) <> 'object' or jsonb_typeof(v_clock->'initial') is distinct from 'number' then
      raise exception 'invalid clock';
    end if;
    if v_clock ? 'increment' and jsonb_typeof(v_clock->'increment') <> 'null' then
      if jsonb_typeof(v_clock->'increment') <> 'number' then
        raise exception 'invalid clock';
      end if;
      v_inc := (v_clock->>'increment')::numeric;
    end if;
    v_initial := (v_clock->>'initial')::numeric;
    if v_initial <= 0 or v_initial > 86400 or v_inc < 0 or v_inc > 3600 then
      raise exception 'invalid clock';
    end if;
    v_clock := jsonb_build_object('initial', v_initial, 'increment', v_inc);
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into public.games (code, variant_id, white_token_hash, black_token_hash, clock, first_player)
      values (
        v_code, p_variant,
        case when v_color = 'white' then public._token_hash(p_token) end,
        case when v_color = 'black' then public._token_hash(p_token) end,
        v_clock, p_first
      )
      returning * into v_row;
      exit;
    exception when unique_violation then
      -- collision, try another code
    end;
  end loop;
  return public._game_json(v_row, v_color);
end $$;

create or replace function public.join_game(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_hash text := public._token_hash(p_token);
  v_color text;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 128 then
    raise exception 'invalid token';
  end if;
  select * into v_row from public.games where code = upper(p_code) for update;
  if not found then
    raise exception 'game not found';
  end if;
  if v_row.white_token_hash = v_hash then
    v_color := 'white';
  elsif v_row.black_token_hash = v_hash then
    v_color := 'black';
  elsif v_row.white_token_hash is null then
    update public.games
      set white_token_hash = v_hash,
          started_at = case when black_token_hash is not null then coalesce(started_at, now()) else started_at end,
          updated_at = now()
      where code = v_row.code returning * into v_row;
    v_color := 'white';
  elsif v_row.black_token_hash is null then
    update public.games
      set black_token_hash = v_hash,
          started_at = case when white_token_hash is not null then coalesce(started_at, now()) else started_at end,
          updated_at = now()
      where code = v_row.code returning * into v_row;
    v_color := 'black';
  else
    raise exception 'game is full';
  end if;
  return public._game_json(v_row, v_color);
end $$;

create or replace function public.submit_action(p_code text, p_token text, p_index int, p_action jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_hash text := public._token_hash(p_token);
  v_color text;
  v_len int;
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
  update public.games
    set actions = actions || jsonb_build_array(p_action || jsonb_build_object('at', now())),
        updated_at = now()
    where code = v_row.code
    returning * into v_row;
  return public._game_json(v_row, v_color);
end $$;

create or replace function public.set_result(p_code text, p_token text, p_result jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_hash text := public._token_hash(p_token);
  v_color text;
  v_kind text;
  v_winner text;
  v_result jsonb;
  v_remaining bigint;
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
  if jsonb_typeof(p_result) is distinct from 'object'
     or p_result->>'kind' is null
     or p_result->>'kind' not in ('ongoing', 'checkmate', 'stalemate', 'resignation', 'timeout', 'draw-agreed')
     or octet_length(p_result::text) > 1024 then
    raise exception 'invalid result';
  end if;
  v_kind := p_result->>'kind';
  if v_kind in ('checkmate', 'resignation', 'timeout') then
    v_winner := p_result->>'winner';
    if v_winner is null or v_winner not in ('white', 'black') then
      raise exception 'invalid result';
    end if;
    v_result := jsonb_build_object('kind', v_kind, 'winner', v_winner);
  else
    v_result := jsonb_build_object('kind', v_kind);
  end if;
  if v_kind = 'resignation' and v_winner = v_color then
    raise exception 'you can only resign for yourself';
  end if;
  if v_row.result->>'kind' <> 'ongoing' or v_kind = 'ongoing' then
    return public._game_json(v_row, v_color);
  end if;
  if v_kind = 'timeout' then
    if v_row.clock is null or v_row.started_at is null then
      raise exception 'game is not timed';
    end if;
    v_remaining := public._clock_remaining_ms(v_row,
      case when v_winner = 'white' then 'black' else 'white' end, now());
    if v_remaining > 0 then
      raise exception 'clock not expired: % ms remaining', v_remaining;
    end if;
  end if;
  update public.games set result = v_result, ended_at = now(), updated_at = now()
    where code = v_row.code returning * into v_row;
  return public._game_json(v_row, v_color);
end $$;

-- create or replace keeps existing ACLs; restate them for clarity.
revoke all on function public.create_game(text, text, text, jsonb, text) from public;
revoke all on function public.join_game(text, text) from public;
revoke all on function public.get_game(text, text) from public;
revoke all on function public.submit_action(text, text, int, jsonb) from public;
revoke all on function public.set_result(text, text, jsonb) from public;
grant execute on function public.create_game(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.join_game(text, text) to anon, authenticated;
grant execute on function public.get_game(text, text) to anon, authenticated;
grant execute on function public.submit_action(text, text, int, jsonb) to anon, authenticated;
grant execute on function public.set_result(text, text, jsonb) to anon, authenticated;
