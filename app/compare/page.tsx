/**
 * Player Comparison — side-by-side career stats and energy history
 */

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const DS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'

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
  avg_goals_per_match: number | null
  avg_tackles_per_match: number | null
}

interface PlayerEnergy {
  player_id: string
  match_id: string
  final_energy: number
  scheduled_time: string
}

async function getAllPlayers() {
  const db = createServerClient()
  const { data } = await db
    .from('player_career_stats')
    .select('player_id, player_name, matches_played, total_goals, total_shots, total_tackles, total_passes, total_blocks, total_fouls, career_shot_conversion, avg_goals_per_match, avg_tackles_per_match')
    .eq('team_id', DS_TEAM_ID)
    .order('player_name')
  return (data ?? []) as CareerStats[]
}

async function getPlayerStats(playerId: string): Promise<CareerStats | null> {
  const db = createServerClient()
  const { data } = await db
    .from('player_career_stats')
    .select('player_id, player_name, matches_played, total_goals, total_shots, total_tackles, total_passes, total_blocks, total_fouls, career_shot_conversion, avg_goals_per_match, avg_tackles_per_match')
    .eq('player_id', playerId)
    .eq('team_id', DS_TEAM_ID)
    .maybeSingle()
  return data as CareerStats | null
}

async function getPlayerEnergyHistory(playerId: string): Promise<PlayerEnergy[]> {
  const db = createServerClient()

  const { data: matchStats } = await db
    .from('player_match_stats')
    .select('match_id')
    .eq('player_id', playerId)

  const matchIds = (matchStats ?? []).map(s => s.match_id)
  if (matchIds.length === 0) return []

  const { data: matches } = await db
    .from('matches')
    .select('id, scheduled_time')
    .in('id', matchIds)
    .order('scheduled_time', { ascending: true })

  const results: PlayerEnergy[] = []
  for (const m of matches ?? []) {
    const { data: snap } = await db
      .from('energy_snapshots')
      .select('energy')
      .eq('match_id', m.id)
      .eq('player_id', playerId)
      .order('turn', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (snap) results.push({ player_id: playerId, match_id: m.id, final_energy: snap.energy, scheduled_time: m.scheduled_time })
  }
  return results
}

function getEnergyColor(e: number) {
  if (e >= 60) return 'bg-emerald-500'
  if (e >= 30) return 'bg-yellow-500'
  if (e >= 10) return 'bg-orange-500'
  return 'bg-red-600'
}

function StatBar({ label, aVal, bVal, aName, bName, higherIsBetter = true }: {
  label: string
  aVal: number
  bVal: number
  aName: string
  bName: string
  higherIsBetter?: boolean
}) {
  const max = Math.max(aVal, bVal, 1)
  const aWins = higherIsBetter ? aVal >= bVal : aVal <= bVal
  const bWins = higherIsBetter ? bVal >= aVal : bVal <= aVal
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-1.5">
      {/* A bar */}
      <div className="flex items-center gap-2 justify-end">
        <span className={`text-sm font-medium ${aWins && aVal !== bVal ? 'text-emerald-400' : 'text-gray-300'}`}>{aVal}</span>
        <div className="h-2 rounded-full bg-gray-800 w-24 overflow-hidden">
          <div className={`h-full rounded-full ${aWins && aVal !== bVal ? 'bg-emerald-500' : 'bg-gray-600'}`} style={{ width: `${(aVal / max) * 100}%`, marginLeft: 'auto' }} />
        </div>
      </div>
      {/* Label */}
      <span className="text-xs text-gray-500 text-center whitespace-nowrap">{label}</span>
      {/* B bar */}
      <div className="flex items-center gap-2">
        <div className="h-2 rounded-full bg-gray-800 w-24 overflow-hidden">
          <div className={`h-full rounded-full ${bWins && aVal !== bVal ? 'bg-emerald-500' : 'bg-gray-600'}`} style={{ width: `${(bVal / max) * 100}%` }} />
        </div>
        <span className={`text-sm font-medium ${bWins && aVal !== bVal ? 'text-emerald-400' : 'text-gray-300'}`}>{bVal}</span>
      </div>
    </div>
  )
}

function MiniEnergyChart({ history, color }: { history: PlayerEnergy[]; color: string }) {
  if (history.length === 0) return <p className="text-xs text-gray-600 italic">No energy data</p>
  const last15 = history.slice(-15)
  return (
    <div className="flex items-end gap-1 h-12">
      {last15.map((h) => (
        <div
          key={h.match_id}
          className={`flex-1 rounded-t ${getEnergyColor(h.final_energy)}`}
          style={{ height: `${Math.max(h.final_energy, 2)}%` }}
          title={`${h.final_energy} energy`}
        />
      ))}
    </div>
  )
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>
}) {
  const { a, b } = await searchParams
  const allPlayers = await getAllPlayers()

  // No selection — show player picker
  if (!a) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white mb-2">Compare Players</h1>
        <p className="text-sm text-gray-500 mb-6">Select two players to compare side-by-side.</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {allPlayers.map((p) => (
            <Link
              key={p.player_id}
              href={`/compare?a=${p.player_id}`}
              className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 hover:border-gray-600 transition-colors"
            >
              <p className="text-sm font-medium text-gray-200">{p.player_name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{p.matches_played} matches</p>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  // One player selected — show "select second"
  if (a && !b) {
    const playerA = allPlayers.find(p => p.player_id === a)
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="rounded-lg border border-emerald-800 bg-emerald-950 px-4 py-2 text-sm font-medium text-emerald-300">
            {playerA?.player_name ?? 'Player A'} selected
          </div>
          <span className="text-gray-600 text-sm">vs</span>
          <span className="text-gray-500 text-sm">Select opponent…</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
          {allPlayers.filter(p => p.player_id !== a).map((p) => (
            <Link
              key={p.player_id}
              href={`/compare?a=${a}&b=${p.player_id}`}
              className="rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 hover:border-gray-600 transition-colors"
            >
              <p className="text-sm font-medium text-gray-200">{p.player_name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{p.matches_played} matches</p>
            </Link>
          ))}
        </div>
      </div>
    )
  }

  // Both players selected — show comparison
  const [statsA, statsB, energyA, energyB] = await Promise.all([
    getPlayerStats(a!),
    getPlayerStats(b!),
    getPlayerEnergyHistory(a!),
    getPlayerEnergyHistory(b!),
  ])

  if (!statsA || !statsB) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-red-400">One or both players not found. <Link href="/compare" className="underline">Start over</Link></p>
      </div>
    )
  }

  const avgEnergyA = energyA.length > 0 ? energyA.reduce((s, e) => s + e.final_energy, 0) / energyA.length : null
  const avgEnergyB = energyB.length > 0 ? energyB.reduce((s, e) => s + e.final_energy, 0) / energyB.length : null

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      {/* Header */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mb-8">
        <div className="text-center">
          <Link href={`/players/${statsA.player_id}`} className="text-lg font-bold text-white hover:text-gray-300 transition-colors">
            {statsA.player_name}
          </Link>
          <p className="text-xs text-gray-500 mt-0.5">{statsA.matches_played} matches</p>
        </div>
        <div className="text-center">
          <span className="text-xl text-gray-600">vs</span>
          <div className="mt-2">
            <Link href="/compare" className="text-xs text-gray-600 hover:text-gray-400 transition-colors">Change</Link>
          </div>
        </div>
        <div className="text-center">
          <Link href={`/players/${statsB.player_id}`} className="text-lg font-bold text-white hover:text-gray-300 transition-colors">
            {statsB.player_name}
          </Link>
          <p className="text-xs text-gray-500 mt-0.5">{statsB.matches_played} matches</p>
        </div>
      </div>

      {/* Energy charts */}
      <section className="mb-8">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">End-of-Match Energy (last 15)</h2>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs text-gray-500 mb-3">{statsA.player_name}</p>
            <MiniEnergyChart history={energyA} color="emerald" />
            {avgEnergyA !== null && <p className="text-xs text-gray-500 mt-2">Avg: <span className="text-gray-300">{avgEnergyA.toFixed(1)}</span></p>}
          </div>
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
            <p className="text-xs text-gray-500 mb-3">{statsB.player_name}</p>
            <MiniEnergyChart history={energyB} color="blue" />
            {avgEnergyB !== null && <p className="text-xs text-gray-500 mt-2">Avg: <span className="text-gray-300">{avgEnergyB.toFixed(1)}</span></p>}
          </div>
        </div>
      </section>

      {/* Stat bars */}
      <section>
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Career Stats</h2>
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-4 divide-y divide-gray-800">
          <StatBar label="Matches" aVal={statsA.matches_played} bVal={statsB.matches_played} aName={statsA.player_name} bName={statsB.player_name} />
          <StatBar label="Goals" aVal={statsA.total_goals ?? 0} bVal={statsB.total_goals ?? 0} aName={statsA.player_name} bName={statsB.player_name} />
          <StatBar label="Shots" aVal={statsA.total_shots ?? 0} bVal={statsB.total_shots ?? 0} aName={statsA.player_name} bName={statsB.player_name} />
          <StatBar label="Tackles" aVal={statsA.total_tackles ?? 0} bVal={statsB.total_tackles ?? 0} aName={statsA.player_name} bName={statsB.player_name} />
          <StatBar label="Passes" aVal={statsA.total_passes ?? 0} bVal={statsB.total_passes ?? 0} aName={statsA.player_name} bName={statsB.player_name} />
          <StatBar label="Blocks" aVal={statsA.total_blocks ?? 0} bVal={statsB.total_blocks ?? 0} aName={statsA.player_name} bName={statsB.player_name} />
          <StatBar label="Fouls" aVal={statsA.total_fouls ?? 0} bVal={statsB.total_fouls ?? 0} aName={statsA.player_name} bName={statsB.player_name} higherIsBetter={false} />
        </div>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr] gap-2 text-center text-xs text-gray-500">
          <span>G/GP: <span className="text-gray-300">{Number(statsA.avg_goals_per_match ?? 0).toFixed(2)}</span></span>
          <span />
          <span>G/GP: <span className="text-gray-300">{Number(statsB.avg_goals_per_match ?? 0).toFixed(2)}</span></span>
        </div>
      </section>
    </div>
  )
}
