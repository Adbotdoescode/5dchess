-- Online play: games table + security-definer RPCs.
-- Reproduces the schema as deployed to project xniodzbzxmcxnbrwhrph
-- (remote migration history: version 20261026221453, name "games_and_rpcs").

create table public.games (
  code text primary key,
  variant_id text not null,
  white_token_hash text,
  black_token_hash text,
  actions jsonb not null default '[]'::jsonb,
  result jsonb not null default '{"kind":"ongoing"}'::jsonb,
  clock jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- No policies: the table is only reachable through the security-definer RPCs below.
alter table public.games enable row level security;
revoke all on public.games from anon, authenticated;

create or replace function public._token_hash(p_token text)
returns text language sql immutable set search_path = '' as $$
  select encode(sha256(convert_to(p_token, 'UTF8')), 'hex')
$$;
revoke all on function public._token_hash(text) from public, anon, authenticated;

create or replace function public._game_json(g public.games, p_color text)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'code', g.code,
    'variantId', g.variant_id,
    'myColor', p_color,
    'actions', g.actions,
    'result', g.result,
    'clock', g.clock,
    'opponentJoined', g.white_token_hash is not null and g.black_token_hash is not null
  )
$$;
revoke all on function public._game_json(public.games, text) from public, anon, authenticated;

create or replace function public.create_game(p_variant text, p_color text, p_token text, p_clock jsonb default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_color text := p_color;
  v_row public.games;
  i int;
begin
  if p_token is null or length(p_token) < 16 or length(p_token) > 128 then
    raise exception 'invalid token';
  end if;
  if p_variant is null or length(p_variant) > 64 then
    raise exception 'invalid variant';
  end if;
  if v_color = 'random' then
    v_color := case when random() < 0.5 then 'white' else 'black' end;
  end if;
  if v_color not in ('white', 'black') then
    raise exception 'invalid color';
  end if;
  loop
    v_code := '';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    begin
      insert into public.games (code, variant_id, white_token_hash, black_token_hash, clock)
      values (
        v_code, p_variant,
        case when v_color = 'white' then public._token_hash(p_token) end,
        case when v_color = 'black' then public._token_hash(p_token) end,
        p_clock
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
    update public.games set white_token_hash = v_hash, updated_at = now() where code = v_row.code returning * into v_row;
    v_color := 'white';
  elsif v_row.black_token_hash is null then
    update public.games set black_token_hash = v_hash, updated_at = now() where code = v_row.code returning * into v_row;
    v_color := 'black';
  else
    raise exception 'game is full';
  end if;
  return public._game_json(v_row, v_color);
end $$;

create or replace function public.get_game(p_code text, p_token text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.games;
  v_hash text := public._token_hash(p_token);
  v_color text;
begin
  select * into v_row from public.games where code = upper(p_code);
  if not found then
    raise exception 'game not found';
  end if;
  v_color := case
    when v_row.white_token_hash = v_hash then 'white'
    when v_row.black_token_hash = v_hash then 'black'
    else 'spectator' end;
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
  if p_index <> v_len then
    raise exception 'out of sync: expected index %', v_len;
  end if;
  if v_len > 0 and v_row.actions->(v_len - 1)->>'player' = v_color then
    raise exception 'not your turn';
  end if;
  update public.games
    set actions = actions || jsonb_build_array(p_action), updated_at = now()
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
  if jsonb_typeof(p_result) <> 'object'
     or p_result->>'kind' not in ('ongoing', 'checkmate', 'stalemate', 'resignation', 'timeout', 'draw-agreed')
     or octet_length(p_result::text) > 1024 then
    raise exception 'invalid result';
  end if;
  if v_row.result->>'kind' <> 'ongoing' then
    return public._game_json(v_row, v_color);
  end if;
  update public.games set result = p_result, updated_at = now()
    where code = v_row.code returning * into v_row;
  return public._game_json(v_row, v_color);
end $$;

revoke all on function public.create_game(text, text, text, jsonb) from public;
revoke all on function public.join_game(text, text) from public;
revoke all on function public.get_game(text, text) from public;
revoke all on function public.submit_action(text, text, int, jsonb) from public;
revoke all on function public.set_result(text, text, jsonb) from public;
grant execute on function public.create_game(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.join_game(text, text) to anon, authenticated;
grant execute on function public.get_game(text, text) to anon, authenticated;
grant execute on function public.submit_action(text, text, int, jsonb) to anon, authenticated;
grant execute on function public.set_result(text, text, jsonb) to anon, authenticated;
