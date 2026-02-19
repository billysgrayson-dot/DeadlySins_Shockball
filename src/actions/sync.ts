'use server'

import { syncMatches, syncMatchReplay } from '@/workers/sync'
import { revalidatePath } from 'next/cache'

export async function triggerFullSync(): Promise<void> {
  await syncMatches()
  revalidatePath('/dashboard')
  revalidatePath('/admin')
}

export async function triggerReplaySync(matchId: string): Promise<void> {
  await syncMatchReplay(matchId)
  revalidatePath('/admin')
  revalidatePath(`/matches/${matchId}`)
}
