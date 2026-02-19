/**
 * Leaderboard — DS player rankings across key stats
 */

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const DS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'

interface CareerRow {
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

async function getData() {
  const db = createServerClient()

  const { data } = await db
    .from('player_career_stats')
    .select('player_id, player_name, matches_played, total_goals, total_shots, total_tackles, total_passes, total_blocks, total_fouls, career_shot_conversion, career_foul_rate, avg_goals_per_match, avg_tackles_per_match')
    .eq('team_id', DS_TEAM_ID)

  // Per-player avg final energy across all matches
  const players = data ?? []
  const playerIds = players.map(p => p.player_id)

  // Get avg end-of-match energy per player (max turn per player per match)
  // Approximate: use player_energy_thresholds which has last_turn_tracked + min_energy
  const { data: threshData } = await db
    .from('player_energy_thresholds')
    .select('player_id, min_energy_reached')
    .in('player_id', playerIds)

  // Average min energy per player (proxy for how well they maintain energy)
  const energyByPlayer: Record<string, number[]> = {}
  for (const row of threshData ?? []) {
    if (row.min_energy_reached !== null) {
      if (!energyByPlayer[row.player_id]) energyByPlayer[row.player_id] = []
      energyByPlayer[row.player_id].push(row.min_energy_reached)
    }
  }
  const avgMinEnergy: Record<string, number> = {}
  for (const [pid, vals] of Object.entries(energyByPlayer)) {
    avgMinEnergy[pid] = vals.reduce((a, b) => a + b, 0) / vals.length
  }

  return { players: players as CareerRow[], avgMinEnergy }
}

function Medal({ rank }: { rank: number }) {
  if (rank === 1) return <span className="text-yellow-400 font-bold">🥇</span>
  if (rank === 2) return <span className="text-gray-300 font-bold">🥈</span>
  if (rank === 3) return <span className="text-amber-600 font-bold">🥉</span>
  return <span className="text-gray-600 text-sm w-5 inline-block text-center">{rank}</span>
}

function Table({
  title,
  rows,
  valueLabel,
  note,
}: {
  title: string
  rows: { player_id: string; player_name: string; value: string | number; sub?: string }[]
  valueLabel: string
  note?: string
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-500">{title}</h2>
      <div className="rounded-lg border border-gray-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 bg-gray-900">
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-600 w-8">#</th>
              <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Player</th>
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wide">{valueLabel}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800">
            {rows.map((row, i) => (
              <tr key={row.player_id} className="bg-gray-950 hover:bg-gray-900 transition-colors">
                <td className="px-4 py-2.5 text-center"><Medal rank={i + 1} /></td>
                <td className="px-4 py-2.5">
                  <Link href={`/players/${row.player_id}`} className="text-gray-200 hover:text-white transition-colors">
                    {row.player_name}
                  </Link>
                  {row.sub && <span className="ml-2 text-xs text-gray-600">{row.sub}</span>}
                </td>
                <td className="px-4 py-2.5 text-right font-medium text-gray-200">{row.value}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note && <p className="mt-1.5 text-xs text-gray-600">{note}</p>}
    </div>
  )
}

export default async function LeaderboardPage() {
  const { players, avgMinEnergy } = await getData()

  const sorted = {
    goals: [...players].sort((a, b) => (b.total_goals ?? 0) - (a.total_goals ?? 0)).slice(0, 10),
    shots: [...players].sort((a, b) => (b.total_shots ?? 0) - (a.total_shots ?? 0)).slice(0, 10),
    conversion: [...players]
      .filter(p => (p.total_shots ?? 0) >= 5)
      .sort((a, b) => (b.career_shot_conversion ?? 0) - (a.career_shot_conversion ?? 0))
      .slice(0, 10),
    tackles: [...players].sort((a, b) => (b.total_tackles ?? 0) - (a.total_tackles ?? 0)).slice(0, 10),
    avgGoals: [...players]
      .filter(p => p.matches_played >= 3)
      .sort((a, b) => (b.avg_goals_per_match ?? 0) - (a.avg_goals_per_match ?? 0))
      .slice(0, 10),
    energy: [...players]
      .filter(p => avgMinEnergy[p.player_id] !== undefined)
      .sort((a, b) => (avgMinEnergy[b.player_id] ?? 0) - (avgMinEnergy[a.player_id] ?? 0))
      .slice(0, 10),
    veteran: [...players].sort((a, b) => b.matches_played - a.matches_played).slice(0, 10),
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-white">Leaderboard</h1>
        <p className="mt-1 text-sm text-gray-500">Career stats across all {players.length} DS players</p>
      </div>

      <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 xl:grid-cols-3">
        <Table
          title="Top Scorers"
          valueLabel="Goals"
          rows={sorted.goals.map(p => ({ player_id: p.player_id, player_name: p.player_name, value: p.total_goals ?? 0, sub: `${p.matches_played} GP` }))}
        />
        <Table
          title="Goals Per Match"
          valueLabel="G/GP"
          note="Min 3 matches played"
          rows={sorted.avgGoals.map(p => ({ player_id: p.player_id, player_name: p.player_name, value: Number(p.avg_goals_per_match ?? 0).toFixed(2), sub: `${p.matches_played} GP` }))}
        />
        <Table
          title="Shot Conversion"
          valueLabel="Conv %"
          note="Min 5 shots taken"
          rows={sorted.conversion.map(p => ({
            player_id: p.player_id,
            player_name: p.player_name,
            value: `${((p.career_shot_conversion ?? 0) * 100).toFixed(1)}%`,
            sub: `${p.total_shots} shots`,
          }))}
        />
        <Table
          title="Most Shots"
          valueLabel="Shots"
          rows={sorted.shots.map(p => ({ player_id: p.player_id, player_name: p.player_name, value: p.total_shots ?? 0 }))}
        />
        <Table
          title="Top Tacklers"
          valueLabel="Tackles"
          rows={sorted.tackles.map(p => ({ player_id: p.player_id, player_name: p.player_name, value: p.total_tackles ?? 0 }))}
        />
        <Table
          title="Energy Warriors"
          valueLabel="Avg Min ⚡"
          note="Average lowest energy reached per match — higher = better stamina"
          rows={sorted.energy.map(p => ({
            player_id: p.player_id,
            player_name: p.player_name,
            value: avgMinEnergy[p.player_id]?.toFixed(1) ?? '—',
          }))}
        />
        <Table
          title="Most Experienced"
          valueLabel="Matches"
          rows={sorted.veteran.map(p => ({ player_id: p.player_id, player_name: p.player_name, value: p.matches_played }))}
        />
      </div>
    </div>
  )
}
