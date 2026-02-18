/**
 * Player Detail Page
 *
 * Shows career stats, energy history across matches (bar chart + table),
 * and match-by-match performance for a single DS player.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const DS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'

// ============================================================
// Types
// ============================================================

interface CareerStats {
  player_id: string
  player_name: string
  matches_played: number
  total_goals: number | null
  total_shots: number | null
  total_tackles: number | null
  total_passes: number | null
  total_blocks: number | null
  total_fouls: number | null
  career_shot_conversion: number | null
  career_foul_rate: number | null
}

interface MatchEntry {
  match_id: string
  scheduled_time: string
  opponent_name: string
  is_home: boolean
  ds_score: number | null
  opp_score: number | null
  goals: number
  shots: number
  tackles: number
  passes: number
  final_energy: number | null
  min_energy: number | null
  first_below_30: number | null
}

// ============================================================
// Data fetching
// ============================================================

async function getPlayerData(playerId: string) {
  const db = createServerClient()

  // Career stats
  const { data: careerData } = await db
    .from('player_career_stats')
    .select('*')
    .eq('player_id', playerId)
    .eq('team_id', DS_TEAM_ID)
    .maybeSingle()

  if (!careerData) return null

  // Match-by-match stats for this player
  const { data: matchStatsData } = await db
    .from('player_match_stats')
    .select('match_id, goals, shots, tackles, passes, blocks, fouls')
    .eq('player_id', playerId)
    .order('match_id')

  const matchIds = (matchStatsData ?? []).map((s) => s.match_id)

  if (matchIds.length === 0) {
    return { career: careerData as CareerStats, matches: [] }
  }

  // Match metadata for those match IDs
  const { data: matchesData } = await db
    .from('matches')
    .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score')
    .in('id', matchIds)
    .eq('involves_deadly_sins', true)
    .order('scheduled_time', { ascending: false })

  // Team names
  const allTeamIds = new Set<string>()
  for (const m of matchesData ?? []) {
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

  // Energy data per match: final energy + thresholds
  const { data: energyThresholds } = await db
    .from('player_energy_thresholds')
    .select('match_id, min_energy_reached, first_turn_below_30')
    .eq('player_id', playerId)
    .in('match_id', matchIds)

  const thresholdByMatch: Record<string, { min_energy: number | null; first_below_30: number | null }> =
    Object.fromEntries(
      (energyThresholds ?? []).map((t) => [
        t.match_id,
        { min_energy: t.min_energy_reached, first_below_30: t.first_turn_below_30 },
      ])
    )

  // Final energy per match (highest turn for this player in each match)
  const finalEnergyResults = await Promise.all(
    matchIds.map((mid) =>
      db
        .from('energy_snapshots')
        .select('energy, turn')
        .eq('match_id', mid)
        .eq('player_id', playerId)
        .order('turn', { ascending: false })
        .limit(1)
        .maybeSingle()
    )
  )
  const finalEnergyByMatch: Record<string, number | null> = {}
  matchIds.forEach((mid, i) => {
    finalEnergyByMatch[mid] = finalEnergyResults[i].data?.energy ?? null
  })

  // Build per-match entries
  type MatchStatRow = { match_id: string; goals: number; shots: number; tackles: number; passes: number; blocks: number; fouls: number }
  const statsByMatch: Record<string, MatchStatRow> = Object.fromEntries(
    (matchStatsData ?? []).map((s) => [s.match_id, s])
  )

  const matches: MatchEntry[] = (matchesData ?? []).map((m) => {
    const isHome = m.home_team_id === DS_TEAM_ID
    const dsScore = isHome ? m.home_score : m.away_score
    const oppScore = isHome ? m.away_score : m.home_score
    const oppTeamId = isHome ? m.away_team_id : m.home_team_id
    const stats = statsByMatch[m.id]
    const thresh = thresholdByMatch[m.id]

    return {
      match_id: m.id,
      scheduled_time: m.scheduled_time,
      opponent_name: teamNames[oppTeamId] ?? 'Unknown',
      is_home: isHome,
      ds_score: dsScore,
      opp_score: oppScore,
      goals: stats?.goals ?? 0,
      shots: stats?.shots ?? 0,
      tackles: stats?.tackles ?? 0,
      passes: stats?.passes ?? 0,
      final_energy: finalEnergyByMatch[m.id] ?? null,
      min_energy: thresh?.min_energy ?? null,
      first_below_30: thresh?.first_below_30 ?? null,
    }
  })

  return { career: careerData as CareerStats, matches }
}

// ============================================================
// Helpers
// ============================================================

function getEnergyColor(energy: number | null): string {
  if (energy === null) return 'bg-gray-700'
  if (energy >= 60) return 'bg-emerald-500'
  if (energy >= 30) return 'bg-yellow-500'
  if (energy >= 10) return 'bg-orange-500'
  return 'bg-red-600'
}

function getEnergyTextColor(energy: number | null): string {
  if (energy === null) return 'text-gray-600'
  if (energy >= 60) return 'text-emerald-400'
  if (energy >= 30) return 'text-yellow-400'
  if (energy >= 10) return 'text-orange-400'
  return 'text-red-400'
}

function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

function pct(value: number | null, total: number | null): string {
  if (value === null || total === null || total === 0) return '—'
  return `${((value / total) * 100).toFixed(1)}%`
}

// ============================================================
// Energy history bar chart (CSS-based, no library needed)
// ============================================================

function EnergyHistoryChart({ matches }: { matches: MatchEntry[] }) {
  // Show last 15 matches chronologically (oldest left, newest right)
  const chartMatches = [...matches].reverse().slice(-15)

  if (chartMatches.every((m) => m.final_energy === null)) {
    return (
      <p className="text-sm text-gray-600 italic">No energy data available for this player.</p>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-1.5 h-24">
        {chartMatches.map((m) => {
          const e = m.final_energy
          const heightPct = e !== null ? Math.max(e, 2) : 2
          return (
            <div key={m.match_id} className="flex flex-1 flex-col items-center gap-1 group relative">
              {/* Tooltip */}
              <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs whitespace-nowrap text-center">
                  <p className="text-gray-200">{m.opponent_name}</p>
                  <p className="text-gray-400">{formatDateShort(m.scheduled_time)}</p>
                  <p className={getEnergyTextColor(e)}>
                    {e !== null ? `${e} energy` : 'No data'}
                  </p>
                </div>
                <div className="w-2 h-2 bg-gray-800 border-b border-r border-gray-700 rotate-45 -mt-1" />
              </div>
              {/* Bar */}
              <div
                className={`w-full rounded-t transition-all ${e !== null ? getEnergyColor(e) : 'bg-gray-800'}`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          )
        })}
      </div>
      {/* Baseline */}
      <div className="h-px bg-gray-700" />
      {/* X-axis labels: first and last */}
      <div className="flex justify-between text-xs text-gray-600">
        <span>{formatDateShort(chartMatches[0].scheduled_time)}</span>
        <span>← {chartMatches.length} matches →</span>
        <span>{formatDateShort(chartMatches[chartMatches.length - 1].scheduled_time)}</span>
      </div>
    </div>
  )
}

// ============================================================
// Page
// ============================================================

export default async function PlayerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getPlayerData(id)

  if (!data) notFound()

  const { career, matches } = data

  const avgGoals = career.total_goals !== null && career.matches_played > 0
    ? (career.total_goals / career.matches_played).toFixed(2) : '—'
  const avgShots = career.total_shots !== null && career.matches_played > 0
    ? (career.total_shots / career.matches_played).toFixed(1) : '—'

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        ← Dashboard
      </Link>

      {/* Header */}
      <div className="mt-4 mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">{career.player_name}</h1>
        <p className="mt-1 text-sm text-gray-500">
          {career.matches_played} matches played · Deadly Sins
        </p>
      </div>

      {/* Career stats summary */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
          Career Stats
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Goals', value: career.total_goals ?? 0 },
            { label: 'Shots', value: career.total_shots ?? 0 },
            { label: 'Tackles', value: career.total_tackles ?? 0 },
            { label: 'Passes', value: career.total_passes ?? 0 },
            { label: 'Goals/Match', value: avgGoals },
            { label: 'Shots/Match', value: avgShots },
            { label: 'Shot Conv.', value: pct(career.total_goals, career.total_shots) },
            { label: 'Matches', value: career.matches_played },
          ].map(({ label, value }) => (
            <div
              key={label}
              className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-center"
            >
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-xl font-bold text-white">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Energy history chart */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
          End-of-Match Energy History
        </h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <EnergyHistoryChart matches={matches} />
        </div>
        <p className="mt-2 text-xs text-gray-600">
          Bar height = final energy at end of match. Hover for details. Newest match on the right.
        </p>
      </section>

      {/* Match-by-match table */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
          Match History
        </h2>
        <div className="rounded-lg border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Opponent</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Result</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">G</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Sh</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Tk</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">End ⚡</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Min ⚡</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">↓30 Turn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {matches.map((m) => {
                  const dsScore = m.ds_score
                  const oppScore = m.opp_score
                  let resultLabel = '—'
                  let resultColor = 'text-gray-400'
                  if (dsScore !== null && oppScore !== null) {
                    if (dsScore > oppScore) { resultLabel = 'W'; resultColor = 'text-emerald-400' }
                    else if (dsScore < oppScore) { resultLabel = 'L'; resultColor = 'text-red-400' }
                    else { resultLabel = 'D'; resultColor = 'text-yellow-400' }
                  }

                  return (
                    <tr key={m.match_id} className="bg-gray-950 hover:bg-gray-900 transition-colors">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">
                        {formatDateShort(m.scheduled_time)}
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/matches/${m.match_id}`}
                          className="text-gray-200 hover:text-white transition-colors"
                        >
                          {m.is_home ? 'vs ' : '@ '}{m.opponent_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${resultColor}`}>{resultLabel}</span>
                        {dsScore !== null && oppScore !== null && (
                          <span className="ml-1 text-xs text-gray-500">
                            {m.is_home ? `${dsScore}–${oppScore}` : `${oppScore}–${dsScore}`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-300">{m.goals}</td>
                      <td className="px-4 py-3 text-center text-gray-300">{m.shots}</td>
                      <td className="px-4 py-3 text-center text-gray-300">{m.tackles}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={getEnergyTextColor(m.final_energy)}>
                          {m.final_energy ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={getEnergyTextColor(m.min_energy)}>
                          {m.min_energy ?? '—'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-400">
                        {m.first_below_30 ?? '—'}
                      </td>
                    </tr>
                  )
                })}
                {matches.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-600 italic">
                      No match data found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-xs text-gray-600">
          G = Goals · Sh = Shots · Tk = Tackles · End ⚡ = final energy · Min ⚡ = lowest energy reached · ↓30 Turn = first turn energy dropped below 30
        </p>
      </section>
    </div>
  )
}
