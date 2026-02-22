/**
 * Pre-Match Energy Dashboard
 *
 * Server Component. Shows energy status, lineup recommendations,
 * form indicators, substitution timing advisor, upcoming matches,
 * and recent results.
 */

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const DS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'

// ============================================================
// Types
// ============================================================

interface PlayerStat {
  player_id: string
  player_name: string
  team_id: string
  matches_played: number
  total_goals: number | null
  total_shots: number | null
  total_tackles: number | null
  career_shot_conversion: number | null
}

interface EnergySnap {
  player_id: string
  match_id: string
  match_date: string
  turn: number
  energy: number
  penalty_tier: string
}

interface UpcomingMatch {
  id: string
  scheduled_time: string
  home_team_name: string
  home_team_id: string
  away_team_name: string
  away_team_id: string
  competition_name: string | null
  deadly_sins_side: 'home' | 'away'
}

interface RecentMatch {
  id: string
  scheduled_time: string
  home_team_id: string
  away_team_id: string
  home_score: number | null
  away_score: number | null
}

type FormResult = 'W' | 'L' | 'D'

// ============================================================
// Data fetching
// ============================================================

async function getDashboardData() {
  const db = createServerClient()

  const [playersResult, dsMatchesResult, upcomingResult, recentMatchesResult, lastSyncResult] =
    await Promise.all([
      db
        .from('player_career_stats')
        .select('player_id, player_name, team_id, matches_played, total_goals, total_shots, total_tackles, career_shot_conversion')
        .eq('team_id', DS_TEAM_ID),
      db
        .from('matches')
        .select('id, scheduled_time')
        .eq('involves_deadly_sins', true)
        .eq('replay_fetched', true)
        .order('scheduled_time', { ascending: false })
        .limit(5),
      db.from('upcoming_deadly_sins_matches').select('*').limit(10),
      db
        .from('matches')
        .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score')
        .eq('involves_deadly_sins', true)
        .eq('status', 'COMPLETED')
        .order('scheduled_time', { ascending: false })
        .limit(10),
      db
        .from('sync_log')
        .select('fetched_at')
        .eq('http_status', 200)
        .order('fetched_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ])

  const players: PlayerStat[] = playersResult.data ?? []
  const dsMatches = dsMatchesResult.data ?? []
  const upcomingMatches: UpcomingMatch[] = (upcomingResult.data ?? []) as UpcomingMatch[]
  const recentMatches: RecentMatch[] = recentMatchesResult.data ?? []
  const lastSyncAt: string | null = lastSyncResult.data?.fetched_at ?? null

  // Team names for recent match display
  const allTeamIds = new Set<string>()
  for (const m of recentMatches) {
    allTeamIds.add(m.home_team_id)
    allTeamIds.add(m.away_team_id)
  }
  const { data: teamsData } = await db.from('teams').select('id, name').in('id', [...allTeamIds])
  const teamNames: Record<string, string> = Object.fromEntries(
    (teamsData ?? []).map((t) => [t.id, t.name])
  )

  // Energy across last 5 replayed DS matches (parallel fetch)
  const energyByPlayer: Record<string, EnergySnap> = {}
  if (dsMatches.length > 0) {
    const snapshotResults = await Promise.all(
      dsMatches.map((m) =>
        db.from('energy_snapshots')
          .select('player_id, turn, energy, penalty_tier')
          .eq('match_id', m.id)
          .order('player_id')
          .order('turn', { ascending: false })
      )
    )
    for (let i = 0; i < dsMatches.length; i++) {
      const match = dsMatches[i]
      const snapshots = snapshotResults[i].data ?? []
      const seenInMatch = new Set<string>()
      for (const snap of snapshots) {
        if (!seenInMatch.has(snap.player_id)) {
          seenInMatch.add(snap.player_id)
          if (!energyByPlayer[snap.player_id]) {
            energyByPlayer[snap.player_id] = {
              player_id: snap.player_id,
              match_id: match.id,
              match_date: match.scheduled_time,
              turn: snap.turn,
              energy: snap.energy,
              penalty_tier: snap.penalty_tier,
            }
          }
        }
      }
    }
  }

  // Streak from most recent matches
  let streak = 0
  let streakType: FormResult | null = null
  for (const m of recentMatches) {
    const isHome = m.home_team_id === DS_TEAM_ID
    const ds = isHome ? m.home_score : m.away_score
    const opp = isHome ? m.away_score : m.home_score
    if (ds === null || opp === null) break
    const result: FormResult = ds > opp ? 'W' : ds < opp ? 'L' : 'D'
    if (streakType === null) { streakType = result; streak = 1 }
    else if (result === streakType) { streak++ }
    else break
  }

  // Per-player form from last 5 completed DS matches
  const last5MatchIds = recentMatches.slice(0, 5).map(m => m.id)
  const matchResultMap: Record<string, FormResult> = {}
  for (const m of recentMatches.slice(0, 5)) {
    const isHome = m.home_team_id === DS_TEAM_ID
    const ds = isHome ? m.home_score : m.away_score
    const opp = isHome ? m.away_score : m.home_score
    if (ds !== null && opp !== null) {
      matchResultMap[m.id] = ds > opp ? 'W' : ds < opp ? 'L' : 'D'
    }
  }

  const playerForm: Record<string, FormResult[]> = {}
  if (last5MatchIds.length > 0) {
    const { data: recentStatsData } = await db
      .from('player_match_stats')
      .select('player_id, match_id')
      .in('match_id', last5MatchIds)
      .eq('team_id', DS_TEAM_ID)
    // Order by match date: last5MatchIds is newest-first, we want newest-first in form
    const statsByMatch: Record<string, string[]> = {}
    for (const s of recentStatsData ?? []) {
      if (!statsByMatch[s.match_id]) statsByMatch[s.match_id] = []
      statsByMatch[s.match_id].push(s.player_id)
    }
    for (const matchId of last5MatchIds) {
      const result = matchResultMap[matchId]
      if (!result) continue
      for (const pid of statsByMatch[matchId] ?? []) {
        if (!playerForm[pid]) playerForm[pid] = []
        playerForm[pid].push(result)
      }
    }
  }

  // Substitution timing advisor: avg first_turn_below_30 per player
  const playerIds = players.map(p => p.player_id)
  const subTimingMap: Record<string, number | null> = {}
  if (playerIds.length > 0) {
    const { data: threshData } = await db
      .from('player_energy_thresholds')
      .select('player_id, first_turn_below_30')
      .in('player_id', playerIds)
    const threshByPlayer: Record<string, number[]> = {}
    for (const t of threshData ?? []) {
      if (t.first_turn_below_30 !== null) {
        if (!threshByPlayer[t.player_id]) threshByPlayer[t.player_id] = []
        threshByPlayer[t.player_id].push(t.first_turn_below_30)
      }
    }
    for (const pid of playerIds) {
      const vals = threshByPlayer[pid] ?? []
      subTimingMap[pid] = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : null
    }
  }

  const latestMatch = dsMatches[0] ?? null
  return {
    players, latestMatch, energyByPlayer, upcomingMatches,
    recentMatches: recentMatches.slice(0, 5), teamNames,
    lastSyncAt, streak, streakType, playerForm, subTimingMap,
  }
}

// ============================================================
// Helpers
// ============================================================

function daysSince(dateStr: string): number {
  return (Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24)
}

function timeAgo(dateStr: string): string {
  const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

type Recommendation = 'START' | 'MONITOR' | 'REST' | 'UNKNOWN'

function getRecommendation(energy: number | null, daysSinceMatch: number): { label: Recommendation; color: string; bg: string } {
  if (energy === null) return { label: 'UNKNOWN', color: 'text-gray-400', bg: 'bg-gray-800' }
  const effective = daysSinceMatch >= 3 ? 100 : energy
  if (effective >= 60) return { label: 'START', color: 'text-emerald-400', bg: 'bg-emerald-950' }
  if (effective >= 30) return { label: 'MONITOR', color: 'text-yellow-400', bg: 'bg-yellow-950' }
  return { label: 'REST', color: 'text-red-400', bg: 'bg-red-950' }
}

function getEnergyColor(e: number | null): string {
  if (e === null) return 'bg-gray-700'
  if (e >= 60) return 'bg-emerald-500'
  if (e >= 30) return 'bg-yellow-500'
  if (e >= 10) return 'bg-orange-500'
  return 'bg-red-600'
}

function getEnergyTextColor(e: number | null): string {
  if (e === null) return 'text-gray-600'
  if (e >= 60) return 'text-emerald-500'
  if (e >= 30) return 'text-yellow-500'
  if (e >= 10) return 'text-orange-500'
  return 'text-red-600'
}

function getEnergyLabel(e: number | null): string {
  if (e === null) return '—'
  if (e >= 60) return 'High'
  if (e >= 30) return 'Medium'
  if (e >= 10) return 'Low'
  return 'Critical'
}

// ============================================================
// Sub-components
// ============================================================

function FormDots({ results }: { results: FormResult[] }) {
  if (results.length === 0) return null
  return (
    <div className="flex items-center gap-0.5">
      {results.map((r, i) => (
        <span
          key={i}
          className={`inline-block h-2 w-2 rounded-full ${
            r === 'W' ? 'bg-emerald-500' : r === 'L' ? 'bg-red-500' : 'bg-yellow-500'
          }`}
          title={r}
        />
      ))}
    </div>
  )
}

function EnergyBar({ energy }: { energy: number | null }) {
  const pct = energy ?? 0
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-800">
      <div
        className={`h-1.5 rounded-full transition-all ${getEnergyColor(energy)}`}
        style={{ width: energy !== null ? `${pct}%` : '0%' }}
      />
    </div>
  )
}

function PlayerCard({ player, snap, form, avgSubTurn }: {
  player: PlayerStat
  snap: EnergySnap | null
  form: FormResult[]
  avgSubTurn: number | null
}) {
  const energy = snap?.energy ?? null
  const days = snap ? daysSince(snap.match_date) : Infinity
  const rec = getRecommendation(energy, days)
  const avgGoals = player.total_goals !== null && player.matches_played > 0
    ? (player.total_goals / player.matches_played).toFixed(2) : '—'

  return (
    <Link href={`/players/${player.player_id}`} className="block">
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 flex flex-col gap-3 hover:border-gray-600 transition-colors">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-white leading-tight">{player.player_name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs text-gray-500">{player.matches_played} GP</p>
              <FormDots results={form} />
            </div>
          </div>
          <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold tracking-wide ${rec.color} ${rec.bg}`}>
            {rec.label}
          </span>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-400">
              {snap ? `Last energy (${Math.floor(days)}d ago)` : 'Last energy'}
            </span>
            <span className={getEnergyTextColor(energy)}>
              {energy !== null ? `${energy} — ${getEnergyLabel(energy)}` : 'No data'}
            </span>
          </div>
          <EnergyBar energy={energy} />
        </div>

        {avgSubTurn !== null && (
          <p className="text-xs text-gray-600">
            Avg fades ~turn <span className="text-gray-400">{Math.round(avgSubTurn)}</span>
          </p>
        )}

        <div className="grid grid-cols-3 gap-1 text-center">
          <div>
            <p className="text-xs text-gray-500">Goals</p>
            <p className="text-sm font-medium text-gray-200">{player.total_goals ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Shots</p>
            <p className="text-sm font-medium text-gray-200">{player.total_shots ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">G/GP</p>
            <p className="text-sm font-medium text-gray-200">{avgGoals}</p>
          </div>
        </div>
      </div>
    </Link>
  )
}

function MatchResult({ match, teamNames }: { match: RecentMatch; teamNames: Record<string, string> }) {
  const isHome = match.home_team_id === DS_TEAM_ID
  const dsScore = isHome ? match.home_score : match.away_score
  const oppScore = isHome ? match.away_score : match.home_score
  const oppId = isHome ? match.away_team_id : match.home_team_id
  const oppName = teamNames[oppId] ?? 'Unknown'

  let resultColor = 'text-gray-400'; let resultLabel = '—'
  if (dsScore !== null && oppScore !== null) {
    if (dsScore > oppScore) { resultColor = 'text-emerald-400'; resultLabel = 'W' }
    else if (dsScore < oppScore) { resultColor = 'text-red-400'; resultLabel = 'L' }
    else { resultColor = 'text-yellow-400'; resultLabel = 'D' }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 hover:border-gray-600 transition-colors">
      <Link href={`/matches/${match.id}`} className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-200">{isHome ? 'vs ' : '@ '}{oppName}</p>
        <p className="text-xs text-gray-500 mt-0.5">{formatDateShort(match.scheduled_time)}</p>
      </Link>
      <div className="flex items-center gap-3">
        <Link
          href={`/scouting/${oppId}`}
          className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
        >
          Scout →
        </Link>
        <Link href={`/matches/${match.id}`} className="text-right">
          <span className={`text-lg font-bold ${resultColor}`}>{resultLabel}</span>
          {dsScore !== null && oppScore !== null && (
            <p className="text-xs text-gray-400">
              {isHome ? `${dsScore} – ${oppScore}` : `${oppScore} – ${dsScore}`}
            </p>
          )}
        </Link>
      </div>
    </div>
  )
}

// ============================================================
// Page
// ============================================================

export default async function DashboardPage() {
  const {
    players, latestMatch, energyByPlayer, upcomingMatches, recentMatches, teamNames,
    lastSyncAt, streak, streakType, playerForm, subTimingMap,
  } = await getDashboardData()

  const days = latestMatch ? daysSince(latestMatch.scheduled_time) : Infinity

  const withRec = players.map((p) => {
    const snap = energyByPlayer[p.player_id] ?? null
    const playerDays = snap ? daysSince(snap.match_date) : Infinity
    const rec = getRecommendation(snap?.energy ?? null, playerDays)
    return { player: p, snap, rec }
  })

  const starters = withRec.filter(x => x.rec.label === 'START')
  const monitors = withRec.filter(x => x.rec.label === 'MONITOR')
  const resting  = withRec.filter(x => x.rec.label === 'REST')
  const unknown  = withRec.filter(x => x.rec.label === 'UNKNOWN')

  // Sub timing advisor: players who fade early (avg < 25 turns)
  const earlyFaders = players
    .filter(p => (subTimingMap[p.player_id] ?? Infinity) < 25)
    .sort((a, b) => (subTimingMap[a.player_id] ?? 99) - (subTimingMap[b.player_id] ?? 99))

  const streakColor = streakType === 'W' ? 'text-emerald-400' : streakType === 'L' ? 'text-red-400' : 'text-yellow-400'

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Deadly Sins
            <span className="ml-2 text-base font-normal text-gray-500">Coaching Dashboard</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-gray-500">
            <span>
              Latest match:{' '}
              <span className="text-gray-400">
                {latestMatch ? formatDate(latestMatch.scheduled_time) : 'None'}
              </span>
              {days < Infinity && (
                <span className="ml-1 text-gray-600">
                  ({Math.floor(days)}d ago{days >= 3 ? ' — recovered' : ''})
                </span>
              )}
            </span>
            {streak > 0 && streakType && (
              <span className={`font-medium ${streakColor}`}>
                {streak}{streakType} streak
              </span>
            )}
            {lastSyncAt && (
              <span className="text-gray-600 text-xs">
                Synced {timeAgo(lastSyncAt)}
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-gray-600">
            Energy from last 5 replayed matches · Form dots = last 5 results (newest first) ·{' '}
            <Link href="/admin" className="hover:text-gray-400 transition-colors">Admin →</Link>
          </p>
        </div>

        <div className="flex flex-wrap gap-2 text-sm">
          <span className="rounded-full bg-emerald-950 px-3 py-1 text-emerald-400 font-medium">{starters.length} Start</span>
          <span className="rounded-full bg-yellow-950 px-3 py-1 text-yellow-400 font-medium">{monitors.length} Monitor</span>
          <span className="rounded-full bg-red-950 px-3 py-1 text-red-400 font-medium">{resting.length} Rest</span>
          {unknown.length > 0 && (
            <span className="rounded-full bg-gray-800 px-3 py-1 text-gray-400 font-medium">{unknown.length} Unknown</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left: roster */}
        <div className="lg:col-span-2 space-y-8">
          {/* Substitution timing advisor */}
          {earlyFaders.length > 0 && (
            <section className="rounded-lg border border-yellow-900 bg-yellow-950/30 p-4">
              <h2 className="mb-2 text-sm font-semibold text-yellow-400">⚠ Sub Timing Advisor</h2>
              <p className="text-xs text-yellow-700 mb-3">
                These players historically drop below 30 energy before turn 25 — consider early substitution.
              </p>
              <div className="flex flex-wrap gap-2">
                {earlyFaders.map(p => (
                  <Link key={p.player_id} href={`/players/${p.player_id}`}
                    className="rounded bg-yellow-900/50 px-2.5 py-1 text-xs font-medium text-yellow-300 hover:bg-yellow-900 transition-colors">
                    {p.player_name} (turn ~{Math.round(subTimingMap[p.player_id]!)})
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Lineup Recommendation</h2>
            <div className="grid gap-6">
              {starters.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-400">
                    <span className="h-px flex-1 bg-emerald-950" />Recommended Starters ({starters.length})<span className="h-px flex-1 bg-emerald-950" />
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {starters.map(({ player, snap }) => (
                      <PlayerCard key={player.player_id} player={player} snap={snap}
                        form={playerForm[player.player_id] ?? []}
                        avgSubTurn={subTimingMap[player.player_id] ?? null} />
                    ))}
                  </div>
                </div>
              )}
              {monitors.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-yellow-400">
                    <span className="h-px flex-1 bg-yellow-950" />Monitor Closely ({monitors.length})<span className="h-px flex-1 bg-yellow-950" />
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {monitors.map(({ player, snap }) => (
                      <PlayerCard key={player.player_id} player={player} snap={snap}
                        form={playerForm[player.player_id] ?? []}
                        avgSubTurn={subTimingMap[player.player_id] ?? null} />
                    ))}
                  </div>
                </div>
              )}
              {resting.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-red-400">
                    <span className="h-px flex-1 bg-red-950" />Needs Rest ({resting.length})<span className="h-px flex-1 bg-red-950" />
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {resting.map(({ player, snap }) => (
                      <PlayerCard key={player.player_id} player={player} snap={snap}
                        form={playerForm[player.player_id] ?? []}
                        avgSubTurn={subTimingMap[player.player_id] ?? null} />
                    ))}
                  </div>
                </div>
              )}
              {unknown.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-500">
                    <span className="h-px flex-1 bg-gray-800" />No Energy Data ({unknown.length})<span className="h-px flex-1 bg-gray-800" />
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {unknown.map(({ player, snap }) => (
                      <PlayerCard key={player.player_id} player={player} snap={snap}
                        form={playerForm[player.player_id] ?? []}
                        avgSubTurn={subTimingMap[player.player_id] ?? null} />
                    ))}
                  </div>
                </div>
              )}
              {players.length === 0 && (
                <p className="text-sm text-gray-600 italic">
                  No player data. Run <code className="font-mono text-gray-400">npm run sync:manual</code> to populate.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* Right sidebar */}
        <div className="space-y-8">
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Upcoming Matches</h2>
            {upcomingMatches.length === 0 ? (
              <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-6 text-center">
                <p className="text-sm text-gray-500">No matches currently scheduled.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingMatches.map((m) => (
                  <div key={m.id} className="rounded-lg border border-gray-800 bg-gray-900 p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        {m.deadly_sins_side === 'home' ? 'Home' : 'Away'}
                      </span>
                      {m.competition_name && <span className="text-xs text-gray-600">{m.competition_name}</span>}
                    </div>
                    <p className="text-sm font-semibold text-white">
                      {m.deadly_sins_side === 'home'
                        ? `Deadly Sins vs ${m.away_team_name}`
                        : `${m.home_team_name} vs Deadly Sins`}
                    </p>
                    <div className="mt-1 flex items-center justify-between">
                      <p className="text-xs text-gray-400">{formatDate(m.scheduled_time)}</p>
                      <Link
                        href={`/scouting/${m.deadly_sins_side === 'home' ? m.away_team_id : m.home_team_id}`}
                        className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
                      >
                        Scout →
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Recent Results</h2>
            {recentMatches.length === 0 ? (
              <p className="text-sm text-gray-600 italic">No completed matches yet.</p>
            ) : (
              <div className="space-y-2">
                {recentMatches.map((m) => (
                  <MatchResult key={m.id} match={m} teamNames={teamNames} />
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-500">Energy Tiers</h2>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-2 text-xs text-gray-400">
              <div className="flex items-center gap-2"><span className="h-2 w-8 rounded-full bg-emerald-500" /><span>60–100 — No penalty</span></div>
              <div className="flex items-center gap-2"><span className="h-2 w-8 rounded-full bg-yellow-500" /><span>30–59 — Moderate penalty</span></div>
              <div className="flex items-center gap-2"><span className="h-2 w-8 rounded-full bg-orange-500" /><span>10–29 — Severe penalty</span></div>
              <div className="flex items-center gap-2"><span className="h-2 w-8 rounded-full bg-red-600" /><span>0–9 — Auto-sub risk</span></div>
              <p className="pt-1 text-gray-600 leading-snug">Recovery: fully recovered after 3 days rest.</p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
