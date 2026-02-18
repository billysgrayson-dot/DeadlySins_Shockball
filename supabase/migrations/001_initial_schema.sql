-- ============================================================
-- Deadly Sins Shockball Analytics - Database Schema
-- Migration: 001_initial_schema
-- ============================================================

-- Enable useful extensions
create extension if not exists "uuid-ossp";

-- ============================================================
-- REFERENCE TABLES
-- ============================================================

create table if not exists teams (
  id           text primary key,  -- Shockball team ID (e.g. cmgbpfhey01c8s12xz26jkbga)
  name         text not null,
  image_url    text,
  venue        text,
  is_deadly_sins boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists competitions (
  id           text primary key,
  name         text not null,
  type         text not null check (type in ('FRIENDLY','DIVISION','CONFERENCE','LEAGUE')),
  status       text,
  start_date   timestamptz,
  season       integer,
  created_at   timestamptz not null default now()
);

create table if not exists conferences (
  id           text primary key,
  name         text not null,
  created_at   timestamptz not null default now()
);

create table if not exists leagues (
  id           text primary key,
  name         text not null,
  created_at   timestamptz not null default now()
);

-- ============================================================
-- MATCHES
-- ============================================================

create table if not exists matches (
  id               text primary key,
  scheduled_time   timestamptz not null,
  status           text not null check (status in ('SCHEDULED','IN_PROGRESS','COMPLETED')),
  home_team_id     text not null references teams(id),
  away_team_id     text not null references teams(id),
  home_score       integer,
  away_score       integer,
  competition_id   text references competitions(id),
  conference_id    text references conferences(id),
  league_id        text references leagues(id),
  sim_version      text,                       -- 'v1' or 'v2'
  involves_deadly_sins boolean not null default false,
  replay_fetched   boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists idx_matches_scheduled_time   on matches(scheduled_time desc);
create index if not exists idx_matches_status           on matches(status);
create index if not exists idx_matches_deadly_sins      on matches(involves_deadly_sins);
create index if not exists idx_matches_home_team        on matches(home_team_id);
create index if not exists idx_matches_away_team        on matches(away_team_id);

-- ============================================================
-- PLAYER MATCH STATS
-- (one row per player per match)
-- ============================================================

create table if not exists player_match_stats (
  id           uuid primary key default uuid_generate_v4(),
  match_id     text not null references matches(id) on delete cascade,
  player_id    text not null,
  player_name  text not null,
  team_id      text not null references teams(id),
  is_home_team boolean not null,
  shots        integer not null default 0,
  goals        integer not null default 0,
  passes       integer not null default 0,
  tackles      integer not null default 0,
  blocks       integer not null default 0,
  fouls        integer not null default 0,
  was_injured  boolean not null default false,
  -- Derived metrics (computed on insert by sync worker)
  shot_conversion_rate  numeric(5,4),   -- goals / shots (null if shots = 0)
  foul_rate             numeric(5,4),   -- fouls / tackles (null if tackles = 0)
  created_at   timestamptz not null default now(),
  unique(match_id, player_id)
);

create index if not exists idx_pms_match_id    on player_match_stats(match_id);
create index if not exists idx_pms_player_id   on player_match_stats(player_id);
create index if not exists idx_pms_team_id     on player_match_stats(team_id);

-- ============================================================
-- MATCH EVENTS
-- (turn-by-turn event log from replay data)
-- ============================================================

create table if not exists match_events (
  id                uuid primary key default uuid_generate_v4(),
  match_id          text not null references matches(id) on delete cascade,
  turn              integer not null,
  type              text not null,   -- GOAL, TACKLE, PASS, FOUL, INJURY, SUBSTITUTION, etc.
  description       text,
  players_involved  text[],          -- array of player IDs
  home_score        integer,
  away_score        integer,
  context           jsonb,           -- full context blob (shot, pass, tackle, injury details)
  created_at        timestamptz not null default now()
);

create index if not exists idx_events_match_id  on match_events(match_id);
create index if not exists idx_events_turn      on match_events(match_id, turn);
create index if not exists idx_events_type      on match_events(type);

-- ============================================================
-- ENERGY SNAPSHOTS
-- (flattened from turnEnergy in TURN_UPDATE events)
-- Critical for energy curve analysis and substitution timing
-- ============================================================

create table if not exists energy_snapshots (
  id          uuid primary key default uuid_generate_v4(),
  match_id    text not null references matches(id) on delete cascade,
  player_id   text not null,
  turn        integer not null,
  energy      integer not null check (energy >= 0 and energy <= 100),
  -- Pre-computed penalty tier for fast querying
  penalty_tier text generated always as (
    case
      when energy >= 30 then 'none'
      when energy >= 10 then 'moderate'
      else 'severe'
    end
  ) stored,
  -- Pre-computed penalty magnitude using exact game formula
  penalty_magnitude numeric(6,2) generated always as (
    case
      when energy >= 30 then 0
      when energy >= 10 then (30 - energy) * 0.5
      else (10 - energy) * 1.5 + 10
    end
  ) stored,
  created_at  timestamptz not null default now(),
  unique(match_id, player_id, turn)
);

create index if not exists idx_energy_match_player on energy_snapshots(match_id, player_id);
create index if not exists idx_energy_player       on energy_snapshots(player_id);
create index if not exists idx_energy_penalty_tier on energy_snapshots(penalty_tier);

-- ============================================================
-- SYNC LOG
-- Tracks API fetch state and conditional request timestamps
-- ============================================================

create table if not exists sync_log (
  id                  uuid primary key default uuid_generate_v4(),
  endpoint            text not null,   -- 'upcoming', 'recent', 'replay:{match_id}'
  fetched_at          timestamptz not null default now(),
  last_modified       text,            -- Last-Modified header value (for If-Modified-Since)
  http_status         integer,         -- 200, 304, etc.
  matches_found       integer default 0,
  matches_new         integer default 0,
  error               text
);

create index if not exists idx_sync_log_endpoint on sync_log(endpoint, fetched_at desc);

-- ============================================================
-- VIEWS — pre-built queries for the dashboard
-- ============================================================

-- Player career aggregates across all matches
create or replace view player_career_stats as
select
  pms.player_id,
  pms.player_name,
  pms.team_id,
  t.name as team_name,
  count(distinct pms.match_id)                          as matches_played,
  sum(pms.goals)                                        as total_goals,
  sum(pms.shots)                                        as total_shots,
  sum(pms.passes)                                       as total_passes,
  sum(pms.tackles)                                      as total_tackles,
  sum(pms.blocks)                                       as total_blocks,
  sum(pms.fouls)                                        as total_fouls,
  sum(case when pms.was_injured then 1 else 0 end)      as injury_count,
  -- Rates
  case when sum(pms.shots) > 0
    then round(sum(pms.goals)::numeric / sum(pms.shots), 4)
    else null end                                        as career_shot_conversion,
  case when sum(pms.tackles) > 0
    then round(sum(pms.fouls)::numeric / sum(pms.tackles), 4)
    else null end                                        as career_foul_rate,
  -- Per-match averages
  round(avg(pms.goals), 2)                              as avg_goals_per_match,
  round(avg(pms.shots), 2)                              as avg_shots_per_match,
  round(avg(pms.passes), 2)                             as avg_passes_per_match,
  round(avg(pms.tackles), 2)                            as avg_tackles_per_match
from player_match_stats pms
join teams t on t.id = pms.team_id
group by pms.player_id, pms.player_name, pms.team_id, t.name;

-- Energy summary per player per match
-- Shows the first turn each energy threshold was crossed
create or replace view player_energy_thresholds as
select
  es.match_id,
  es.player_id,
  min(case when es.energy < 30 then es.turn else null end) as first_turn_below_30,
  min(case when es.energy < 20 then es.turn else null end) as first_turn_below_20,  -- auto-sub trigger
  min(case when es.energy < 10 then es.turn else null end) as first_turn_below_10,
  min(es.energy)                                           as min_energy_reached,
  max(es.turn)                                             as last_turn_tracked,
  -- Average penalty magnitude across the match
  round(avg(es.penalty_magnitude), 2)                      as avg_penalty_magnitude
from energy_snapshots es
group by es.match_id, es.player_id;

-- Deadly Sins upcoming matches enriched
create or replace view upcoming_deadly_sins_matches as
select
  m.id,
  m.scheduled_time,
  m.status,
  ht.name  as home_team_name,
  ht.id    as home_team_id,
  at.name  as away_team_name,
  at.id    as away_team_id,
  c.name   as competition_name,
  c.type   as competition_type,
  case when ht.is_deadly_sins then 'home' else 'away' end as deadly_sins_side
from matches m
join teams ht on ht.id = m.home_team_id
join teams at on at.id = m.away_team_id
left join competitions c on c.id = m.competition_id
where m.involves_deadly_sins = true
  and m.status = 'SCHEDULED'
order by m.scheduled_time asc;

-- ============================================================
-- SEED — insert Deadly Sins as a known team
-- ============================================================

insert into teams (id, name, is_deadly_sins)
values ('cmgbpfhey01c8s12xz26jkbga', 'Deadly Sins', true)
on conflict (id) do update set
  name = excluded.name,
  is_deadly_sins = true;
