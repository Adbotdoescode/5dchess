-- Server-authoritative online play.
--
-- Actions and result claims now go through the Edge Function `game-action`
-- (supabase/functions/game-action), which replays the game with the rules
-- engine, rejects illegal actions, computes the active-timeline count itself
-- and detects checkmate/stalemate. It calls the raw RPCs below with the
-- service role; anon/authenticated can no longer execute them:
--   create_game     (the function validates the variant and derives first
--                    player / starting active timelines from the engine)
--   submit_action   (only engine-validated actions are stored)
--   set_result      (checkmate/stalemate only come from the server's search)
--
-- New persisted state (exposed in the game JSON so clients restore their UI
-- after a reload):
--   draw_offer     colour with an open draw offer; cleared by any submitted
--                  action, by a decline, and when the game ends.
--   rematch_offer  colour that asked for a rematch (finished games only).
--   rematch_code   code of the rematch game, set once when it is created.
--                  The rematch reuses both seat token hashes (colours
--                  swapped), so each player resumes their seat with the token
--                  they already hold and nobody else can grab a seat.
--   cancelled_at   set by cancel_game; joins then fail with "game was cancelled".
--
-- New public, token-checked RPCs: offer_draw, answer_draw, cancel_game,
-- offer_rematch (accepting = offering after the opponent did).

alter table public.games add column if not exists draw_offer text;
alter table public.games add column if not exists rematch_offer text;
alter table public.games add column if not exists rematch_code text;
alter table public.games add column if not exists cancelled_at timestamptz;
alter table public.games drop constraint if exists games_draw_offer_check;
alter table public.games add constraint games_draw_offer_check check (draw_offer in ('white', 'black'));
alter table public.games drop constraint if exists games_rematch_offer_check;
alter table public.games add constraint games_rematch_offer_check check (rematch_offer in ('white', 'black'));

-- ---------------------------------------------------------------- helpers

create or replace function public._gen_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_code text := '';
  i int;
begin
  for i in 1..6 loop
    v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
  end loop;
  return v_code;
end $$;
revoke all on function public._gen_code() from public, anon, authenticated;

-- Seat owned by p_token in g ('white' | 'black'), or null.
create or replace function public._seat(g public.games, p_token text)
returns text language sql stable set search_path = '' as $$
  select case
    when p_token is null then null
    when g.white_token_hash = public._token_hash(p_token) then 'white'
    when g.black_token_hash = public._token_hash(p_token) then 'black'
  end
$$;
revoke all on function public._seat(public.games, text) from public, anon, authenticated;

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
    'drawOffer', g.draw_offer,
    'rematchOffer', g.rematch_offer,
    'rematchCode', g.rematch_code,
    'cancelled', g.cancelled_at is not null,
    'serverNow', now(),
    'clockMs', case when g.clock is null then null else jsonb_build_object(
      'white', public._clock_remaining_ms(g, 'white', now()),
      'black', public._clock_remaining_ms(g, 'black', now())
    ) end
  )
$$;
revoke all on function public._game_json(public.games, text) from public, anon, authenticated;

-- ---------------------------------------------------------------- join (public)

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
  elsif v_row.cancelled_at is not null then
    raise exception 'game was cancelled';
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

-- ---------------------------------------------------------------- submit (service role only)

create or replace function public.submit_action(
  p_code text, p_token text, p_index int, p_action jsonb, p_next_active_timelines int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_color text;
  v_len int;
  v_stamp jsonb;
begin
  select * into v_row from public.games where code = upper(p_code) for update;
  if not found then
    raise exception 'game not found';
  end if;
  v_color := public._seat(v_row, p_token);
  if v_color is null then
    raise exception 'not a player in this game';
  end if;
  if v_row.result->>'kind' <> 'ongoing' then
    raise exception 'game is over';
  end if;
  if v_row.cancelled_at is not null then
    raise exception 'game was cancelled';
  end if;
  if v_row.white_token_hash is null or v_row.black_token_hash is null then
    raise exception 'waiting for opponent';
  end if;
  if jsonb_typeof(p_action) <> 'object' or octet_length(p_action::text) > 65536 then
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
          draw_offer = null, ended_at = now(), updated_at = now()
      where code = v_row.code
      returning * into v_row;
    return public._game_json(v_row, v_color);
  end if;
  v_stamp := jsonb_build_object('at', now());
  if p_next_active_timelines is not null then
    v_stamp := v_stamp || jsonb_build_object('nextActiveTimelines', p_next_active_timelines);
  end if;
  update public.games
    set actions = actions || jsonb_build_array((p_action - 'nextActiveTimelines' - 'at') || v_stamp),
        draw_offer = null,
        updated_at = now()
    where code = v_row.code
    returning * into v_row;
  return public._game_json(v_row, v_color);
end $$;

-- ---------------------------------------------------------------- results (service role only)

drop function if exists public.set_result(text, text, jsonb);
-- p_expected_len: when given, the result is only recorded if the game still
-- has exactly that many actions (a mate verdict for an outdated position is refused).
create or replace function public.set_result(p_code text, p_token text, p_result jsonb, p_expected_len int default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
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
  v_color := public._seat(v_row, p_token);
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
  if v_row.cancelled_at is not null then
    raise exception 'game was cancelled';
  end if;
  if p_expected_len is not null and jsonb_array_length(v_row.actions) <> p_expected_len then
    raise exception 'out of sync: expected index %', jsonb_array_length(v_row.actions);
  end if;
  if v_kind = 'draw-agreed' and v_row.draw_offer is distinct from
       (case when v_color = 'white' then 'black' else 'white' end) then
    raise exception 'no draw offer from your opponent';
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
  update public.games set result = v_result, draw_offer = null, ended_at = now(), updated_at = now()
    where code = v_row.code returning * into v_row;
  return public._game_json(v_row, v_color);
end $$;

-- ---------------------------------------------------------------- draw offers (public)

-- Offer a draw. If the opponent already offered one, this accepts it.
create or replace function public.offer_draw(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_color text;
begin
  select * into v_row from public.games where code = upper(p_code) for update;
  if not found then
    raise exception 'game not found';
  end if;
  v_color := public._seat(v_row, p_token);
  if v_color is null then
    raise exception 'not a player in this game';
  end if;
  if v_row.result->>'kind' <> 'ongoing' then
    raise exception 'game is over';
  end if;
  if v_row.white_token_hash is null or v_row.black_token_hash is null then
    raise exception 'waiting for opponent';
  end if;
  if v_row.draw_offer is not null and v_row.draw_offer <> v_color then
    update public.games
      set result = jsonb_build_object('kind', 'draw-agreed'), draw_offer = null,
          ended_at = now(), updated_at = now()
      where code = v_row.code returning * into v_row;
  elsif v_row.draw_offer is null then
    update public.games set draw_offer = v_color, updated_at = now()
      where code = v_row.code returning * into v_row;
  end if;
  return public._game_json(v_row, v_color);
end $$;

-- Accept or decline the opponent's open draw offer.
create or replace function public.answer_draw(p_code text, p_token text, p_accept boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_color text;
begin
  select * into v_row from public.games where code = upper(p_code) for update;
  if not found then
    raise exception 'game not found';
  end if;
  v_color := public._seat(v_row, p_token);
  if v_color is null then
    raise exception 'not a player in this game';
  end if;
  if v_row.result->>'kind' <> 'ongoing' then
    raise exception 'game is over';
  end if;
  if v_row.draw_offer is distinct from (case when v_color = 'white' then 'black' else 'white' end) then
    raise exception 'no draw offer from your opponent';
  end if;
  if p_accept then
    update public.games
      set result = jsonb_build_object('kind', 'draw-agreed'), draw_offer = null,
          ended_at = now(), updated_at = now()
      where code = v_row.code returning * into v_row;
  else
    update public.games set draw_offer = null, updated_at = now()
      where code = v_row.code returning * into v_row;
  end if;
  return public._game_json(v_row, v_color);
end $$;

-- ---------------------------------------------------------------- cancel (public)

-- The creator abandons a game nobody has joined yet. Idempotent.
create or replace function public.cancel_game(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_color text;
begin
  select * into v_row from public.games where code = upper(p_code) for update;
  if not found then
    raise exception 'game not found';
  end if;
  v_color := public._seat(v_row, p_token);
  if v_color is null then
    raise exception 'not a player in this game';
  end if;
  if v_row.white_token_hash is not null and v_row.black_token_hash is not null then
    raise exception 'opponent already joined';
  end if;
  if v_row.cancelled_at is null then
    update public.games set cancelled_at = now(), ended_at = now(), updated_at = now()
      where code = v_row.code returning * into v_row;
  end if;
  return public._game_json(v_row, v_color);
end $$;

-- ---------------------------------------------------------------- rematch (public)

-- Ask for a rematch of a finished game. When the opponent has already asked,
-- this accepts: a new game with swapped colours (same variant and clock) is
-- created once and its code stored in rematch_code. Idempotent.
create or replace function public.offer_rematch(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_color text;
  v_code text;
begin
  select * into v_row from public.games where code = upper(p_code) for update;
  if not found then
    raise exception 'game not found';
  end if;
  v_color := public._seat(v_row, p_token);
  if v_color is null then
    raise exception 'not a player in this game';
  end if;
  if v_row.rematch_code is not null then
    return public._game_json(v_row, v_color);
  end if;
  if v_row.result->>'kind' = 'ongoing' then
    raise exception 'game is not over';
  end if;
  if v_row.white_token_hash is null or v_row.black_token_hash is null then
    raise exception 'waiting for opponent';
  end if;
  if v_row.rematch_offer is not null and v_row.rematch_offer <> v_color then
    loop
      v_code := public._gen_code();
      begin
        insert into public.games
          (code, variant_id, white_token_hash, black_token_hash, clock, first_player,
           first_active_timelines, started_at)
        values (
          v_code, v_row.variant_id, v_row.black_token_hash, v_row.white_token_hash,
          v_row.clock, v_row.first_player, v_row.first_active_timelines, now());
        exit;
      exception when unique_violation then
        -- collision, try another code
      end;
    end loop;
    update public.games set rematch_code = v_code, rematch_offer = null, updated_at = now()
      where code = v_row.code returning * into v_row;
  elsif v_row.rematch_offer is null then
    update public.games set rematch_offer = v_color, updated_at = now()
      where code = v_row.code returning * into v_row;
  end if;
  return public._game_json(v_row, v_color);
end $$;

-- ---------------------------------------------------------------- privileges

-- Supabase's default privileges grant EXECUTE on new public functions to anon
-- and authenticated explicitly, so revoke from them (not just from PUBLIC).
revoke all on function public.create_game(text, text, text, jsonb, text, int) from public, anon, authenticated;
revoke all on function public.submit_action(text, text, int, jsonb, int) from public, anon, authenticated;
revoke all on function public.set_result(text, text, jsonb, int) from public, anon, authenticated;
grant execute on function public.create_game(text, text, text, jsonb, text, int) to service_role;
grant execute on function public.submit_action(text, text, int, jsonb, int) to service_role;
grant execute on function public.set_result(text, text, jsonb, int) to service_role;

revoke all on function public.join_game(text, text) from public;
revoke all on function public.get_game(text, text) from public;
revoke all on function public.offer_draw(text, text) from public;
revoke all on function public.answer_draw(text, text, boolean) from public;
revoke all on function public.cancel_game(text, text) from public;
revoke all on function public.offer_rematch(text, text) from public;
grant execute on function public.join_game(text, text) to anon, authenticated, service_role;
grant execute on function public.get_game(text, text) to anon, authenticated, service_role;
grant execute on function public.offer_draw(text, text) to anon, authenticated, service_role;
grant execute on function public.answer_draw(text, text, boolean) to anon, authenticated, service_role;
grant execute on function public.cancel_game(text, text) to anon, authenticated, service_role;
grant execute on function public.offer_rematch(text, text) to anon, authenticated, service_role;
