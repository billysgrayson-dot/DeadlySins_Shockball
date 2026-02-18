/**
 * Match Review Page
 *
 * Shows full DS player stats, energy summary table, and a turn-by-turn
 * SVG line chart for each DS player in the match.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const DS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'

// ============================================================
// Types
// ============================================================

interface MatchInfo {
  id: string
  scheduled_time: string
  home_team_id: string
  away_team_id: string
  home_score: number | null
  away_score: number | null
  home_team_name: string
  away_team_name: string
  competition_name: string | null
  status: string
  replay_fetched: boolean
}

interface PlayerMatchStat {
  player_id: string
  player_name: string
  team_id: string
  is_home_team: boolean
  goals: number
  shots: number
  tackles: number
  passes: number
  blocks: number
  fouls: number
  was_injured: boolean
}

interface EnergyPoint {
  turn: number
  energy: number
}

interface PlayerEnergySummary {
  player_id: string
  player_name: string
  final_energy: number | null
  min_energy: number | null
  first_below_30: number | null
  first_below_20: number | null
  first_below_10: number | null
  turns: EnergyPoint[]
}

// ============================================================
// Data fetching
// ============================================================

async function getMatchData(matchId: string) {
  const db = createServerClient()

  // Match info
  const { data: matchData } = await db
    .from('matches')
    .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score, status, replay_fetched')
    .eq('id', matchId)
    .maybeSingle()

  if (!matchData) return null

  // Team names
  const { data: teamsData } = await db
    .from('teams')
    .select('id, name')
    .in('id', [matchData.home_team_id, matchData.away_team_id])
  const teamNames: Record<string, string> = Object.fromEntries(
    (teamsData ?? []).map((t) => [t.id, t.name])
  )

  // Competition name via match (join through competitions)
  const { data: compMatch } = await db
    .from('matches')
    .select('competition_id')
    .eq('id', matchId)
    .maybeSingle()
  let competitionName: string | null = null
  if (compMatch?.competition_id) {
    const { data: comp } = await db
      .from('competitions')
      .select('name')
      .eq('id', compMatch.competition_id)
      .maybeSingle()
    competitionName = comp?.name ?? null
  }

  const match: MatchInfo = {
    ...matchData,
    home_team_name: teamNames[matchData.home_team_id] ?? 'Unknown',
    away_team_name: teamNames[matchData.away_team_id] ?? 'Unknown',
    competition_name: competitionName,
  }

  // All player stats for this match (both teams)
  const { data: allStats } = await db
    .from('player_match_stats')
    .select('player_id, player_name, team_id, is_home_team, goals, shots, tackles, passes, blocks, fouls, was_injured')
    .eq('match_id', matchId)

  const allPlayerStats: PlayerMatchStat[] = allStats ?? []
  const dsStats = allPlayerStats.filter((s) => s.team_id === DS_TEAM_ID)

  if (!matchData.replay_fetched) {
    return { match, allPlayerStats, dsStats, energySummaries: [], hasReplay: false }
  }

  // Energy data — DS players only (we only track DS energy)
  const dsPlayerIds = dsStats.map((s) => s.player_id)

  const { data: allSnapshots } = await db
    .from('energy_snapshots')
    .select('player_id, turn, energy')
    .eq('match_id', matchId)
    .in('player_id', dsPlayerIds)
    .order('player_id')
    .order('turn', { ascending: true })

  // Energy thresholds from view
  const { data: thresholdsData } = await db
    .from('player_energy_thresholds')
    .select('player_id, min_energy_reached, first_turn_below_30, first_turn_below_20, first_turn_below_10')
    .eq('match_id', matchId)
    .in('player_id', dsPlayerIds)

  type ThresholdRow = { player_id: string; min_energy_reached: number | null; first_turn_below_30: number | null; first_turn_below_20: number | null; first_turn_below_10: number | null }
  const thresholdMap: Record<string, ThresholdRow> = Object.fromEntries(
    (thresholdsData ?? []).map((t) => [t.player_id, t])
  )

  // Group snapshots by player
  const snapsByPlayer: Record<string, EnergyPoint[]> = {}
  for (const snap of allSnapshots ?? []) {
    if (!snapsByPlayer[snap.player_id]) snapsByPlayer[snap.player_id] = []
    snapsByPlayer[snap.player_id].push({ turn: snap.turn, energy: snap.energy })
  }

  // Build energy summaries, sorted by final energy desc
  const energySummaries: PlayerEnergySummary[] = dsStats.map((s) => {
    const turns = snapsByPlayer[s.player_id] ?? []
    const finalEntry = turns.length > 0 ? turns[turns.length - 1] : null
    const thresh = thresholdMap[s.player_id]
    return {
      player_id: s.player_id,
      player_name: s.player_name,
      final_energy: finalEntry?.energy ?? null,
      min_energy: thresh?.min_energy_reached ?? null,
      first_below_30: thresh?.first_turn_below_30 ?? null,
      first_below_20: thresh?.first_turn_below_20 ?? null,
      first_below_10: thresh?.first_turn_below_10 ?? null,
      turns,
    }
  }).sort((a, b) => {
    if (a.final_energy === null && b.final_energy === null) return 0
    if (a.final_energy === null) return 1
    if (b.final_energy === null) return -1
    return b.final_energy - a.final_energy
  })

  return { match, allPlayerStats, dsStats, energySummaries, hasReplay: true }
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

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

// ============================================================
// SVG Energy Chart — turn-by-turn line per player
// ============================================================

function EnergyLineChart({ summaries }: { summaries: PlayerEnergySummary[] }) {
  // Only players with turn data
  const withData = summaries.filter((s) => s.turns.length > 0)
  if (withData.length === 0) return null

  const maxTurn = Math.max(...withData.flatMap((s) => s.turns.map((t) => t.turn)))
  const W = 600
  const H = 160
  const PAD = { top: 8, right: 8, bottom: 20, left: 28 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top - PAD.bottom

  const x = (turn: number) => PAD.left + (turn / Math.max(maxTurn, 1)) * chartW
  const y = (energy: number) => PAD.top + (1 - energy / 100) * chartH

  // Colour palette for multiple lines
  const lineColors = [
    '#34d399', '#fbbf24', '#f87171', '#60a5fa',
    '#a78bfa', '#fb923c', '#e879f9', '#2dd4bf',
  ]

  // Threshold lines at 30 and 10
  const y30 = y(30)
  const y10 = y(10)

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        style={{ minWidth: 320, maxWidth: 700 }}
      >
        {/* Y-axis labels */}
        {[0, 30, 60, 100].map((val) => (
          <g key={val}>
            <text
              x={PAD.left - 4}
              y={y(val) + 4}
              textAnchor="end"
              fontSize={9}
              fill="#6b7280"
            >
              {val}
            </text>
            <line
              x1={PAD.left}
              y1={y(val)}
              x2={W - PAD.right}
              y2={y(val)}
              stroke="#1f2937"
              strokeWidth={0.5}
            />
          </g>
        ))}

        {/* Penalty threshold bands */}
        <line x1={PAD.left} y1={y30} x2={W - PAD.right} y2={y30}
          stroke="#854d0e" strokeWidth={1} strokeDasharray="4 2" />
        <line x1={PAD.left} y1={y10} x2={W - PAD.right} y2={y10}
          stroke="#7f1d1d" strokeWidth={1} strokeDasharray="4 2" />

        {/* Player lines */}
        {withData.map((s, idx) => {
          const color = lineColors[idx % lineColors.length]
          const points = s.turns
            .map((t) => `${x(t.turn).toFixed(1)},${y(t.energy).toFixed(1)}`)
            .join(' ')
          return (
            <polyline
              key={s.player_id}
              points={points}
              fill="none"
              stroke={color}
              strokeWidth={1.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              opacity={0.9}
            />
          )
        })}

        {/* X-axis label */}
        <text
          x={PAD.left + chartW / 2}
          y={H - 2}
          textAnchor="middle"
          fontSize={9}
          fill="#6b7280"
        >
          Turn
        </text>
      </svg>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap gap-3">
        {withData.map((s, idx) => (
          <div key={s.player_id} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span
              className="inline-block h-2.5 w-5 rounded-sm"
              style={{ backgroundColor: lineColors[idx % lineColors.length] }}
            />
            {s.player_name}
          </div>
        ))}
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="inline-block h-px w-5 border-t border-dashed border-yellow-900" />
          30 threshold
        </div>
        <div className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="inline-block h-px w-5 border-t border-dashed border-red-900" />
          10 threshold
        </div>
      </div>
    </div>
  )
}

// ============================================================
// Page
// ============================================================

export default async function MatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const data = await getMatchData(id)

  if (!data) notFound()

  const { match, allPlayerStats, dsStats, energySummaries, hasReplay } = data

  const isHome = match.home_team_id === DS_TEAM_ID
  const dsScore = isHome ? match.home_score : match.away_score
  const oppScore = isHome ? match.away_score : match.home_score
  const oppName = isHome ? match.away_team_name : match.home_team_name

  let resultLabel = '—'
  let resultColor = 'text-gray-400'
  if (dsScore !== null && oppScore !== null) {
    if (dsScore > oppScore) { resultLabel = 'W'; resultColor = 'text-emerald-400' }
    else if (dsScore < oppScore) { resultLabel = 'L'; resultColor = 'text-red-400' }
    else { resultLabel = 'D'; resultColor = 'text-yellow-400' }
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Back link */}
      <Link
        href="/dashboard"
        className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors"
      >
        ← Dashboard
      </Link>

      {/* Match header */}
      <div className="mt-4 mb-8">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-white">
              Deadly Sins {isHome ? 'vs' : '@'} {oppName}
            </h1>
            <p className="mt-1 text-sm text-gray-500">{formatDate(match.scheduled_time)}</p>
            {match.competition_name && (
              <p className="mt-0.5 text-xs text-gray-600">{match.competition_name}</p>
            )}
          </div>
          <div className="text-right shrink-0">
            <span className={`text-4xl font-bold ${resultColor}`}>{resultLabel}</span>
            {dsScore !== null && oppScore !== null && (
              <p className="text-lg text-gray-400 mt-1">
                {isHome ? `${dsScore} – ${oppScore}` : `${oppScore} – ${dsScore}`}
              </p>
            )}
          </div>
        </div>
        {!hasReplay && (
          <div className="mt-4 rounded-lg border border-yellow-900 bg-yellow-950 px-4 py-3 text-sm text-yellow-400">
            Replay data not yet fetched for this match. Stats and energy data unavailable.
          </div>
        )}
      </div>

      {hasReplay && (
        <>
          {/* Energy turn-by-turn chart */}
          {energySummaries.some((s) => s.turns.length > 0) && (
            <section className="mb-8">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
                Energy Progression (DS Players)
              </h2>
              <div className="rounded-lg border border-gray-800 bg-gray-900 p-5">
                <EnergyLineChart summaries={energySummaries} />
              </div>
            </section>
          )}

          {/* Energy summary table */}
          {energySummaries.length > 0 && (
            <section className="mb-8">
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
                Energy Summary
              </h2>
              <div className="rounded-lg border border-gray-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900">
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Player</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Final ⚡</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Min ⚡</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">↓30 Turn</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">↓20 Turn</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">↓10 Turn</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {energySummaries.map((s) => (
                      <tr key={s.player_id} className="bg-gray-950 hover:bg-gray-900 transition-colors">
                        <td className="px-4 py-3">
                          <Link
                            href={`/players/${s.player_id}`}
                            className="text-gray-200 hover:text-white transition-colors"
                          >
                            {s.player_name}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={getEnergyTextColor(s.final_energy)}>
                            {s.final_energy ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={getEnergyTextColor(s.min_energy)}>
                            {s.min_energy ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center text-gray-400">{s.first_below_30 ?? '—'}</td>
                        <td className="px-4 py-3 text-center text-gray-400">{s.first_below_20 ?? '—'}</td>
                        <td className="px-4 py-3 text-center text-gray-400">{s.first_below_10 ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-xs text-gray-600">
                ↓30/20/10 = first turn energy dropped below that threshold during the match.
              </p>
            </section>
          )}

          {/* Player stats — both teams */}
          {allPlayerStats.length > 0 && (
            <section>
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
                Player Stats
              </h2>
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
                {[
                  { teamId: match.home_team_id, teamName: match.home_team_name, isHome: true },
                  { teamId: match.away_team_id, teamName: match.away_team_name, isHome: false },
                ].map(({ teamId, teamName, isHome: teamIsHome }) => {
                  const teamStats = allPlayerStats
                    .filter((s) => s.team_id === teamId)
                    .sort((a, b) => b.goals - a.goals || b.shots - a.shots)
                  const isDS = teamId === DS_TEAM_ID
                  return (
                    <div key={teamId}>
                      <h3 className="mb-2 text-sm font-medium text-gray-400">
                        {teamIsHome ? '🏠 ' : '✈️ '}{teamName}
                        {isDS && <span className="ml-2 text-xs text-emerald-600">(us)</span>}
                      </h3>
                      <div className="rounded-lg border border-gray-800 overflow-hidden">
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-gray-800 bg-gray-900">
                                <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Player</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">G</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Sh</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Tk</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Ps</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Bl</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Fo</th>
                                <th className="px-3 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Inj</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-800">
                              {teamStats.length === 0 ? (
                                <tr>
                                  <td colSpan={8} className="px-3 py-4 text-center text-xs text-gray-600 italic">
                                    No stats available
                                  </td>
                                </tr>
                              ) : (
                                teamStats.map((s) => (
                                  <tr key={s.player_id} className="bg-gray-950 hover:bg-gray-900 transition-colors">
                                    <td className="px-3 py-2">
                                      {isDS ? (
                                        <Link
                                          href={`/players/${s.player_id}`}
                                          className="text-gray-200 hover:text-white transition-colors"
                                        >
                                          {s.player_name}
                                        </Link>
                                      ) : (
                                        <span className="text-gray-400">{s.player_name}</span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-center text-gray-300">{s.goals}</td>
                                    <td className="px-3 py-2 text-center text-gray-300">{s.shots}</td>
                                    <td className="px-3 py-2 text-center text-gray-300">{s.tackles}</td>
                                    <td className="px-3 py-2 text-center text-gray-300">{s.passes}</td>
                                    <td className="px-3 py-2 text-center text-gray-300">{s.blocks}</td>
                                    <td className="px-3 py-2 text-center text-gray-300">{s.fouls}</td>
                                    <td className="px-3 py-2 text-center">
                                      {s.was_injured ? (
                                        <span className="text-red-400 text-xs font-medium">Yes</span>
                                      ) : (
                                        <span className="text-gray-600">—</span>
                                      )}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <p className="mt-2 text-xs text-gray-600">
                G = Goals · Sh = Shots · Tk = Tackles · Ps = Passes · Bl = Blocks · Fo = Fouls · Inj = Injured
              </p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
