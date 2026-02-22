/**
 * League Stats — Leaderboard, Player Comparison, Team Comparison
 *
 * Covers every team and player from all matches in the database.
 * Mode controlled by ?mode= URL param.
 */

import Link from 'next/link'
import { createServerClient } from '@/lib/supabase/client'

export const dynamic = 'force-dynamic'

// ============================================================
// Types
// ============================================================

interface LeaguePlayer {
  player_id: string
  player_name: string
  team_id: string
  team_name: string
  matches_played: number
  total_goals: number | null
  total_shots: number | null
  total_passes: number | null
  total_tackles: number | null
  total_blocks: number | null
  total_fouls: number | null
  career_shot_conversion: number | null
  career_foul_rate: number | null
  avg_goals_per_match: number | null
  avg_shots_per_match: number | null
  avg_passes_per_match: number | null
  avg_tackles_per_match: number | null
}

interface TeamStats {
  team_id: string
  team_name: string
  matches_played: number
  total_goals: number
  total_shots: number
  total_passes: number
  total_tackles: number
  total_fouls: number
  shot_pct: number | null
  foul_rate: number | null
}

type StatKey = 'goals' | 'gpm' | 'shots' | 'shot_pct' | 'tackles' | 'passes'
type Mode = 'leaderboard' | 'compare-players' | 'compare-teams'
type LeaderTab = 'players' | 'teams'

const STAT_LABELS: Record<StatKey, string> = {
  goals: 'Goals', gpm: 'G/Match', shots: 'Shots',
  shot_pct: 'Shot%', tackles: 'Tackles', passes: 'Passes',
}

function getStatValue(p: LeaguePlayer, stat: StatKey): number {
  switch (stat) {
    case 'goals':    return p.total_goals ?? 0
    case 'gpm':      return p.avg_goals_per_match ?? 0
    case 'shots':    return p.total_shots ?? 0
    case 'shot_pct': return p.career_shot_conversion ?? 0
    case 'tackles':  return p.total_tackles ?? 0
    case 'passes':   return p.total_passes ?? 0
  }
}

function fmtStat(val: number, stat: StatKey): string {
  if (stat === 'gpm')      return val.toFixed(2)
  if (stat === 'shot_pct') return `${(val * 100).toFixed(0)}%`
  return String(val)
}

// ============================================================
// Data
// ============================================================

async function getAllPlayers(): Promise<LeaguePlayer[]> {
  const db = createServerClient()
  const { data } = await db
    .from('player_career_stats')
    .select('player_id, player_name, team_id, team_name, matches_played, total_goals, total_shots, total_passes, total_tackles, total_blocks, total_fouls, career_shot_conversion, career_foul_rate, avg_goals_per_match, avg_shots_per_match, avg_passes_per_match, avg_tackles_per_match')
    .order('total_goals', { ascending: false })
  return (data ?? []) as LeaguePlayer[]
}

function buildTeamStats(players: LeaguePlayer[]): TeamStats[] {
  const map = new Map<string, TeamStats>()
  for (const p of players) {
    const t = map.get(p.team_id)
    if (!t) {
      map.set(p.team_id, {
        team_id: p.team_id, team_name: p.team_name,
        matches_played: p.matches_played,
        total_goals: p.total_goals ?? 0,
        total_shots: p.total_shots ?? 0,
        total_passes: p.total_passes ?? 0,
        total_tackles: p.total_tackles ?? 0,
        total_fouls: p.total_fouls ?? 0,
        shot_pct: null, foul_rate: null,
      })
    } else {
      t.matches_played = Math.max(t.matches_played, p.matches_played)
      t.total_goals   += p.total_goals   ?? 0
      t.total_shots   += p.total_shots   ?? 0
      t.total_passes  += p.total_passes  ?? 0
      t.total_tackles += p.total_tackles ?? 0
      t.total_fouls   += p.total_fouls   ?? 0
    }
  }
  for (const t of map.values()) {
    t.shot_pct  = t.total_shots   > 0 ? t.total_goals  / t.total_shots   : null
    t.foul_rate = t.total_tackles > 0 ? t.total_fouls  / t.total_tackles : null
  }
  return [...map.values()]
}

// ============================================================
// Helpers
// ============================================================

function pct(val: number | null) {
  return val === null ? '—' : `${(val * 100).toFixed(0)}%`
}

// ============================================================
// StatBar (for side-by-side comparisons)
// ============================================================

function StatBar({
  label, aVal, bVal, fmt = String, higherIsBetter = true,
}: {
  label: string
  aVal: number
  bVal: number
  fmt?: (v: number) => string
  higherIsBetter?: boolean
}) {
  const max = Math.max(aVal, bVal, 1)
  const aWins = higherIsBetter ? aVal > bVal : aVal < bVal
  const bWins = higherIsBetter ? bVal > aVal : bVal < aVal
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 py-2">
      <div className="flex items-center gap-2 justify-end">
        <span className={`text-sm font-medium ${aWins ? 'text-emerald-400' : 'text-gray-300'}`}>{fmt(aVal)}</span>
        <div className="h-2 rounded-full bg-gray-800 w-24 overflow-hidden flex justify-end">
          <div className={`h-full rounded-full ${aWins ? 'bg-emerald-500' : 'bg-gray-600'}`} style={{ width: `${(aVal / max) * 100}%` }} />
        </div>
      </div>
      <span className="text-xs text-gray-500 text-center w-20 whitespace-nowrap">{label}</span>
      <div className="flex items-center gap-2">
        <div className="h-2 rounded-full bg-gray-800 w-24 overflow-hidden">
          <div className={`h-full rounded-full ${bWins ? 'bg-emerald-500' : 'bg-gray-600'}`} style={{ width: `${(bVal / max) * 100}%` }} />
        </div>
        <span className={`text-sm font-medium ${bWins ? 'text-emerald-400' : 'text-gray-300'}`}>{fmt(bVal)}</span>
      </div>
    </div>
  )
}

// ============================================================
// Leaderboard views
// ============================================================

function PlayerLeaderboard({ players, stat }: { players: LeaguePlayer[]; stat: StatKey }) {
  const rows = players
    .filter(p => p.matches_played >= 3)
    .sort((a, b) => getStatValue(b, stat) - getStatValue(a, stat))
    .slice(0, 25)

  if (rows.length === 0) return <p className="text-sm text-gray-600 italic">No data yet.</p>

  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide bg-gray-900">
            <th className="px-4 py-2.5 text-left w-8">#</th>
            <th className="px-4 py-2.5 text-left">Player</th>
            <th className="px-4 py-2.5 text-left">Team</th>
            <th className="px-4 py-2.5 text-right font-semibold text-gray-300">{STAT_LABELS[stat]}</th>
            <th className="px-4 py-2.5 text-right">GP</th>
            <th className="hidden md:table-cell px-4 py-2.5 text-right">Goals</th>
            <th className="hidden md:table-cell px-4 py-2.5 text-right">Tackles</th>
            <th className="hidden lg:table-cell px-4 py-2.5 text-right">Shot%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {rows.map((p, i) => (
            <tr key={p.player_id} className="hover:bg-gray-800/40 transition-colors">
              <td className="px-4 py-2.5 text-gray-600 text-xs">{i + 1}</td>
              <td className="px-4 py-2.5">
                <Link href={`/players/${p.player_id}`} className="font-medium text-gray-200 hover:text-white transition-colors">
                  {p.player_name}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-xs text-gray-400">{p.team_name}</td>
              <td className="px-4 py-2.5 text-right font-semibold text-white">
                {fmtStat(getStatValue(p, stat), stat)}
              </td>
              <td className="px-4 py-2.5 text-right text-gray-500">{p.matches_played}</td>
              <td className="hidden md:table-cell px-4 py-2.5 text-right text-gray-500">{p.total_goals ?? 0}</td>
              <td className="hidden md:table-cell px-4 py-2.5 text-right text-gray-500">{p.total_tackles ?? 0}</td>
              <td className="hidden lg:table-cell px-4 py-2.5 text-right text-gray-500">{pct(p.career_shot_conversion)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function TeamLeaderboard({ teams }: { teams: TeamStats[] }) {
  const rows = [...teams].sort((a, b) => b.total_goals - a.total_goals).slice(0, 30)

  if (rows.length === 0) return <p className="text-sm text-gray-600 italic">No data yet.</p>

  return (
    <div className="rounded-lg border border-gray-800 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-800 text-xs text-gray-500 uppercase tracking-wide bg-gray-900">
            <th className="px-4 py-2.5 text-left w-8">#</th>
            <th className="px-4 py-2.5 text-left">Team</th>
            <th className="px-4 py-2.5 text-right font-semibold text-gray-300">Goals</th>
            <th className="px-4 py-2.5 text-right">Shot%</th>
            <th className="hidden md:table-cell px-4 py-2.5 text-right">Shots</th>
            <th className="hidden md:table-cell px-4 py-2.5 text-right">Tackles</th>
            <th className="hidden lg:table-cell px-4 py-2.5 text-right">Passes</th>
            <th className="hidden lg:table-cell px-4 py-2.5 text-right">Foul%</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">
          {rows.map((t, i) => (
            <tr key={t.team_id} className="hover:bg-gray-800/40 transition-colors">
              <td className="px-4 py-2.5 text-gray-600 text-xs">{i + 1}</td>
              <td className="px-4 py-2.5">
                <Link href={`/scouting/${t.team_id}`} className="font-medium text-gray-200 hover:text-white transition-colors">
                  {t.team_name}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-right font-semibold text-white">{t.total_goals}</td>
              <td className="px-4 py-2.5 text-right text-gray-300">{pct(t.shot_pct)}</td>
              <td className="hidden md:table-cell px-4 py-2.5 text-right text-gray-500">{t.total_shots}</td>
              <td className="hidden md:table-cell px-4 py-2.5 text-right text-gray-500">{t.total_tackles}</td>
              <td className="hidden lg:table-cell px-4 py-2.5 text-right text-gray-500">{t.total_passes}</td>
              <td className="hidden lg:table-cell px-4 py-2.5 text-right text-gray-500">{pct(t.foul_rate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-4 py-2 text-xs text-gray-700 border-t border-gray-800">
        Cumulative totals across all matches in DB
      </p>
    </div>
  )
}

// ============================================================
// Picker forms (plain HTML forms — no client JS required)
// ============================================================

function PlayerPickerForm({ players, a, b }: { players: LeaguePlayer[]; a?: string; b?: string }) {
  return (
    <form method="get" action="/compare" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="mode" value="compare-players" />
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">Player A</label>
        <select name="a" defaultValue={a ?? ''} className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-gray-500 focus:outline-none w-60">
          <option value="">Select player…</option>
          {players.map(p => (
            <option key={p.player_id} value={p.player_id}>{p.player_name} ({p.team_name})</option>
          ))}
        </select>
      </div>
      <span className="text-gray-600 pb-2 text-sm">vs</span>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">Player B</label>
        <select name="b" defaultValue={b ?? ''} className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-gray-500 focus:outline-none w-60">
          <option value="">Select player…</option>
          {players.map(p => (
            <option key={p.player_id} value={p.player_id}>{p.player_name} ({p.team_name})</option>
          ))}
        </select>
      </div>
      <button type="submit" className="rounded border border-gray-600 bg-gray-800 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors">
        Compare
      </button>
    </form>
  )
}

function TeamPickerForm({ teams, a, b }: { teams: TeamStats[]; a?: string; b?: string }) {
  const sorted = [...teams].sort((x, y) => x.team_name.localeCompare(y.team_name))
  return (
    <form method="get" action="/compare" className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="mode" value="compare-teams" />
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">Team A</label>
        <select name="a" defaultValue={a ?? ''} className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-gray-500 focus:outline-none w-60">
          <option value="">Select team…</option>
          {sorted.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
        </select>
      </div>
      <span className="text-gray-600 pb-2 text-sm">vs</span>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">Team B</label>
        <select name="b" defaultValue={b ?? ''} className="rounded border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 focus:border-gray-500 focus:outline-none w-60">
          <option value="">Select team…</option>
          {sorted.map(t => <option key={t.team_id} value={t.team_id}>{t.team_name}</option>)}
        </select>
      </div>
      <button type="submit" className="rounded border border-gray-600 bg-gray-800 px-4 py-2 text-sm text-gray-200 hover:bg-gray-700 transition-colors">
        Compare
      </button>
    </form>
  )
}

// ============================================================
// Page
// ============================================================

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const params = await searchParams
  const mode    = (params.mode ?? 'leaderboard') as Mode
  const tab     = (params.tab  ?? 'players')     as LeaderTab
  const stat    = (params.stat ?? 'goals')        as StatKey
  const paramA  = params.a
  const paramB  = params.b

  const allPlayers = await getAllPlayers()
  const allTeams   = buildTeamStats(allPlayers)

  // Navigation helpers
  function modeHref(m: Mode) {
    return `/compare?mode=${m}`
  }
  function tabHref(t: LeaderTab) {
    return `/compare?mode=leaderboard&tab=${t}&stat=${stat}`
  }
  function statHref(s: StatKey) {
    return `/compare?mode=leaderboard&tab=${tab}&stat=${s}`
  }

  const modeTabs: { key: Mode; label: string }[] = [
    { key: 'leaderboard',    label: 'Leaderboard'    },
    { key: 'compare-players', label: 'Compare Players' },
    { key: 'compare-teams',  label: 'Compare Teams'  },
  ]

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      {/* Page title */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">League Stats</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          All {allPlayers.length} players · {allTeams.length} teams · across all matches in DB
        </p>
      </div>

      {/* Mode tabs */}
      <div className="flex gap-1 mb-8 border-b border-gray-800">
        {modeTabs.map(({ key, label }) => (
          <Link
            key={key}
            href={modeHref(key)}
            className={`px-4 py-2 text-sm font-medium rounded-t transition-colors ${
              mode === key
                ? 'text-white border-b-2 border-white -mb-px'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* ── LEADERBOARD ── */}
      {mode === 'leaderboard' && (
        <div>
          {/* Player / Team sub-tabs */}
          <div className="flex gap-2 mb-4">
            {(['players', 'teams'] as LeaderTab[]).map(t => (
              <Link
                key={t}
                href={tabHref(t)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  tab === t
                    ? 'bg-gray-700 text-white'
                    : 'text-gray-500 hover:text-gray-300'
                }`}
              >
                {t === 'players' ? 'Players' : 'Teams'}
              </Link>
            ))}
          </div>

          {/* Stat picker (players only) */}
          {tab === 'players' && (
            <div className="flex flex-wrap gap-1.5 mb-4">
              <span className="text-xs text-gray-600 self-center mr-1">Sort by:</span>
              {(Object.keys(STAT_LABELS) as StatKey[]).map(s => (
                <Link
                  key={s}
                  href={statHref(s)}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    stat === s
                      ? 'bg-gray-700 text-white'
                      : 'text-gray-500 hover:text-gray-300 border border-gray-800'
                  }`}
                >
                  {STAT_LABELS[s]}
                </Link>
              ))}
              <span className="text-xs text-gray-700 self-center ml-2">min 3 GP</span>
            </div>
          )}

          {tab === 'players'
            ? <PlayerLeaderboard players={allPlayers} stat={stat} />
            : <TeamLeaderboard teams={allTeams} />
          }
        </div>
      )}

      {/* ── COMPARE PLAYERS ── */}
      {mode === 'compare-players' && (
        <div>
          <div className="mb-6">
            <PlayerPickerForm players={allPlayers} a={paramA} b={paramB} />
          </div>

          {(() => {
            if (!paramA || !paramB) return (
              <p className="text-sm text-gray-600">Select two players above to compare.</p>
            )
            const pA = allPlayers.find(p => p.player_id === paramA)
            const pB = allPlayers.find(p => p.player_id === paramB)
            if (!pA || !pB) return (
              <p className="text-sm text-red-400">Player not found. <Link href="/compare?mode=compare-players" className="underline">Reset</Link></p>
            )

            const gpmFmt = (v: number) => v.toFixed(2)
            const pctFmt = (v: number) => `${(v * 100).toFixed(0)}%`

            return (
              <div>
                {/* Header */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mb-6">
                  <div className="text-center">
                    <Link href={`/players/${pA.player_id}`} className="text-lg font-bold text-white hover:text-gray-300 transition-colors">
                      {pA.player_name}
                    </Link>
                    <p className="text-xs text-gray-500 mt-0.5">{pA.team_name} · {pA.matches_played} GP</p>
                  </div>
                  <span className="text-2xl text-gray-700">vs</span>
                  <div className="text-center">
                    <Link href={`/players/${pB.player_id}`} className="text-lg font-bold text-white hover:text-gray-300 transition-colors">
                      {pB.player_name}
                    </Link>
                    <p className="text-xs text-gray-500 mt-0.5">{pB.team_name} · {pB.matches_played} GP</p>
                  </div>
                </div>

                {/* Stat bars */}
                <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-2 divide-y divide-gray-800">
                  <StatBar label="Matches"  aVal={pA.matches_played}          bVal={pB.matches_played} />
                  <StatBar label="Goals"    aVal={pA.total_goals ?? 0}        bVal={pB.total_goals ?? 0} />
                  <StatBar label="G/Match"  aVal={pA.avg_goals_per_match ?? 0} bVal={pB.avg_goals_per_match ?? 0} fmt={gpmFmt} />
                  <StatBar label="Shots"    aVal={pA.total_shots ?? 0}        bVal={pB.total_shots ?? 0} />
                  <StatBar label="Shot%"    aVal={pA.career_shot_conversion ?? 0} bVal={pB.career_shot_conversion ?? 0} fmt={pctFmt} />
                  <StatBar label="Tackles"  aVal={pA.total_tackles ?? 0}      bVal={pB.total_tackles ?? 0} />
                  <StatBar label="Passes"   aVal={pA.total_passes ?? 0}       bVal={pB.total_passes ?? 0} />
                  <StatBar label="Blocks"   aVal={pA.total_blocks ?? 0}       bVal={pB.total_blocks ?? 0} />
                  <StatBar label="Fouls"    aVal={pA.total_fouls ?? 0}        bVal={pB.total_fouls ?? 0} higherIsBetter={false} />
                  <StatBar label="Foul%"    aVal={pA.career_foul_rate ?? 0}   bVal={pB.career_foul_rate ?? 0} fmt={pctFmt} higherIsBetter={false} />
                </div>
              </div>
            )
          })()}
        </div>
      )}

      {/* ── COMPARE TEAMS ── */}
      {mode === 'compare-teams' && (
        <div>
          <div className="mb-6">
            <TeamPickerForm teams={allTeams} a={paramA} b={paramB} />
          </div>

          {(() => {
            if (!paramA || !paramB) return (
              <p className="text-sm text-gray-600">Select two teams above to compare.</p>
            )
            const tA = allTeams.find(t => t.team_id === paramA)
            const tB = allTeams.find(t => t.team_id === paramB)
            if (!tA || !tB) return (
              <p className="text-sm text-red-400">Team not found. <Link href="/compare?mode=compare-teams" className="underline">Reset</Link></p>
            )

            const pctFmt = (v: number) => `${(v * 100).toFixed(0)}%`

            return (
              <div>
                {/* Header */}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 mb-6">
                  <div className="text-center">
                    <Link href={`/scouting/${tA.team_id}`} className="text-lg font-bold text-white hover:text-gray-300 transition-colors">
                      {tA.team_name}
                    </Link>
                    <p className="text-xs text-gray-500 mt-0.5">{tA.matches_played} matches</p>
                  </div>
                  <span className="text-2xl text-gray-700">vs</span>
                  <div className="text-center">
                    <Link href={`/scouting/${tB.team_id}`} className="text-lg font-bold text-white hover:text-gray-300 transition-colors">
                      {tB.team_name}
                    </Link>
                    <p className="text-xs text-gray-500 mt-0.5">{tB.matches_played} matches</p>
                  </div>
                </div>

                {/* Stat bars */}
                <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-2 divide-y divide-gray-800">
                  <StatBar label="Goals"    aVal={tA.total_goals}   bVal={tB.total_goals} />
                  <StatBar label="Shot%"    aVal={tA.shot_pct ?? 0} bVal={tB.shot_pct ?? 0}  fmt={pctFmt} />
                  <StatBar label="Shots"    aVal={tA.total_shots}   bVal={tB.total_shots} />
                  <StatBar label="Tackles"  aVal={tA.total_tackles} bVal={tB.total_tackles} />
                  <StatBar label="Passes"   aVal={tA.total_passes}  bVal={tB.total_passes} />
                  <StatBar label="Fouls"    aVal={tA.total_fouls}   bVal={tB.total_fouls} higherIsBetter={false} />
                  <StatBar label="Foul%"    aVal={tA.foul_rate ?? 0} bVal={tB.foul_rate ?? 0} fmt={pctFmt} higherIsBetter={false} />
                </div>
                <p className="mt-2 text-xs text-gray-700">Cumulative totals across all matches · GP is max across squad members</p>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
