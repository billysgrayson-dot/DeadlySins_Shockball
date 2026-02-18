/**
 * Manual sync script — run from command line to backfill data
 *
 * Usage:
 *   npm run sync:manual                    # Full sync
 *   npm run sync:manual -- --match=MATCH_ID  # Single match replay
 *
 * Example:
 *   npm run sync:manual -- --match=match-abc123
 */

import { syncMatches, syncMatchReplay } from '../src/workers/sync'
import { getRateLimitStatus } from '../src/lib/shockball/client'

// Load .env.local
import { config } from 'dotenv'
config({ path: '.env.local' })

const args = process.argv.slice(2)
const matchArg = args.find(a => a.startsWith('--match='))

async function main() {
  if (matchArg) {
    const matchId = matchArg.split('=')[1]
    console.log(`\n🏐 Fetching replay for match: ${matchId}\n`)
    const result = await syncMatchReplay(matchId)
    console.log('Result:', result)
  } else {
    console.log('\n🏐 Running full match sync...\n')
    const results = await syncMatches()
    console.log('\nSync complete:')
    console.log(`  Upcoming matches synced: ${results.upcoming}`)
    console.log(`  Recent matches synced:   ${results.recent}`)
    console.log(`  Replays fetched:         ${results.replaysQueued}`)
    console.log(`  Errors:                  ${results.errors}`)
  }

  const rl = getRateLimitStatus()
  console.log(`\n📊 Rate limit: ${rl.remaining}/100 remaining (resets ${rl.resetsAt})`)

  if (rl.isLow) {
    console.warn('⚠️  Rate limit is low — consider waiting before running again')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
