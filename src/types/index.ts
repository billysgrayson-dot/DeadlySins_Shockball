// ============================================================
// Shockball API Types
// Based on openapi.yaml
// ============================================================

export type CompetitionType = 'ALL' | 'FRIENDLY' | 'DIVISION' | 'CONFERENCE' | 'LEAGUE'
export type MatchStatus = 'SCHEDULED' | 'IN_PROGRESS' | 'COMPLETED'

export interface ApiTeam {
  id: string
  name: string
  imageUrl?: string
  venue?: string
}

export interface ApiCompetition {
  id: string
  name: string
  type: CompetitionType
  status?: string
  startDate?: string
  season?: number
}

export interface ApiConference {
  id: string
  name: string
}

export interface ApiLeague {
  id: string
  name: string
}

export interface ApiMatch {
  id: string
  scheduledTime: string
  status: MatchStatus
  homeScore?: number
  awayScore?: number
  homeTeam: ApiTeam
  awayTeam: ApiTeam
  competition?: ApiCompetition
  conference?: ApiConference
  league?: ApiLeague
}

export interface ApiMatchListResponse {
  matches: ApiMatch[]
  meta: {
    total: number
    limit: number
    offset: number
    hasMore: boolean
  }
}

export interface ApiPlayerStats {
  playerId: string
  playerName: string
  shots: number
  goals: number
  passes: number
  tackles: number
  blocks: number
  fouls: number
  wasInjured: boolean
}

export interface ApiGameEvent {
  turn: number
  type: string
  description: string
  playersInvolved: string[]
  homeScore: number
  awayScore: number
  context?: {
    shot?: {
      distanceToGoal?: number
      pressure?: number
      shooterAccuracy?: number
      guardBlocking?: number
      outcome?: 'goal' | 'save_caught' | 'save_rebound' | 'miss'
    }
    pass?: {
      distance?: number
      defendersInLane?: number
      passerAccuracy?: number
      outcome?: 'completed' | 'interception' | 'incomplete'
    }
    tackle?: {
      tacklerAggression?: number
      tacklerStrength?: number
    }
    foul?: {
      severity?: 'light' | 'normal' | 'heavy'
      penaltyDuration?: number
    }
    injury?: {
      severity?: 'MINOR' | 'SERIOUS'
      substitutedByBot?: boolean
    }
    substitution?: {
      reason?: 'injury' | 'energy_low'
      outgoingEnergy?: number
      incomingEnergy?: number
    }
    advance?: {
      distanceAdvanced?: number
      nearestDefenderDistance?: number
    }
    initialEnergy?: Record<string, number>   // MATCH_START event
    turnEnergy?: Record<string, number>      // TURN_UPDATE events
  }
}

export interface ApiReplayData {
  success: boolean
  data: {
    match: {
      id: string
      homeTeam: ApiTeam
      awayTeam: ApiTeam
      homeScore: number
      awayScore: number
      scheduledTime: string
      simVersion: string
    }
    playerStats: {
      home: ApiPlayerStats[]
      away: ApiPlayerStats[]
    }
    events: ApiGameEvent[]
  }
  timestamp: string
}

// ============================================================
// Energy Analysis Types
// ============================================================

export type PenaltyTier = 'none' | 'moderate' | 'severe'

export interface EnergySnapshot {
  matchId: string
  playerId: string
  turn: number
  energy: number
  penaltyTier: PenaltyTier
  penaltyMagnitude: number
}

export interface PlayerEnergyProfile {
  playerId: string
  playerName: string
  matchId: string
  firstTurnBelow30: number | null   // moderate penalty begins
  firstTurnBelow20: number | null   // auto-sub trigger
  firstTurnBelow10: number | null   // severe penalty begins
  minEnergyReached: number
  avgPenaltyMagnitude: number
}

// ============================================================
// Coaching / Dashboard Types
// ============================================================

export interface PlayerCurrentStatus {
  playerId: string
  playerName: string
  teamId: string
  // Inferred from most recent match energy data
  estimatedCurrentEnergy: number | null
  lastMatchDate: string | null
  lastMatchMinEnergy: number | null
  startRisk: 'low' | 'medium' | 'high' | 'unknown'
}

export interface MatchScoutingReport {
  opponentTeamId: string
  opponentTeamName: string
  matchesAnalysed: number
  topScorer: { playerId: string; playerName: string; avgGoals: number } | null
  topTackler: { playerId: string; playerName: string; avgTackles: number } | null
  highFoulRiskPlayers: Array<{ playerId: string; playerName: string; foulRate: number }>
  avgGoalsScored: number
  avgGoalsConceded: number
  energyFadePattern: 'early' | 'mid' | 'late' | 'consistent' | 'unknown'
}
