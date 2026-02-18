/**
 * Pre-Match Energy Dashboard
 *
 * Server Component — fetches directly from Supabase on every request.
 * Shows current energy status for all Deadly Sins players, lineup
 * recommendations based on last known energy + recovery estimate,
 * and upcoming matches.
 *
 * Energy recovery model:
 *   Players need ~3 days of rest to fully recover from a low-energy match.
 *   If the last match was 3+ days ago, we treat all players as recovered.
 */

import { createServerClient } from '@/lib/supabase/client'

// Always server-render — data changes with every sync
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
  turn: number
  energy: number
  penalty_tier: string
}

interface UpcomingMatch {
  id: string
  scheduled_time: string
  status: string
  home_team_name: string
  home_team_id: string
  away_team_name: string
  away_team_id: string
  competition_name: string | null
  competition_type: string | null
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

// ============================================================
// Data fetching
// ============================================================

async function getDashboardData() {
  const db = createServerClient()

  const [playersResult, latestMatchResult, upcomingResult, recentMatchesResult] =
    await Promise.all([
      db
        .from('player_career_stats')
        .select(
          'player_id, player_name, team_id, matches_played, total_goals, total_shots, total_tackles, career_shot_conversion'
        )
        .eq('team_id', DS_TEAM_ID),
      db
        .from('matches')
        .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score')
        .eq('involves_deadly_sins', true)
        .eq('replay_fetched', true)
        .order('scheduled_time', { ascending: false })
        .limit(1)
        .maybeSingle(),
      db.from('upcoming_deadly_sins_matches').select('*').limit(10),
      db
        .from('matches')
        .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score')
        .eq('involves_deadly_sins', true)
        .eq('status', 'COMPLETED')
        .order('scheduled_time', { ascending: false })
        .limit(5),
    ])

  const players: PlayerStat[] = playersResult.data ?? []
  const latestMatch = latestMatchResult.data
  const upcomingMatches: UpcomingMatch[] = (upcomingResult.data ?? []) as UpcomingMatch[]
  const recentMatches: RecentMatch[] = recentMatchesResult.data ?? []

  // Get teams for recent match display
  const allTeamIds = new Set<string>()
  for (const m of recentMatches) {
    allTeamIds.add(m.home_team_id)
    allTeamIds.add(m.away_team_id)
  }
  const { data: teamsData } = await db
    .from('teams')
    .select('id, name')
    .in('id', [...allTeamIds])
  const teamNames: Record<string, string> = Object.fromEntries(
    (teamsData ?? []).map((t) => [t.id, t.name])
  )

  // Get final energy per player from the latest replay-fetched match
  let energyByPlayer: Record<string, EnergySnap> = {}
  if (latestMatch) {
    const { data: snapshots } = await db
      .from('energy_snapshots')
      .select('player_id, turn, energy, penalty_tier')
      .eq('match_id', latestMatch.id)
      .order('player_id')
      .order('turn', { ascending: false })

    for (const snap of snapshots ?? []) {
      if (!energyByPlayer[snap.player_id]) {
        energyByPlayer[snap.player_id] = snap
      }
    }
  }

  return { players, latestMatch, energyByPlayer, upcomingMatches, recentMatches, teamNames }
}

// ============================================================
// Utility helpers
// ============================================================

function daysSince(dateStr: string): number {
  const ms = Date.now() - new Date(dateStr).getTime()
  return ms / (1000 * 60 * 60 * 24)
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

type Recommendation = 'START' | 'MONITOR' | 'REST' | 'UNKNOWN'

function getRecommendation(
  energy: number | null,
  daysSinceMatch: number
): { label: Recommendation; color: string; bg: string } {
  if (energy === null) return { label: 'UNKNOWN', color: 'text-gray-400', bg: 'bg-gray-800' }

  // After 3 days rest, assume full recovery regardless of end-of-match energy
  const recoveredEnough = daysSinceMatch >= 3
  const effectiveEnergy = recoveredEnough ? 100 : energy

  if (effectiveEnergy >= 60) return { label: 'START', color: 'text-emerald-400', bg: 'bg-emerald-950' }
  if (effectiveEnergy >= 30) return { label: 'MONITOR', color: 'text-yellow-400', bg: 'bg-yellow-950' }
  return { label: 'REST', color: 'text-red-400', bg: 'bg-red-950' }
}

function getEnergyColor(energy: number | null): string {
  if (energy === null) return 'bg-gray-700'
  if (energy >= 60) return 'bg-emerald-500'
  if (energy >= 30) return 'bg-yellow-500'
  if (energy >= 10) return 'bg-orange-500'
  return 'bg-red-600'
}

function getEnergyTextColor(energy: number | null): string {
  if (energy === null) return 'text-gray-600'
  if (energy >= 60) return 'text-emerald-500'
  if (energy >= 30) return 'text-yellow-500'
  if (energy >= 10) return 'text-orange-500'
  return 'text-red-600'
}

function getEnergyLabel(energy: number | null): string {
  if (energy === null) return '—'
  if (energy >= 60) return 'High'
  if (energy >= 30) return 'Medium'
  if (energy >= 10) return 'Low'
  return 'Critical'
}

// ============================================================
// Sub-components
// ============================================================

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

interface PlayerCardProps {
  player: PlayerStat
  snap: EnergySnap | null
  daysSinceMatch: number
}

function PlayerCard({ player, snap, daysSinceMatch }: PlayerCardProps) {
  const energy = snap?.energy ?? null
  const rec = getRecommendation(energy, daysSinceMatch)
  const avgGoals =
    player.total_goals !== null && player.matches_played > 0
      ? (player.total_goals / player.matches_played).toFixed(2)
      : '—'

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 flex flex-col gap-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-white leading-tight">{player.player_name}</p>
          <p className="text-xs text-gray-500 mt-0.5">{player.matches_played} matches</p>
        </div>
        <span
          className={`shrink-0 rounded px-2 py-0.5 text-xs font-bold tracking-wide ${rec.color} ${rec.bg}`}
        >
          {rec.label}
        </span>
      </div>

      {/* Energy bar */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Last energy</span>
          <span className={getEnergyTextColor(energy)}>
            {energy !== null ? `${energy} — ${getEnergyLabel(energy)}` : 'No data'}
          </span>
        </div>
        <EnergyBar energy={energy} />
      </div>

      {/* Career stats */}
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
          <p className="text-xs text-gray-500">G/Match</p>
          <p className="text-sm font-medium text-gray-200">{avgGoals}</p>
        </div>
      </div>
    </div>
  )
}

function MatchResult({
  match,
  teamNames,
}: {
  match: RecentMatch
  teamNames: Record<string, string>
}) {
  const isHome = match.home_team_id === DS_TEAM_ID
  const dsScore = isHome ? match.home_score : match.away_score
  const oppScore = isHome ? match.away_score : match.home_score
  const oppName = teamNames[isHome ? match.away_team_id : match.home_team_id] ?? 'Unknown'

  let resultColor = 'text-gray-400'
  let resultLabel = '—'
  if (dsScore !== null && oppScore !== null) {
    if (dsScore > oppScore) { resultColor = 'text-emerald-400'; resultLabel = 'W' }
    else if (dsScore < oppScore) { resultColor = 'text-red-400'; resultLabel = 'L' }
    else { resultColor = 'text-yellow-400'; resultLabel = 'D' }
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3">
      <div>
        <p className="text-sm font-medium text-gray-200">
          {isHome ? 'vs ' : '@ '}{oppName}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">{formatDateShort(match.scheduled_time)}</p>
      </div>
      <div className="text-right">
        <span className={`text-lg font-bold ${resultColor}`}>{resultLabel}</span>
        {dsScore !== null && oppScore !== null && (
          <p className="text-xs text-gray-400">
            {isHome
              ? `${dsScore} – ${oppScore}`
              : `${oppScore} – ${dsScore}`}
          </p>
        )}
      </div>
    </div>
  )
}

// ============================================================
// Page
// ============================================================

export default async function DashboardPage() {
  const { players, latestMatch, energyByPlayer, upcomingMatches, recentMatches, teamNames } =
    await getDashboardData()

  const days = latestMatch ? daysSince(latestMatch.scheduled_time) : Infinity

  // Sort players into lineup groups
  const withRec = players.map((p) => {
    const snap = energyByPlayer[p.player_id] ?? null
    const rec = getRecommendation(snap?.energy ?? null, days)
    return { player: p, snap, rec }
  })

  const starters = withRec.filter((x) => x.rec.label === 'START')
  const monitors = withRec.filter((x) => x.rec.label === 'MONITOR')
  const resting  = withRec.filter((x) => x.rec.label === 'REST')
  const unknown  = withRec.filter((x) => x.rec.label === 'UNKNOWN')

  const lastSyncDate = latestMatch
    ? formatDate(latestMatch.scheduled_time)
    : 'No match data'

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* ---- Header ---- */}
      <div className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Deadly Sins
            <span className="ml-2 text-base font-normal text-gray-500">Coaching Dashboard</span>
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Energy data from last replayed match:{' '}
            <span className="text-gray-400">{lastSyncDate}</span>
            {days < Infinity && (
              <span className="ml-2 text-gray-600">
                ({Math.floor(days)}d ago — {days >= 3 ? 'all players estimated recovered' : 'recent, use data carefully'})
              </span>
            )}
          </p>
        </div>

        <div className="flex gap-3 text-sm">
          <span className="rounded-full bg-emerald-950 px-3 py-1 text-emerald-400 font-medium">
            {starters.length} Start
          </span>
          <span className="rounded-full bg-yellow-950 px-3 py-1 text-yellow-400 font-medium">
            {monitors.length} Monitor
          </span>
          <span className="rounded-full bg-red-950 px-3 py-1 text-red-400 font-medium">
            {resting.length} Rest
          </span>
          {unknown.length > 0 && (
            <span className="rounded-full bg-gray-800 px-3 py-1 text-gray-400 font-medium">
              {unknown.length} Unknown
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* ---- Left: Roster grid ---- */}
        <div className="lg:col-span-2 space-y-8">
          {/* Lineup recommendation summary */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
              Lineup Recommendation
            </h2>
            <div className="grid gap-6">
              {starters.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-400">
                    <span className="h-px flex-1 bg-emerald-950" />
                    Recommended Starters ({starters.length})
                    <span className="h-px flex-1 bg-emerald-950" />
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {starters.map(({ player, snap }) => (
                      <PlayerCard key={player.player_id} player={player} snap={snap} daysSinceMatch={days} />
                    ))}
                  </div>
                </div>
              )}

              {monitors.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-yellow-400">
                    <span className="h-px flex-1 bg-yellow-950" />
                    Monitor Closely ({monitors.length})
                    <span className="h-px flex-1 bg-yellow-950" />
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {monitors.map(({ player, snap }) => (
                      <PlayerCard key={player.player_id} player={player} snap={snap} daysSinceMatch={days} />
                    ))}
                  </div>
                </div>
              )}

              {resting.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-red-400">
                    <span className="h-px flex-1 bg-red-950" />
                    Needs Rest ({resting.length})
                    <span className="h-px flex-1 bg-red-950" />
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {resting.map(({ player, snap }) => (
                      <PlayerCard key={player.player_id} player={player} snap={snap} daysSinceMatch={days} />
                    ))}
                  </div>
                </div>
              )}

              {unknown.length > 0 && (
                <div>
                  <h3 className="mb-3 flex items-center gap-2 text-sm font-medium text-gray-500">
                    <span className="h-px flex-1 bg-gray-800" />
                    No Energy Data ({unknown.length})
                    <span className="h-px flex-1 bg-gray-800" />
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {unknown.map(({ player, snap }) => (
                      <PlayerCard key={player.player_id} player={player} snap={snap} daysSinceMatch={days} />
                    ))}
                  </div>
                </div>
              )}

              {players.length === 0 && (
                <p className="text-sm text-gray-600 italic">
                  No player data yet. Run <code className="font-mono text-gray-400">npm run sync:manual</code> to populate.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* ---- Right sidebar ---- */}
        <div className="space-y-8">
          {/* Upcoming matches */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
              Upcoming Matches
            </h2>
            {upcomingMatches.length === 0 ? (
              <div className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-6 text-center">
                <p className="text-sm text-gray-500">No matches currently scheduled.</p>
                <p className="mt-1 text-xs text-gray-600">Check back after the next schedule update.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {upcomingMatches.map((m) => (
                  <div
                    key={m.id}
                    className="rounded-lg border border-gray-800 bg-gray-900 p-4"
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        {m.deadly_sins_side === 'home' ? 'Home' : 'Away'}
                      </span>
                      {m.competition_name && (
                        <span className="text-xs text-gray-600">{m.competition_name}</span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-white">
                      {m.deadly_sins_side === 'home'
                        ? `Deadly Sins vs ${m.away_team_name}`
                        : `${m.home_team_name} vs Deadly Sins`}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">{formatDate(m.scheduled_time)}</p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Recent results */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
              Recent Results
            </h2>
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

          {/* Energy legend */}
          <section>
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-500">
              Energy Tiers
            </h2>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-2 text-xs text-gray-400">
              <div className="flex items-center gap-2">
                <span className="h-2 w-8 rounded-full bg-emerald-500" />
                <span>60–100 — No penalty</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-8 rounded-full bg-yellow-500" />
                <span>30–59 — Moderate penalty</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-8 rounded-full bg-orange-500" />
                <span>10–29 — Severe penalty</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-8 rounded-full bg-red-600" />
                <span>0–9 — Auto-sub risk</span>
              </div>
              <p className="pt-1 text-gray-600 leading-snug">
                Recovery model: players are assumed fully recovered after 3 days of rest.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
