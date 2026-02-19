/**
 * Opponent Scouting Page
 *
 * Shows opponent performance in all matches they've played against DS.
 * Includes H2H record, top performers, and match history.
 */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createServerClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const DS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function ScoutingPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const db = createServerClient()

  // Team info
  const { data: team } = await db.from('teams').select('id, name').eq('id', teamId).maybeSingle()
  if (!team) notFound()

  // All DS matches against this team
  const { data: matchesRaw } = await db
    .from('matches')
    .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score, replay_fetched, status')
    .eq('involves_deadly_sins', true)
    .or(`home_team_id.eq.${teamId},away_team_id.eq.${teamId}`)
    .order('scheduled_time', { ascending: false })

  const matches = (matchesRaw ?? []).filter(
    m => m.home_team_id === DS_TEAM_ID || m.away_team_id === DS_TEAM_ID
  ).filter(
    m => m.home_team_id === teamId || m.away_team_id === teamId
  )

  // H2H record
  let wins = 0, losses = 0, draws = 0
  for (const m of matches) {
    const isHome = m.home_team_id === DS_TEAM_ID
    const dsScore = isHome ? m.home_score : m.away_score
    const oppScore = isHome ? m.away_score : m.home_score
    if (dsScore !== null && oppScore !== null) {
      if (dsScore > oppScore) wins++
      else if (dsScore < oppScore) losses++
      else draws++
    }
  }

  // Opponent player stats across those matches (replayed matches only)
  const replayedIds = matches.filter(m => m.replay_fetched).map(m => m.id)

  let opponentStats: {
    player_id: string
    player_name: string
    goals: number
    shots: number
    tackles: number
    fouls: number
    gp: number
  }[] = []

  if (replayedIds.length > 0) {
    const { data: statsRaw } = await db
      .from('player_match_stats')
      .select('player_id, player_name, goals, shots, tackles, fouls, match_id')
      .in('match_id', replayedIds)
      .eq('team_id', teamId)

    // Aggregate by player
    const agg: Record<string, typeof opponentStats[0]> = {}
    for (const s of statsRaw ?? []) {
      if (!agg[s.player_id]) {
        agg[s.player_id] = { player_id: s.player_id, player_name: s.player_name, goals: 0, shots: 0, tackles: 0, fouls: 0, gp: 0 }
      }
      agg[s.player_id].goals += s.goals
      agg[s.player_id].shots += s.shots
      agg[s.player_id].tackles += s.tackles
      agg[s.player_id].fouls += s.fouls
      agg[s.player_id].gp++
    }
    opponentStats = Object.values(agg)
  }

  const topScorers = [...opponentStats].sort((a, b) => b.goals - a.goals).slice(0, 5)
  const topTacklers = [...opponentStats].sort((a, b) => b.tackles - a.tackles).slice(0, 5)
  const foulRisk = [...opponentStats]
    .filter(p => p.tackles > 0)
    .sort((a, b) => (b.fouls / b.tackles) - (a.fouls / a.tackles))
    .slice(0, 5)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      {/* Back */}
      <Link href="/dashboard" className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-300 transition-colors">
        ← Dashboard
      </Link>

      {/* Header */}
      <div className="mt-4 mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{team.name}</h1>
          <p className="mt-1 text-sm text-gray-500">Scouting report — {matches.length} match{matches.length !== 1 ? 'es' : ''} vs Deadly Sins</p>
        </div>
        {matches.length > 0 && (
          <div className="flex gap-3 text-sm shrink-0">
            <span className="rounded-full bg-emerald-950 px-3 py-1 text-emerald-400 font-medium">{wins}W</span>
            <span className="rounded-full bg-yellow-950 px-3 py-1 text-yellow-400 font-medium">{draws}D</span>
            <span className="rounded-full bg-red-950 px-3 py-1 text-red-400 font-medium">{losses}L</span>
          </div>
        )}
      </div>

      {matches.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-10 text-center">
          <p className="text-gray-500 text-sm">No DS matches found against {team.name}.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
          <div className="lg:col-span-2 space-y-8">
            {/* Top performers */}
            {opponentStats.length > 0 ? (
              <>
                <section>
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Top Scorers vs DS</h2>
                  <div className="rounded-lg border border-gray-800 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-900">
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Player</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">GP</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Goals</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Shots</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">G/GP</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {topScorers.map(p => (
                          <tr key={p.player_id} className="bg-gray-950">
                            <td className="px-4 py-2.5 text-gray-300">{p.player_name}</td>
                            <td className="px-4 py-2.5 text-center text-gray-400">{p.gp}</td>
                            <td className="px-4 py-2.5 text-center font-medium text-gray-200">{p.goals}</td>
                            <td className="px-4 py-2.5 text-center text-gray-400">{p.shots}</td>
                            <td className="px-4 py-2.5 text-center text-gray-400">{(p.goals / p.gp).toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section>
                  <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Foul Risk Players</h2>
                  <div className="rounded-lg border border-gray-800 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-800 bg-gray-900">
                          <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Player</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Fouls</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Tackles</th>
                          <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Foul Rate</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-800">
                        {foulRisk.map(p => (
                          <tr key={p.player_id} className="bg-gray-950">
                            <td className="px-4 py-2.5 text-gray-300">{p.player_name}</td>
                            <td className="px-4 py-2.5 text-center text-gray-400">{p.fouls}</td>
                            <td className="px-4 py-2.5 text-center text-gray-400">{p.tackles}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={p.fouls / p.tackles > 0.3 ? 'text-red-400 font-medium' : 'text-gray-400'}>
                                {((p.fouls / p.tackles) * 100).toFixed(0)}%
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-1.5 text-xs text-gray-600">Foul rate = fouls ÷ tackles. &gt;30% = high risk.</p>
                </section>
              </>
            ) : (
              <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-6">
                <p className="text-sm text-gray-600 italic">Opponent player stats available only for replayed matches.</p>
              </div>
            )}
          </div>

          {/* Match history sidebar */}
          <div>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Match History</h2>
            <div className="space-y-2">
              {matches.map(m => {
                const isHome = m.home_team_id === DS_TEAM_ID
                const dsScore = isHome ? m.home_score : m.away_score
                const oppScore = isHome ? m.away_score : m.home_score
                let label = '—'; let color = 'text-gray-400'
                if (dsScore !== null && oppScore !== null) {
                  if (dsScore > oppScore) { label = 'W'; color = 'text-emerald-400' }
                  else if (dsScore < oppScore) { label = 'L'; color = 'text-red-400' }
                  else { label = 'D'; color = 'text-yellow-400' }
                }
                return (
                  <Link key={m.id} href={`/matches/${m.id}`}
                    className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-4 py-3 hover:border-gray-600 transition-colors">
                    <div>
                      <p className="text-xs text-gray-500">{isHome ? 'Home' : 'Away'} · {formatDate(m.scheduled_time)}</p>
                      {!m.replay_fetched && <p className="text-xs text-gray-700 mt-0.5">No replay</p>}
                    </div>
                    <div className="text-right">
                      <span className={`font-bold ${color}`}>{label}</span>
                      {dsScore !== null && oppScore !== null && (
                        <p className="text-xs text-gray-500">{isHome ? `${dsScore}–${oppScore}` : `${oppScore}–${dsScore}`}</p>
                      )}
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
