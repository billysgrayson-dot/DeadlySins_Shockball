/**
 * Admin Page
 *
 * - Manual sync trigger (Server Action)
 * - Rate limit status
 * - Recent sync log
 * - Backfill queue: DS matches missing replay data
 */

import { createServerClient } from '@/lib/supabase/client'
import { triggerFullSync, triggerReplaySync } from '@/actions/sync'
import { getRateLimitStatus } from '@/lib/shockball/client'

export const dynamic = 'force-dynamic'

const DS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'

function formatDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit', timeZoneName: 'short',
  })
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default async function AdminPage() {
  const db = createServerClient()

  const [missingReplayResult, syncLogResult, teamNamesResult] = await Promise.all([
    db
      .from('matches')
      .select('id, scheduled_time, home_team_id, away_team_id, home_score, away_score')
      .eq('involves_deadly_sins', true)
      .eq('replay_fetched', false)
      .eq('status', 'COMPLETED')
      .order('scheduled_time', { ascending: false }),
    db
      .from('sync_log')
      .select('id, endpoint, fetched_at, http_status, matches_found, matches_new, error')
      .order('fetched_at', { ascending: false })
      .limit(20),
    db.from('teams').select('id, name'),
  ])

  const missingReplays = missingReplayResult.data ?? []
  const syncLogs = syncLogResult.data ?? []
  const teamNames: Record<string, string> = Object.fromEntries(
    (teamNamesResult.data ?? []).map(t => [t.id, t.name])
  )

  const rateLimit = getRateLimitStatus()
  const lastSync = syncLogs.find(l => l.http_status === 200)

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Admin</h1>
        <p className="mt-1 text-sm text-gray-500">Sync controls, status, and backfill queue.</p>
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-8">

          {/* Backfill queue */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">
              Backfill Queue ({missingReplays.length})
            </h2>
            {missingReplays.length === 0 ? (
              <div className="rounded-lg border border-gray-800 bg-gray-900 px-6 py-6 text-center">
                <p className="text-sm text-emerald-400 font-medium">All completed DS matches have replay data ✓</p>
              </div>
            ) : (
              <div className="rounded-lg border border-gray-800 overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800 bg-gray-900">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Match</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-800">
                    {missingReplays.map(m => {
                      const isHome = m.home_team_id === DS_TEAM_ID
                      const oppId = isHome ? m.away_team_id : m.home_team_id
                      const oppName = teamNames[oppId] ?? 'Unknown'
                      const dsScore = isHome ? m.home_score : m.away_score
                      const oppScore = isHome ? m.away_score : m.home_score
                      return (
                        <tr key={m.id} className="bg-gray-950">
                          <td className="px-4 py-3">
                            <p className="text-gray-300">DS {isHome ? 'vs' : '@'} {oppName}</p>
                            {dsScore !== null && oppScore !== null && (
                              <p className="text-xs text-gray-600">{isHome ? `${dsScore}–${oppScore}` : `${oppScore}–${dsScore}`}</p>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-gray-400">{formatDate(m.scheduled_time)}</td>
                          <td className="px-4 py-3 text-center">
                            <form action={triggerReplaySync.bind(null, m.id)}>
                              <button
                                type="submit"
                                className="rounded px-3 py-1 text-xs font-medium bg-gray-800 text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
                              >
                                Fetch Replay
                              </button>
                            </form>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Sync log */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Recent Sync Log</h2>
            <div className="rounded-lg border border-gray-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800 bg-gray-900">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Endpoint</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wide">Time</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-2 text-center text-xs font-medium text-gray-500 uppercase tracking-wide">Found</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {syncLogs.map(log => (
                    <tr key={log.id} className="bg-gray-950">
                      <td className="px-4 py-2.5">
                        <span className="font-mono text-xs text-gray-400">{log.endpoint}</span>
                        {log.error && <p className="text-xs text-red-400 mt-0.5 truncate max-w-xs">{log.error}</p>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-500">{timeAgo(log.fetched_at)}</td>
                      <td className="px-4 py-2.5 text-center">
                        <span className={`text-xs font-medium ${
                          log.http_status === 200 ? 'text-emerald-400' :
                          log.http_status === 304 ? 'text-gray-500' :
                          'text-red-400'
                        }`}>
                          {log.http_status || 'ERR'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-center text-xs text-gray-500">{log.matches_found ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          {/* Manual sync */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Manual Sync</h2>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-3">
              {lastSync && (
                <p className="text-xs text-gray-500">
                  Last sync: <span className="text-gray-400">{timeAgo(lastSync.fetched_at)}</span>
                </p>
              )}
              <form action={triggerFullSync}>
                <button
                  type="submit"
                  className="w-full rounded-lg bg-emerald-900 hover:bg-emerald-800 text-emerald-300 font-medium px-4 py-2.5 text-sm transition-colors"
                >
                  Sync Now
                </button>
              </form>
              <p className="text-xs text-gray-600 leading-snug">
                Fetches upcoming + recent matches, then replays for any new completed DS matches.
              </p>
            </div>
          </section>

          {/* Rate limit */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">API Rate Limit</h2>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Remaining</span>
                <span className={`font-medium ${rateLimit.isLow ? 'text-red-400' : 'text-emerald-400'}`}>
                  {rateLimit.remaining}
                </span>
              </div>
              <div className="h-1.5 w-full rounded-full bg-gray-800">
                <div
                  className={`h-1.5 rounded-full ${rateLimit.isLow ? 'bg-red-500' : 'bg-emerald-500'}`}
                  style={{ width: `${Math.min(rateLimit.remaining, 100)}%` }}
                />
              </div>
              <p className="text-xs text-gray-600">
                Resets at {new Date(rateLimit.resetsAt).toLocaleTimeString()}
              </p>
            </div>
          </section>

          {/* Webhook info */}
          <section>
            <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-gray-500">Webhook</h2>
            <div className="rounded-lg border border-gray-800 bg-gray-900 p-4">
              <p className="text-xs text-gray-500 leading-snug">
                Set <code className="text-gray-400">WEBHOOK_URL</code> in your Vercel environment variables to receive a POST notification whenever a new match replay is synced.
              </p>
              <p className="mt-2 text-xs text-gray-600">
                Compatible with Discord, Slack, Make, Zapier, n8n webhooks.
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
