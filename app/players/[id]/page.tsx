/**
 * Player Detail Page
 *
 * Career stats, energy consistency, form indicator, best/worst match
 * highlights, fatigue trend, and sortable/paginated match history.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const DS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'
const PAGE_SIZE = 20

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
  avg_goals_per_match: number | null
  avg_tackles_per_match: number | null
}

interface MatchEntry {
  match_id: string
  scheduled_time: string
  opponent_name: string
  opponent_id: string
  is_home: boolean
  ds_score: number | null
  opp_score: number | null
  goals: number
  shots: number
  tackles: number
  passes: number
  fouls: number
  final_energy: number | null
  min_energy: number | null
  first_below_30: number | null
  result: 'W' | 'L' | 'D' | null
}

// ============================================================
// Data fetching
// ============================================================

async function getPlayerData(playerId: string) {
  const db = createServerClient()

  const { data: careerData } = await db
    .from('player_career_stats')
    .select('*')
    .eq('player_id', playerId)
    .eq('team_id', DS_TEAM_ID)
    .maybeSingle()

  if (!careerData) return null

  const { data: matchStatsData } = await db
    .from('player_match_stats')
    .select('match_id, goals, shots, tackles, passes, blocks, fouls')
    .eq('player_id', playerId)

  const matchIds = (matchStatsData ?? []).map((s) => s.match_id)

  if (matchIds.length === 0) {
    return { career: careerData as CareerStats, matches: [] }
  }

  const [matchesResult, teamsResult, thresholdsResult, finalEnergyResults] = await Promise.all([
    db
      .from('matches')
      .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score')
      .in('id', matchIds)
      .eq('involves_deadly_sins', true)
      .order('scheduled_time', { ascending: false }),
    db.from('teams').select('id, name'),
    db
      .from('player_energy_thresholds')
      .select('match_id, min_energy_reached, first_turn_below_30')
      .eq('player_id', playerId)
      .in('match_id', matchIds),
    // Final energy: get the max-turn snapshot for each match in one query
    db
      .from('energy_snapshots')
      .select('match_id, energy, turn')
      .eq('player_id', playerId)
      .in('match_id', matchIds)
      .order('turn', { ascending: false }),
  ])

  const teamNames: Record<string, string> = Object.fromEntries(
    (teamsResult.data ?? []).map((t) => [t.id, t.name])
  )

  const thresholdByMatch: Record<string, { min_energy: number | null; first_below_30: number | null }> =
    Object.fromEntries(
      (thresholdsResult.data ?? []).map((t) => [
        t.match_id,
        { min_energy: t.min_energy_reached, first_below_30: t.first_turn_below_30 },
      ])
    )

  // Pick final energy per match (first row for each match_id = highest turn due to sort)
  const finalEnergyByMatch: Record<string, number> = {}
  for (const snap of finalEnergyResults.data ?? []) {
    if (!(snap.match_id in finalEnergyByMatch)) {
      finalEnergyByMatch[snap.match_id] = snap.energy
    }
  }

  type MatchStatRow = { match_id: string; goals: number; shots: number; tackles: number; passes: number; blocks: number; fouls: number }
  const statsByMatch: Record<string, MatchStatRow> = Object.fromEntries(
    (matchStatsData ?? []).map((s) => [s.match_id, s])
  )

  const matches: MatchEntry[] = (matchesResult.data ?? []).map((m) => {
    const isHome = m.home_team_id === DS_TEAM_ID
    const dsScore = isHome ? m.home_score : m.away_score
    const oppScore = isHome ? m.away_score : m.home_score
    const oppTeamId = isHome ? m.away_team_id : m.home_team_id
    const stats = statsByMatch[m.id]
    const thresh = thresholdByMatch[m.id]

    let result: MatchEntry['result'] = null
    if (dsScore !== null && oppScore !== null) {
      result = dsScore > oppScore ? 'W' : dsScore < oppScore ? 'L' : 'D'
    }

    return {
      match_id: m.id,
      scheduled_time: m.scheduled_time,
      opponent_name: teamNames[oppTeamId] ?? 'Unknown',
      opponent_id: oppTeamId,
      is_home: isHome,
      ds_score: dsScore,
      opp_score: oppScore,
      goals: stats?.goals ?? 0,
      shots: stats?.shots ?? 0,
      tackles: stats?.tackles ?? 0,
      passes: stats?.passes ?? 0,
      fouls: stats?.fouls ?? 0,
      final_energy: finalEnergyByMatch[m.id] ?? null,
      min_energy: thresh?.min_energy ?? null,
      first_below_30: thresh?.first_below_30 ?? null,
      result,
    }
  })

  return { career: careerData as CareerStats, matches }
}

// ============================================================
// Analytics helpers
// ============================================================

function computeConsistency(energies: (number | null)[]): { score: number; label: string; description: string } | null {
  const vals = energies.filter((e): e is number => e !== null)
  if (vals.length < 3) return null
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const variance = vals.reduce((sum, v) => sum + (v - avg) ** 2, 0) / vals.length
  const stdDev = Math.sqrt(variance)
  // Lower stdDev = more consistent. Map 0-30 range to 100-0 score.
  const score = Math.max(0, Math.round(100 - (stdDev / 30) * 100))
  const label = score >= 75 ? 'Consistent' : score >= 50 ? 'Moderate' : 'Variable'
  const description = `σ = ${stdDev.toFixed(1)}, avg = ${avg.toFixed(1)}`
  return { score, label, description }
}

function computeFatigueTrend(matches: MatchEntry[]): { direction: 'improving' | 'declining' | 'stable'; delta: number } | null {
  // Chronological order (oldest first)
  const chrono = [...matches].reverse()
  const withEnergy = chrono.filter((m) => m.final_energy !== null)
  if (withEnergy.length < 6) return null

  const half = Math.floor(withEnergy.length / 2)
  const firstHalf = withEnergy.slice(0, half)
  const secondHalf = withEnergy.slice(-half)

  const avgFirst = firstHalf.reduce((s, m) => s + m.final_energy!, 0) / firstHalf.length
  const avgSecond = secondHalf.reduce((s, m) => s + m.final_energy!, 0) / secondHalf.length
  const delta = avgSecond - avgFirst

  return {
    direction: delta > 3 ? 'improving' : delta < -3 ? 'declining' : 'stable',
    delta,
  }
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
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

function pct(value: number | null, total: number | null): string {
  if (value === null || total === null || total === 0) return '—'
  return `${((value / total) * 100).toFixed(1)}%`
}

type SortKey = 'date' | 'goals' | 'shots' | 'tackles' | 'energy'
type SortDir = 'asc' | 'desc'

function sortMatches(matches: MatchEntry[], sort: SortKey, dir: SortDir): MatchEntry[] {
  const sorted = [...matches].sort((a, b) => {
    let diff = 0
    if (sort === 'date') diff = a.scheduled_time.localeCompare(b.scheduled_time)
    else if (sort === 'goals') diff = a.goals - b.goals
    else if (sort === 'shots') diff = a.shots - b.shots
    else if (sort === 'tackles') diff = a.tackles - b.tackles
    else if (sort === 'energy') {
      const aE = a.final_energy ?? -1
      const bE = b.final_energy ?? -1
      diff = aE - bE
    }
    return dir === 'asc' ? diff : -diff
  })
  return sorted
}

// ============================================================
// Sub-components
// ============================================================

function FormDots({ matches }: { matches: MatchEntry[] }) {
  // Take the 5 most recent completed matches (matches is newest-first)
  const recent = matches.filter((m) => m.result !== null).slice(0, 5)
  if (recent.length === 0) return <span className="text-xs text-gray-600">No completed matches</span>

  return (
    <div className="flex items-center gap-1.5">
      {recent.map((m) => {
        const color =
          m.result === 'W' ? 'bg-emerald-500' :
          m.result === 'L' ? 'bg-red-500' :
          'bg-yellow-500'
        return (
          <div
            key={m.match_id}
            className={`h-3 w-3 rounded-full ${color}`}
            title={`${m.result} vs ${m.opponent_name} (${formatDateShort(m.scheduled_time)})`}
          />
        )
      })}
      <span className="text-xs text-gray-600 ml-1">last {recent.length}</span>
    </div>
  )
}

function EnergyHistoryChart({ matches }: { matches: MatchEntry[] }) {
  const chartMatches = [...matches].reverse().slice(-15)
  if (chartMatches.every((m) => m.final_energy === null)) {
    return <p className="text-sm text-gray-600 italic">No energy data available for this player.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-end gap-1.5 h-24">
        {chartMatches.map((m) => {
          const e = m.final_energy
          const heightPct = e !== null ? Math.max(e, 2) : 2
          return (
            <div key={m.match_id} className="flex flex-1 flex-col items-center gap-1 group relative">
              <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                <div className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs whitespace-nowrap text-center">
                  <p className="text-gray-200">{m.opponent_name}</p>
                  <p className="text-gray-400">{formatDateShort(m.scheduled_time)}</p>
                  <p className={getEnergyTextColor(e)}>{e !== null ? `${e} energy` : 'No data'}</p>
                </div>
                <div className="w-2 h-2 bg-gray-800 border-b border-r border-gray-700 rotate-45 -mt-1" />
              </div>
              <div
                className={`w-full rounded-t transition-all ${e !== null ? getEnergyColor(e) : 'bg-gray-800'}`}
                style={{ height: `${heightPct}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="h-px bg-gray-700" />
      <div className="flex justify-between text-xs text-gray-600">
        <span>{formatDateShort(chartMatches[0].scheduled_time)}</span>
        <span>← {chartMatches.length} matches →</span>
        <span>{formatDateShort(chartMatches[chartMatches.length - 1].scheduled_time)}</span>
      </div>
    </div>
  )
}

function SortHeader({
  label, sortKey, currentSort, currentDir, playerId,
}: {
  label: string; sortKey: SortKey; currentSort: SortKey; currentDir: SortDir; playerId: string
}) {
  const isActive = currentSort === sortKey
  const nextDir = isActive && currentDir === 'desc' ? 'asc' : 'desc'
  return (
    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">
      <Link
        href={`/players/${playerId}?sort=${sortKey}&dir=${nextDir}`}
        className={`hover:text-gray-300 transition-colors ${isActive ? 'text-gray-300' : ''}`}
      >
        {label}{isActive ? (currentDir === 'desc' ? ' ↓' : ' ↑') : ''}
      </Link>
    </th>
  )
}

// ============================================================
// Page
// ============================================================

export default async function PlayerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ page?: string; sort?: string; dir?: string }>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])

  const page = Math.max(1, parseInt(sp.page ?? '1', 10) || 1)
  const sort: SortKey =
    ['date', 'goals', 'shots', 'tackles', 'energy'].includes(sp.sort ?? '')
      ? (sp.sort as SortKey)
      : 'date'
  const dir: SortDir = sp.dir === 'asc' ? 'asc' : 'desc'

  const data = await getPlayerData(id)
  if (!data) notFound()

  const { career, matches } = data

  // ---- Analytics ----
  const consistency = computeConsistency(matches.map((m) => m.final_energy))
  const fatigueTrend = computeFatigueTrend(matches)

  // Best match: most goals, tie-break by tackles
  const bestMatch = matches.length > 0
    ? [...matches].sort((a, b) => b.goals - a.goals || b.tackles - a.tackles)[0]
    : null

  // Worst match: lowest final_energy (only where we have data)
  const worstMatch = matches.filter((m) => m.final_energy !== null).length > 0
    ? [...matches].filter((m) => m.final_energy !== null).sort((a, b) => a.final_energy! - b.final_energy!)[0]
    : null

  // ---- Sort + paginate ----
  const sorted = sortMatches(matches, sort, dir)
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pagedMatches = sorted.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE)

  const avgGoals = career.total_goals !== null && career.matches_played > 0
    ? (career.total_goals / career.matches_played).toFixed(2) : '—'
  const avgShots = career.total_shots !== null && career.matches_played > 0
    ? (career.total_shots / career.matches_played).toFixed(1) : '—'

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors">
        ← Dashboard
      </Link>

      {/* Header */}
      <div className="mt-4 mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{career.player_name}</h1>
          <p className="mt-1 text-sm text-gray-500">{career.matches_played} matches · Deadly Sins</p>
          <div className="mt-2">
            <FormDots matches={matches} />
          </div>
        </div>
        <Link
          href={`/compare?a=${id}`}
          className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors shrink-0"
        >
          Compare →
        </Link>
      </div>

      {/* Career stats grid */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Career Stats</h2>
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
            <div key={label} className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-center">
              <p className="text-xs text-gray-500 mb-1">{label}</p>
              <p className="text-xl font-bold text-white">{value}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Highlights + Consistency row */}
      <section className="mb-8">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Best match */}
          {bestMatch && (
            <Link
              href={`/matches/${bestMatch.match_id}`}
              className="rounded-lg border border-emerald-900 bg-emerald-950/30 p-4 hover:border-emerald-700 transition-colors"
            >
              <p className="text-xs font-medium text-emerald-500 mb-1">Best Match</p>
              <p className="text-sm font-medium text-gray-200">{bestMatch.goals}G · {bestMatch.shots}Sh · {bestMatch.tackles}Tk</p>
              <p className="text-xs text-gray-500 mt-0.5">{bestMatch.is_home ? 'vs ' : '@ '}{bestMatch.opponent_name}</p>
              <p className="text-xs text-gray-600 mt-0.5">{formatDateShort(bestMatch.scheduled_time)}</p>
            </Link>
          )}

          {/* Worst energy match */}
          {worstMatch && (
            <Link
              href={`/matches/${worstMatch.match_id}`}
              className="rounded-lg border border-red-900 bg-red-950/20 p-4 hover:border-red-700 transition-colors"
            >
              <p className="text-xs font-medium text-red-500 mb-1">Most Fatigued Match</p>
              <p className={`text-sm font-medium ${getEnergyTextColor(worstMatch.final_energy)}`}>
                Final energy: {worstMatch.final_energy}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">{worstMatch.is_home ? 'vs ' : '@ '}{worstMatch.opponent_name}</p>
              <p className="text-xs text-gray-600 mt-0.5">{formatDateShort(worstMatch.scheduled_time)}</p>
            </Link>
          )}

          {/* Energy consistency */}
          {consistency && (
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <p className="text-xs font-medium text-gray-500 mb-1">Energy Consistency</p>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xl font-bold text-white">{consistency.score}</span>
                <span className={`text-sm font-medium ${
                  consistency.score >= 75 ? 'text-emerald-400' :
                  consistency.score >= 50 ? 'text-yellow-400' : 'text-red-400'
                }`}>{consistency.label}</span>
              </div>
              <p className="text-xs text-gray-600">{consistency.description}</p>
              {fatigueTrend && (
                <p className={`text-xs mt-1.5 ${
                  fatigueTrend.direction === 'improving' ? 'text-emerald-500' :
                  fatigueTrend.direction === 'declining' ? 'text-red-400' : 'text-gray-500'
                }`}>
                  {fatigueTrend.direction === 'improving' ? '↑ Energy improving' :
                   fatigueTrend.direction === 'declining' ? '↓ Energy declining' :
                   '→ Energy stable'}
                  {' '}({fatigueTrend.delta > 0 ? '+' : ''}{fatigueTrend.delta.toFixed(1)} avg)
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* Energy history chart */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">End-of-Match Energy (last 15)</h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
          <EnergyHistoryChart matches={matches} />
        </div>
        <p className="mt-2 text-xs text-gray-600">Bar height = final energy at end of match. Hover for details. Newest on right.</p>
      </section>

      {/* Match history table */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-gray-500">
            Match History ({matches.length})
          </h2>
          {totalPages > 1 && (
            <p className="text-xs text-gray-600">
              Page {safePage} of {totalPages}
            </p>
          )}
        </div>
        <div className="rounded-lg border border-gray-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-800 bg-gray-900">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">
                    <Link href={`/players/${id}?sort=date&dir=${sort === 'date' && dir === 'desc' ? 'asc' : 'desc'}`}
                      className={`hover:text-gray-300 transition-colors ${sort === 'date' ? 'text-gray-300' : ''}`}>
                      Date{sort === 'date' ? (dir === 'desc' ? ' ↓' : ' ↑') : ''}
                    </Link>
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Opponent</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Result</th>
                  <SortHeader label="G" sortKey="goals" currentSort={sort} currentDir={dir} playerId={id} />
                  <SortHeader label="Sh" sortKey="shots" currentSort={sort} currentDir={dir} playerId={id} />
                  <SortHeader label="Tk" sortKey="tackles" currentSort={sort} currentDir={dir} playerId={id} />
                  <SortHeader label="End ⚡" sortKey="energy" currentSort={sort} currentDir={dir} playerId={id} />
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Min ⚡</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">↓30 Turn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {pagedMatches.map((m) => {
                  const resultColor =
                    m.result === 'W' ? 'text-emerald-400' :
                    m.result === 'L' ? 'text-red-400' :
                    m.result === 'D' ? 'text-yellow-400' : 'text-gray-400'

                  return (
                    <tr key={m.match_id} className="bg-gray-950 hover:bg-gray-900 transition-colors">
                      <td className="px-4 py-3 text-gray-400 whitespace-nowrap">{formatDateShort(m.scheduled_time)}</td>
                      <td className="px-4 py-3">
                        <Link href={`/matches/${m.match_id}`} className="text-gray-200 hover:text-white transition-colors">
                          {m.is_home ? 'vs ' : '@ '}{m.opponent_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold ${resultColor}`}>{m.result ?? '—'}</span>
                        {m.ds_score !== null && m.opp_score !== null && (
                          <span className="ml-1 text-xs text-gray-500">
                            {m.is_home ? `${m.ds_score}–${m.opp_score}` : `${m.opp_score}–${m.ds_score}`}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-gray-300">{m.goals}</td>
                      <td className="px-4 py-3 text-center text-gray-300">{m.shots}</td>
                      <td className="px-4 py-3 text-center text-gray-300">{m.tackles}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={getEnergyTextColor(m.final_energy)}>{m.final_energy ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={getEnergyTextColor(m.min_energy)}>{m.min_energy ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-center text-gray-400">{m.first_below_30 ?? '—'}</td>
                    </tr>
                  )
                })}
                {pagedMatches.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-sm text-gray-600 italic">No match data found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between gap-4">
            <Link
              href={safePage > 1 ? `/players/${id}?sort=${sort}&dir=${dir}&page=${safePage - 1}` : '#'}
              className={`text-sm px-3 py-1.5 rounded border transition-colors ${
                safePage > 1
                  ? 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500'
                  : 'border-gray-800 text-gray-700 cursor-default'
              }`}
            >
              ← Prev
            </Link>
            <span className="text-xs text-gray-600">{safePage} / {totalPages}</span>
            <Link
              href={safePage < totalPages ? `/players/${id}?sort=${sort}&dir=${dir}&page=${safePage + 1}` : '#'}
              className={`text-sm px-3 py-1.5 rounded border transition-colors ${
                safePage < totalPages
                  ? 'border-gray-700 text-gray-400 hover:text-gray-200 hover:border-gray-500'
                  : 'border-gray-800 text-gray-700 cursor-default'
              }`}
            >
              Next →
            </Link>
          </div>
        )}

        <p className="mt-2 text-xs text-gray-600">
          G = Goals · Sh = Shots · Tk = Tackles · Click column headers to sort · End ⚡ = final energy · Min ⚡ = lowest energy · ↓30 Turn = first below 30
        </p>
      </section>
    </div>
  )
}
