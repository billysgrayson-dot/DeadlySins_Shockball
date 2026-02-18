/**
 * POST /api/matches/[id]/replay
 * Manually trigger a replay fetch for a specific match.
 * Useful for backfilling historical data.
 */

import { NextRequest, NextResponse } from 'next/server'
import { syncMatchReplay } from '@/workers/sync'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const result = await syncMatchReplay(id)
  return NextResponse.json({ ...result, matchId: id })
}
