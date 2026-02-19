/**
 * Global Search — players and matches
 */

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

const DS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = (q ?? '').trim()

  if (!query) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold text-white mb-4">Search</h1>
        <form method="get" action="/search">
          <input
            name="q"
            type="search"
            autoFocus
            placeholder="Search players or teams…"
            className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-gray-200 placeholder-gray-600 focus:border-gray-500 focus:outline-none text-sm"
          />
        </form>
      </div>
    )
  }

  const db = createServerClient()

  const [playersResult, teamsResult] = await Promise.all([
    db
      .from('player_career_stats')
      .select('player_id, player_name, matches_played, total_goals, team_id')
      .eq('team_id', DS_TEAM_ID)
      .ilike('player_name', `%${query}%`)
      .limit(10),
    db
      .from('teams')
      .select('id, name')
      .ilike('name', `%${query}%`)
      .limit(10),
  ])

  const players = playersResult.data ?? []
  const teams = teamsResult.data ?? []

  // Find recent matches involving those teams
  const matchTeamIds = teams.map(t => t.id)
  const teamNames: Record<string, string> = Object.fromEntries(teams.map(t => [t.id, t.name]))

  let matches: { id: string; scheduled_time: string; home_team_id: string; away_team_id: string; home_score: number | null; away_score: number | null }[] = []
  if (matchTeamIds.length > 0) {
    const { data: homeMatches } = await db
      .from('matches')
      .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score')
      .in('home_team_id', matchTeamIds)
      .eq('involves_deadly_sins', true)
      .order('scheduled_time', { ascending: false })
      .limit(10)
    const { data: awayMatches } = await db
      .from('matches')
      .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score')
      .in('away_team_id', matchTeamIds)
      .eq('involves_deadly_sins', true)
      .order('scheduled_time', { ascending: false })
      .limit(10)

    // Merge and fetch team names for all teams in results
    const combined = [...(homeMatches ?? []), ...(awayMatches ?? [])]
    const allTeamIds = new Set(combined.flatMap(m => [m.home_team_id, m.away_team_id]))
    const { data: allTeams } = await db.from('teams').select('id, name').in('id', [...allTeamIds])
    for (const t of allTeams ?? []) teamNames[t.id] = t.name
    matches = combined.sort((a, b) => b.scheduled_time.localeCompare(a.scheduled_time)).slice(0, 10)
  }

  const totalResults = players.length + matches.length
  const dsTeamName = 'Deadly Sins'

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Search results</h1>
        <p className="mt-1 text-sm text-gray-500">
          {totalResults === 0 ? 'No results for' : `${totalResults} result${totalResults !== 1 ? 's' : ''} for`}{' '}
          <span className="text-gray-300">&ldquo;{query}&rdquo;</span>
        </p>
      </div>

      {/* Search bar */}
      <form method="get" action="/search" className="mb-8">
        <input
          name="q"
          type="search"
          defaultValue={query}
          className="w-full rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-gray-200 placeholder-gray-600 focus:border-gray-500 focus:outline-none text-sm"
        />
      </form>

      {/* Players */}
      {players.length > 0 && (
        <section className="mb-8">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-500">Players</h2>
          <div className="rounded-lg border border-gray-800 overflow-hidden">
            {players.map((p) => (
              <Link
                key={p.player_id}
                href={`/players/${p.player_id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-gray-900 transition-colors border-b border-gray-800 last:border-0"
              >
                <div>
                  <p className="text-sm font-medium text-gray-200">{p.player_name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Deadly Sins · {p.matches_played} matches</p>
                </div>
                <span className="text-xs text-gray-600">{p.total_goals ?? 0} goals →</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* Matches */}
      {matches.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-500">Matches</h2>
          <div className="rounded-lg border border-gray-800 overflow-hidden">
            {matches.map((m) => {
              const isHome = m.home_team_id === DS_TEAM_ID
              const oppId = isHome ? m.away_team_id : m.home_team_id
              const oppName = teamNames[oppId] ?? 'Unknown'
              const dsScore = isHome ? m.home_score : m.away_score
              const oppScore = isHome ? m.away_score : m.home_score

              let resultColor = 'text-gray-400'
              let resultLabel = '—'
              if (dsScore !== null && oppScore !== null) {
                if (dsScore > oppScore) { resultColor = 'text-emerald-400'; resultLabel = 'W' }
                else if (dsScore < oppScore) { resultColor = 'text-red-400'; resultLabel = 'L' }
                else { resultColor = 'text-yellow-400'; resultLabel = 'D' }
              }

              return (
                <Link
                  key={m.id}
                  href={`/matches/${m.id}`}
                  className="flex items-center justify-between px-4 py-3 hover:bg-gray-900 transition-colors border-b border-gray-800 last:border-0"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-200">
                      {dsTeamName} {isHome ? 'vs' : '@'} {oppName}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">{formatDate(m.scheduled_time)}</p>
                  </div>
                  <div className="text-right">
                    <span className={`font-bold text-sm ${resultColor}`}>{resultLabel}</span>
                    {dsScore !== null && oppScore !== null && (
                      <span className="ml-1 text-xs text-gray-500">
                        {isHome ? `${dsScore}–${oppScore}` : `${oppScore}–${dsScore}`}
                      </span>
                    )}
                  </div>
                </Link>
              )
            })}
          </div>
        </section>
      )}

      {totalResults === 0 && (
        <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-10 text-center">
          <p className="text-gray-500 text-sm">No players or matches found for &ldquo;{query}&rdquo;</p>
        </div>
      )}
    </div>
  )
}
