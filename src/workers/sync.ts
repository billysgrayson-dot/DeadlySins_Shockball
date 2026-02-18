/**
 * Sync Worker
 *
 * Responsible for keeping Supabase up to date with the Shockball API.
 *
 * Strategy:
 * 1. Poll /matches/upcoming and /matches/recent every 15 min using
 *    If-Modified-Since — free 304s most of the time.
 * 2. When a completed match involving Deadly Sins appears, fetch its
 *    replay data ONCE and persist everything (stats + energy snapshots).
 * 3. Opponents' matches are also stored for scouting purposes.
 *
 * Rate limit budget: ~100 req/hour
 * - Polling (upstream + recent): ~2-4 req/hour (mostly 304s)
 * - Replay fetches: 1 req per new completed match
 * - Plenty of headroom for manual refreshes
 */

import {
  getUpcomingMatches,
  getRecentMatches,
  getMatchReplay,
  filterDeadlySinsMatches,
  DEADLY_SINS_TEAM_ID,
} from '@/lib/shockball/client'
import { createServerClient } from '@/lib/supabase/client'
import type { ApiMatch, ApiReplayData, ApiGameEvent } from '@/types'

// ============================================================
// Upsert helpers
// ============================================================

async function upsertTeam(
  db: ReturnType<typeof createServerClient>,
  team: { id: string; name: string; imageUrl?: string; venue?: string }
) {
  await db.from('teams').upsert(
    {
      id: team.id,
      name: team.name,
      image_url: team.imageUrl ?? null,
      venue: team.venue ?? null,
      is_deadly_sins: team.id === DEADLY_SINS_TEAM_ID,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id', ignoreDuplicates: false }
  )
}

async function upsertMatch(
  db: ReturnType<typeof createServerClient>,
  match: ApiMatch
) {
  const involvesDeadlySins =
    match.homeTeam.id === DEADLY_SINS_TEAM_ID ||
    match.awayTeam.id === DEADLY_SINS_TEAM_ID

  // Upsert teams first (FK constraint)
  await upsertTeam(db, match.homeTeam)
  await upsertTeam(db, match.awayTeam)

  // Upsert competition, conference, league if present
  if (match.competition) {
    const { error: compError } = await db.from('competitions').upsert(
      {
        id: match.competition.id,
        name: match.competition.name,
        type: match.competition.type,
        status: match.competition.status ?? null,
        start_date: match.competition.startDate ?? null,
        season: match.competition.season ?? null,
      },
      { onConflict: 'id', ignoreDuplicates: false }
    )
    if (compError) console.error(`[sync] Failed to upsert competition ${match.competition.id}:`, compError)
  }

  if (match.conference) {
    const { error: confError } = await db.from('conferences').upsert(
      { id: match.conference.id, name: match.conference.name },
      { onConflict: 'id', ignoreDuplicates: false }
    )
    if (confError) console.error(`[sync] Failed to upsert conference ${match.conference.id}:`, confError)
  }

  if (match.league) {
    const { error: leagueError } = await db.from('leagues').upsert(
      { id: match.league.id, name: match.league.name },
      { onConflict: 'id', ignoreDuplicates: false }
    )
    if (leagueError) console.error(`[sync] Failed to upsert league ${match.league.id}:`, leagueError)
  }

  const { error } = await db.from('matches').upsert(
    {
      id: match.id,
      scheduled_time: match.scheduledTime,
      status: match.status,
      home_team_id: match.homeTeam.id,
      away_team_id: match.awayTeam.id,
      home_score: match.homeScore ?? null,
      away_score: match.awayScore ?? null,
      competition_id: match.competition?.id ?? null,
      conference_id: match.conference?.id ?? null,
      league_id: match.league?.id ?? null,
      involves_deadly_sins: involvesDeadlySins,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id', ignoreDuplicates: false }
  )

  if (error) console.error(`[sync] Failed to upsert match ${match.id}:`, error)
  return involvesDeadlySins
}

// ============================================================
// Energy snapshot extraction
// ============================================================

function extractEnergySnapshots(
  matchId: string,
  events: ApiGameEvent[]
): Array<{ match_id: string; player_id: string; turn: number; energy: number }> {
  const snapshots: Array<{ match_id: string; player_id: string; turn: number; energy: number }> = []

  for (const event of events) {
    // MATCH_START has initialEnergy
    if (event.context?.initialEnergy) {
      for (const [playerId, energy] of Object.entries(event.context.initialEnergy)) {
        snapshots.push({ match_id: matchId, player_id: playerId, turn: 0, energy })
      }
    }

    // TURN_UPDATE has turnEnergy
    if (event.context?.turnEnergy) {
      for (const [playerId, energy] of Object.entries(event.context.turnEnergy)) {
        snapshots.push({ match_id: matchId, player_id: playerId, turn: event.turn, energy })
      }
    }
  }

  return snapshots
}

// ============================================================
// Persist full replay data
// ============================================================

async function persistReplayData(
  db: ReturnType<typeof createServerClient>,
  matchId: string,
  replay: ApiReplayData
) {
  const { data } = replay

  // Update match with sim version
  await db.from('matches').update({
    sim_version: data.match.simVersion,
    home_score: data.match.homeScore,
    away_score: data.match.awayScore,
    status: 'COMPLETED',
    replay_fetched: true,
    updated_at: new Date().toISOString(),
  }).eq('id', matchId)

  // Insert player stats (home team)
  const homeStats = data.playerStats.home.map(p => ({
    match_id: matchId,
    player_id: p.playerId,
    player_name: p.playerName,
    team_id: data.match.homeTeam.id,
    is_home_team: true,
    shots: p.shots,
    goals: p.goals,
    passes: p.passes,
    tackles: p.tackles,
    blocks: p.blocks,
    fouls: p.fouls,
    was_injured: p.wasInjured,
    shot_conversion_rate: p.shots > 0 ? p.goals / p.shots : null,
    foul_rate: p.tackles > 0 ? p.fouls / p.tackles : null,
  }))

  // Insert player stats (away team)
  const awayStats = data.playerStats.away.map(p => ({
    match_id: matchId,
    player_id: p.playerId,
    player_name: p.playerName,
    team_id: data.match.awayTeam.id,
    is_home_team: false,
    shots: p.shots,
    goals: p.goals,
    passes: p.passes,
    tackles: p.tackles,
    blocks: p.blocks,
    fouls: p.fouls,
    was_injured: p.wasInjured,
    shot_conversion_rate: p.shots > 0 ? p.goals / p.shots : null,
    foul_rate: p.tackles > 0 ? p.fouls / p.tackles : null,
  }))

  const { error: statsError } = await db
    .from('player_match_stats')
    .upsert([...homeStats, ...awayStats], { onConflict: 'match_id,player_id' })

  if (statsError) console.error(`[sync] Failed to insert player stats for ${matchId}:`, statsError)

  // Insert match events
  const events = data.events.map(e => ({
    match_id: matchId,
    turn: e.turn,
    type: e.type,
    description: e.description,
    players_involved: e.playersInvolved,
    home_score: e.homeScore,
    away_score: e.awayScore,
    context: e.context ?? null,
  }))

  // Insert in batches of 500 to avoid payload limits
  for (let i = 0; i < events.length; i += 500) {
    const batch = events.slice(i, i + 500)
    const { error } = await db.from('match_events').upsert(batch, {
      onConflict: 'match_id,turn,type',  // best-effort dedup
      ignoreDuplicates: true,
    })
    if (error) console.error(`[sync] Event batch ${i} error for ${matchId}:`, error)
  }

  // Extract and insert energy snapshots
  const snapshots = extractEnergySnapshots(matchId, data.events)
  if (snapshots.length > 0) {
    for (let i = 0; i < snapshots.length; i += 500) {
      const batch = snapshots.slice(i, i + 500)
      const { error } = await db.from('energy_snapshots').upsert(batch, {
        onConflict: 'match_id,player_id,turn',
        ignoreDuplicates: true,
      })
      if (error) console.error(`[sync] Energy snapshot batch ${i} error for ${matchId}:`, error)
    }
    console.log(`[sync] Inserted ${snapshots.length} energy snapshots for match ${matchId}`)
  }
}

// ============================================================
// Log sync result
// ============================================================

async function logSync(
  db: ReturnType<typeof createServerClient>,
  endpoint: string,
  result: {
    httpStatus: number
    lastModified?: string | null
    matchesFound?: number
    matchesNew?: number
    error?: string
  }
) {
  await db.from('sync_log').insert({
    endpoint,
    http_status: result.httpStatus,
    last_modified: result.lastModified ?? null,
    matches_found: result.matchesFound ?? 0,
    matches_new: result.matchesNew ?? 0,
    error: result.error ?? null,
  })
}

// ============================================================
// Main sync functions
// ============================================================

/**
 * Sync upcoming and recent matches.
 * Called every 15 minutes by Vercel cron.
 */
export async function syncMatches() {
  const db = createServerClient()
  const results = { upcoming: 0, recent: 0, replaysQueued: 0, errors: 0 }

  // Get last known Last-Modified values to send as If-Modified-Since
  const { data: lastSyncs } = await db
    .from('sync_log')
    .select('endpoint, last_modified')
    .in('endpoint', ['upcoming', 'recent'])
    .eq('http_status', 200)
    .order('fetched_at', { ascending: false })
    .limit(2)

  const lastModifiedMap: Record<string, string | null> = {}
  for (const row of lastSyncs ?? []) {
    if (row.endpoint && !lastModifiedMap[row.endpoint]) {
      lastModifiedMap[row.endpoint] = row.last_modified
    }
  }

  // ---- Upcoming matches ----
  try {
    const { matches, lastModified, notModified } = await getUpcomingMatches({
      ifModifiedSince: lastModifiedMap['upcoming'] ?? undefined,
    })

    await logSync(db, 'upcoming', {
      httpStatus: notModified ? 304 : 200,
      lastModified,
      matchesFound: matches.length,
    })

    if (!notModified) {
      const dsMatches = filterDeadlySinsMatches(matches)
      for (const match of dsMatches) {
        await upsertMatch(db, match)
        results.upcoming++
      }
    }
  } catch (err) {
    console.error('[sync] Upcoming fetch error:', err)
    await logSync(db, 'upcoming', { httpStatus: 0, error: String(err) })
    results.errors++
  }

  // ---- Recent matches ----
  try {
    const { matches, lastModified, notModified } = await getRecentMatches({
      ifModifiedSince: lastModifiedMap['recent'] ?? undefined,
    })

    await logSync(db, 'recent', {
      httpStatus: notModified ? 304 : 200,
      lastModified,
      matchesFound: matches.length,
    })

    if (!notModified) {
      // Upsert all matches (needed for scouting — we want opponent data too)
      for (const match of matches) {
        await upsertMatch(db, match)
      }

      // Queue replay fetches for completed DS matches without replay data
      const dsMatches = filterDeadlySinsMatches(matches).filter(
        m => m.status === 'COMPLETED'
      )

      for (const match of dsMatches) {
        const { data: existing } = await db
          .from('matches')
          .select('replay_fetched')
          .eq('id', match.id)
          .single()

        if (!existing?.replay_fetched) {
          results.replaysQueued++
          await syncMatchReplay(match.id)
        }
      }

      results.recent += matches.length
    }
  } catch (err) {
    console.error('[sync] Recent fetch error:', err)
    await logSync(db, 'recent', { httpStatus: 0, error: String(err) })
    results.errors++
  }

  return results
}

/**
 * Fetch and persist replay data for a single match.
 * Safe to call multiple times — idempotent via upsert.
 */
export async function syncMatchReplay(matchId: string) {
  const db = createServerClient()

  // Get last modified from sync log (completed match data is immutable,
  // so after first fetch this will always return 304 for free)
  const { data: lastSync } = await db
    .from('sync_log')
    .select('last_modified')
    .eq('endpoint', `replay:${matchId}`)
    .eq('http_status', 200)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  try {
    const { data, notModified, lastModified } = await getMatchReplay(
      matchId,
      lastSync?.last_modified ?? undefined
    )

    await logSync(db, `replay:${matchId}`, {
      httpStatus: notModified ? 304 : 200,
      lastModified,
      matchesFound: 1,
      matchesNew: notModified ? 0 : 1,
    })

    if (!notModified && data) {
      await persistReplayData(db, matchId, data)
      console.log(`[sync] Replay data persisted for match ${matchId}`)
    }

    return { success: true, notModified }
  } catch (err) {
    console.error(`[sync] Replay fetch error for ${matchId}:`, err)
    await logSync(db, `replay:${matchId}`, { httpStatus: 0, error: String(err) })
    return { success: false, notModified: false }
  }
}
