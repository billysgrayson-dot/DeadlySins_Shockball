/**
 * Coaching Dashboard — Deadly Sins
 *
 * Focuses on performance: goals, shots, shot conversion, tackles, passes, form.
 * Energy is a minor game mechanic and intentionally de-emphasised here.
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
  total_passes: number | null
  career_shot_conversion: number | null
  avg_goals_per_match: number | null
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

  const [playersResult, upcomingResult, recentMatchesResult, lastSyncResult] =
    await Promise.all([
      db
        .from('player_career_stats')
        .select('player_id, player_name, team_id, matches_played, total_goals, total_shots, total_tackles, total_passes, career_shot_conversion, avg_goals_per_match')
        .eq('team_id', DS_TEAM_ID)
        .order('total_goals', { ascending: false }),
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
  const upcomingMatches: UpcomingMatch[] = (upcomingResult.data ?? []) as UpcomingMatch[]
  const recentMatches: RecentMatch[] = recentMatchesResult.data ?? []
  const lastSyncAt: string | null = lastSyncResult.data?.fetched_at ?? null

  // Team names for recent results
  const allTeamIds = new Set<string>()
  for (const m of recentMatches) {
    allTeamIds.add(m.home_team_id)
    allTeamIds.add(m.away_team_id)
  }
  const { data: teamsData } = await db.from('teams').select('id, name').in('id', [...allTeamIds])
  const teamNames: Record<string, string> = Object.fromEntries(
    (teamsData ?? []).map((t) => [t.id, t.name])
  )

  // Streak
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

  // Per-player form from last 5 completed matches
  const last5Matches = recentMatches.slice(0, 5)
  const last5MatchIds = last5Matches.map(m => m.id)
  const matchResultMap: Record<string, FormResult> = {}
  for (const m of last5Matches) {
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

  return {
    players,
    upcomingMatches,
    recentMatches: recentMatches.slice(0, 5),
    teamNames,
    lastSyncAt,
    streak,
    streakType,
    playerForm,
  }
}

// ============================================================
// Helpers
// ============================================================

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

function pct(val: number | null): string {
  if (val === null) return '—'
  return `${(val * 100).toFixed(0)}%`
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

function PlayerCard({ player, form }: { player: PlayerStat; form: FormResult[] }) {
  return (
    <Link href={`/players/${player.player_id}`} className="block h-full">
      <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 flex flex-col gap-3 hover:border-gray-600 transition-colors h-full">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-semibold text-white leading-tight">{player.player_name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-xs text-gray-500">{player.matches_played} GP</span>
              <FormDots results={form} />
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1 text-center">
          <div>
            <p className="text-xs text-gray-500">Goals</p>
            <p className="text-sm font-semibold text-white">{player.total_goals ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">G/Match</p>
            <p className="text-sm font-semibold text-white">{Number(player.avg_goals_per_match ?? 0).toFixed(2)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Shot%</p>
            <p className="text-sm font-semibold text-white">{pct(player.career_shot_conversion)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-1 text-center border-t border-gray-800 pt-2">
          <div>
            <p className="text-xs text-gray-500">Tackles</p>
            <p className="text-sm font-semibold text-white">{player.total_tackles ?? 0}</p>
          </div>
          <div>
            <p className="text-xs text-gray-500">Passes</p>
            <p className="text-sm font-semibold text-white">{player.total_passes ?? 0}</p>
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
        <Link href={`/scouting/${oppId}`} className="text-xs text-gray-600 hover:text-gray-400 transition-colors">
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
  const { players, upcomingMatches, recentMatches, teamNames, lastSyncAt, streak, streakType, playerForm } =
    await getDashboardData()

  const streakColor = streakType === 'W' ? 'text-emerald-400' : streakType === 'L' ? 'text-red-400' : 'text-yellow-400'

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Deadly Sins
            <span className="ml-2 text-base font-normal text-gray-500">Dashboard</span>
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm">
            {streak > 0 && streakType && (
              <span className={`font-semibold ${streakColor}`}>{streak}{streakType} streak</span>
            )}
            {lastSyncAt && (
              <span className="text-xs text-gray-600">Synced {timeAgo(lastSyncAt)}</span>
            )}
            <Link href="/admin" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Admin →</Link>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        {/* Left: roster */}
        <div className="lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500">Roster</h2>
            <p className="text-xs text-gray-600">Sorted by goals · form = last 5 results (newest first)</p>
          </div>
          {players.length === 0 ? (
            <p className="text-sm text-gray-600 italic">
              No player data. Run <code className="font-mono text-gray-400">npm run sync:manual</code> to populate.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {players.map((p) => (
                <PlayerCard key={p.player_id} player={p} form={playerForm[p.player_id] ?? []} />
              ))}
            </div>
          )}
        </div>

        {/* Sidebar */}
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
        </div>
      </div>
    </div>
  )
}
