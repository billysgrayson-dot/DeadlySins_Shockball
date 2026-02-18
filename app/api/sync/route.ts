/**
 * POST /api/sync
 *
 * Triggered by Vercel Cron every 15 minutes.
 * Also callable manually for immediate sync.
 *
 * Protected by CRON_SECRET to prevent public abuse.
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncMatches } from '@/workers/sync'
import { getRateLimitStatus } from '@/lib/shockball/client'

export const runtime = 'nodejs'
export const maxDuration = 60  // 60 second timeout for sync jobs

export async function POST(req: NextRequest) {
  // Verify cron secret (set this in Vercel env vars)
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    console.log('[/api/sync] Starting match sync...')
    const results = await syncMatches()
    const rateLimit = getRateLimitStatus()

    console.log('[/api/sync] Sync complete:', results)

    return NextResponse.json({
      success: true,
      results,
      rateLimit,
      timestamp: new Date().toISOString(),
    })
  } catch (err) {
    console.error('[/api/sync] Sync failed:', err)
    return NextResponse.json(
      { success: false, error: String(err) },
      { status: 500 }
    )
  }
}

// GET endpoint to check sync status + rate limit health
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimit = getRateLimitStatus()
  return NextResponse.json({ rateLimit, timestamp: new Date().toISOString() })
}
