/**
 * Shockball API Client
 *
 * Handles:
 * - API key auth via x-api-key header
 * - If-Modified-Since / 304 conditional requests (free, no rate limit cost)
 * - Rate limit header tracking
 * - Exponential backoff on 429
 * - Pagination (auto-fetches all pages)
 */

import type {
  ApiMatch,
  ApiMatchListResponse,
  ApiReplayData,
  CompetitionType,
} from '@/types'

const BASE_URL = 'https://shockball.online/api/v1/data'
const DEADLY_SINS_TEAM_ID = 'cmgbpfhey01c8s12xz26jkbga'

// ============================================================
// Rate limit state (in-memory, resets with process)
// ============================================================
let rateLimitRemaining: number = 100
let rateLimitReset: number = 0

export function getRateLimitStatus() {
  return {
    remaining: rateLimitRemaining,
    resetsAt: new Date(rateLimitReset * 1000).toISOString(),
    isLow: rateLimitRemaining < 10,
  }
}

// ============================================================
// Core fetch with auth + rate limit handling
// ============================================================

interface FetchOptions {
  ifModifiedSince?: string
  signal?: AbortSignal
}

interface FetchResult<T> {
  data: T | null
  notModified: boolean       // true = 304, use cached data
  lastModified: string | null
  rateLimitRemaining: number
}

async function apiFetch<T>(
  path: string,
  options: FetchOptions = {},
  retryCount = 0
): Promise<FetchResult<T>> {
  const apiKey = process.env.SHOCKBALL_API_KEY
  if (!apiKey) throw new Error('SHOCKBALL_API_KEY environment variable is not set')

  const headers: Record<string, string> = {
    'x-api-key': apiKey,
    'Accept': 'application/json',
  }

  if (options.ifModifiedSince) {
    headers['If-Modified-Since'] = options.ifModifiedSince
  }

  const url = `${BASE_URL}${path}`

  let response: Response
  try {
    response = await fetch(url, {
      headers,
      signal: options.signal,
      // Disable Next.js cache — we manage caching ourselves via Supabase
      cache: 'no-store',
    })
  } catch (err) {
    throw new Error(`Network error fetching ${url}: ${err}`)
  }

  // Update rate limit state from headers
  const remaining = response.headers.get('X-RateLimit-Remaining')
  const reset = response.headers.get('X-RateLimit-Reset')
  if (remaining) rateLimitRemaining = parseInt(remaining, 10)
  if (reset) rateLimitReset = parseInt(reset, 10)

  const lastModified = response.headers.get('Last-Modified')

  // 304 Not Modified — free response, use cached data
  if (response.status === 304) {
    return { data: null, notModified: true, lastModified, rateLimitRemaining }
  }

  // 429 Rate limited — exponential backoff
  if (response.status === 429) {
    if (retryCount >= 3) throw new Error('Rate limit exceeded after 3 retries')
    const retryAfter = parseInt(response.headers.get('Retry-After') ?? '60', 10)
    const waitMs = Math.min(retryAfter * 1000, (2 ** retryCount) * 5000)
    console.warn(`[shockball-api] Rate limited. Waiting ${waitMs}ms before retry ${retryCount + 1}`)
    await new Promise(r => setTimeout(r, waitMs))
    return apiFetch<T>(path, options, retryCount + 1)
  }

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`Shockball API error ${response.status} for ${path}: ${body}`)
  }

  const data = await response.json() as T
  return { data, notModified: false, lastModified, rateLimitRemaining }
}

// ============================================================
// Paginated list fetch (handles hasMore automatically)
// ============================================================

async function fetchAllPages(
  endpoint: string,
  params: Record<string, string>,
  ifModifiedSince?: string
): Promise<{ matches: ApiMatch[]; lastModified: string | null; notModified: boolean }> {
  const allMatches: ApiMatch[] = []
  let offset = 0
  const limit = 100
  let lastModified: string | null = null

  while (true) {
    const searchParams = new URLSearchParams({
      ...params,
      limit: limit.toString(),
      offset: offset.toString(),
    })

    const result = await apiFetch<ApiMatchListResponse>(
      `${endpoint}?${searchParams}`,
      { ifModifiedSince: offset === 0 ? ifModifiedSince : undefined }
    )

    if (result.notModified) {
      return { matches: [], lastModified: result.lastModified, notModified: true }
    }

    if (!result.data) break

    if (offset === 0) lastModified = result.lastModified
    allMatches.push(...result.data.matches)

    if (!result.data.meta.hasMore) break
    offset += limit
  }

  return { matches: allMatches, lastModified, notModified: false }
}

// ============================================================
// Public API methods
// ============================================================

/**
 * Fetch upcoming matches, optionally filtered by competition type.
 * Uses If-Modified-Since to avoid rate limit cost when data hasn't changed.
 */
export async function getUpcomingMatches(
  options: {
    competitionType?: CompetitionType
    ifModifiedSince?: string
  } = {}
) {
  const params: Record<string, string> = {}
  if (options.competitionType && options.competitionType !== 'ALL') {
    params.competitionType = options.competitionType
  }

  return fetchAllPages('/matches/upcoming', params, options.ifModifiedSince)
}

/**
 * Fetch recently completed matches.
 * Uses If-Modified-Since to avoid rate limit cost when data hasn't changed.
 */
export async function getRecentMatches(
  options: {
    competitionType?: CompetitionType
    ifModifiedSince?: string
  } = {}
) {
  const params: Record<string, string> = {}
  if (options.competitionType && options.competitionType !== 'ALL') {
    params.competitionType = options.competitionType
  }

  return fetchAllPages('/matches/recent', params, options.ifModifiedSince)
}

/**
 * Fetch full replay data for a completed match.
 * Completed match data is immutable — safe to cache indefinitely.
 * Uses If-Modified-Since: once fetched, subsequent calls are always free 304s.
 */
export async function getMatchReplay(
  matchId: string,
  ifModifiedSince?: string
): Promise<{ data: ApiReplayData | null; notModified: boolean; lastModified: string | null }> {
  const result = await apiFetch<ApiReplayData>(
    `/matches/${matchId}/replay-data`,
    { ifModifiedSince }
  )
  return {
    data: result.data,
    notModified: result.notModified,
    lastModified: result.lastModified,
  }
}

/**
 * Filter a list of matches to only those involving Deadly Sins
 */
export function filterDeadlySinsMatches(matches: ApiMatch[]): ApiMatch[] {
  return matches.filter(
    m =>
      m.homeTeam.id === DEADLY_SINS_TEAM_ID ||
      m.awayTeam.id === DEADLY_SINS_TEAM_ID
  )
}

export { DEADLY_SINS_TEAM_ID }
