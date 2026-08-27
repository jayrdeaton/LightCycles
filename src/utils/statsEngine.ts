import { ColorStats, CpuDifficulty, GameMode, Player, Profile, ProfileStats, RoundOutcome, StatsState } from '@/types'
import { DEFAULT_PROFILE_STATS } from '@/utils/statsValidation'

// Colors need at least this many recorded games before they're eligible for "best performing
// color" — otherwise a single lucky win reads as a fluke 100% win rate.
export const COLOR_STATS_MIN_SAMPLE = 3

interface RoundOutcomeContext {
  gameMode: GameMode
  cpuDifficulty: CpuDifficulty
  colors: Record<Player, string>
  // Seat -> profile id, present only for seats that had a saved profile selected this round —
  // absent/empty is the common case (nobody set up a profile) and touches `profiles` not at all.
  // vsCpu's CPU seat never has an entry (see game.tsx's profileIds construction), so the loop below
  // naturally only ever bumps the human's own profile in that mode, no special-casing needed.
  profileIds?: Partial<Record<Player, string>>
}

function localDateString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// One calendar day before `dateStr` ("YYYY-MM-DD"), computed via Date's own month/year rollover
// rather than string math, so this stays correct across month and year boundaries.
function previousDateString(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() - 1)
  return localDateString(date)
}

function bumpColorStats(colors: Record<string, ColorStats>, hex: string, result: 'win' | 'loss' | 'draw'): Record<string, ColorStats> {
  const key = hex.toLowerCase()
  const prev = colors[key] ?? { played: 0, wins: 0, losses: 0, draws: 0 }
  return {
    ...colors,
    [key]: {
      played: prev.played + 1,
      wins: prev.wins + (result === 'win' ? 1 : 0),
      losses: prev.losses + (result === 'loss' ? 1 : 0),
      draws: prev.draws + (result === 'draw' ? 1 : 0)
    }
  }
}

// Mirrors applyRoundOutcome's own vsCpu/twoPlayer/day-streak logic below, exactly, but scoped to one
// profile's own bucket — this is what makes a profile's stats a full StatsState-shaped view (see
// getProfileStatsView) rather than just played/wins/losses/draws. twoPlayer.p1Wins/p2Wins bump on
// `seat === 1/2 && result==='win'` — i.e. always this profile's OWN win, regardless of which seat
// they sat in that particular round (see types/index.ts's ProfileStats doc comment).
function bumpProfileForSeat(profiles: Record<string, ProfileStats>, profileId: string, seat: Player, outcome: RoundOutcome, context: RoundOutcomeContext, today: string): Record<string, ProfileStats> {
  const prev = profiles[profileId] ?? DEFAULT_PROFILE_STATS
  const result = outcome.type === 'draw' ? 'draw' : outcome.winner === seat ? 'win' : 'loss'

  const isNewDay = prev.lastPlayedDate !== today
  const distinctDaysPlayed = isNewDay ? prev.distinctDaysPlayed + 1 : prev.distinctDaysPlayed
  const currentDayStreak = isNewDay ? (prev.lastPlayedDate === previousDateString(today) ? prev.currentDayStreak + 1 : 1) : prev.currentDayStreak
  const bestDayStreak = Math.max(prev.bestDayStreak, currentDayStreak)

  let vsCpu = prev.vsCpu
  let twoPlayer = prev.twoPlayer
  if (context.gameMode === 'vsCpu') {
    const won = result === 'win'
    const nextStreak = won ? vsCpu.currentWinStreak + 1 : 0
    const prevDifficulty = vsCpu.byDifficulty[context.cpuDifficulty]
    vsCpu = {
      played: vsCpu.played + 1,
      wins: vsCpu.wins + (won ? 1 : 0),
      losses: vsCpu.losses + (result === 'loss' ? 1 : 0),
      draws: vsCpu.draws + (result === 'draw' ? 1 : 0),
      byDifficulty: {
        ...vsCpu.byDifficulty,
        [context.cpuDifficulty]: {
          played: prevDifficulty.played + 1,
          wins: prevDifficulty.wins + (won ? 1 : 0),
          losses: prevDifficulty.losses + (result === 'loss' ? 1 : 0),
          draws: prevDifficulty.draws + (result === 'draw' ? 1 : 0)
        }
      },
      currentWinStreak: nextStreak,
      bestWinStreak: Math.max(vsCpu.bestWinStreak, nextStreak)
    }
  } else {
    twoPlayer = {
      played: twoPlayer.played + 1,
      p1Wins: twoPlayer.p1Wins + (seat === 1 && result === 'win' ? 1 : 0),
      p2Wins: twoPlayer.p2Wins + (seat === 2 && result === 'win' ? 1 : 0),
      draws: twoPlayer.draws + (result === 'draw' ? 1 : 0)
    }
  }

  const colors = bumpColorStats(prev.colors, context.colors[seat], result)
  return { ...profiles, [profileId]: { vsCpu, twoPlayer, colors, distinctDaysPlayed, currentDayStreak, bestDayStreak, lastPlayedDate: today } }
}

// `now` defaults to the real clock — overridable so tests can exercise day-boundary/streak logic
// without mocking the global Date.
export function applyRoundOutcome(prev: StatsState, outcome: RoundOutcome, context: RoundOutcomeContext, now: Date = new Date()): StatsState {
  const today = localDateString(now)
  const isNewDay = prev.lastPlayedDate !== today
  const distinctDaysPlayed = isNewDay ? prev.distinctDaysPlayed + 1 : prev.distinctDaysPlayed
  // A new day extends the streak only if it directly follows the last day played — any bigger gap
  // (or the very first day ever) restarts it at 1, since today itself is always day one of
  // whatever streak it belongs to.
  const currentDayStreak = isNewDay ? (prev.lastPlayedDate === previousDateString(today) ? prev.currentDayStreak + 1 : 1) : prev.currentDayStreak
  const bestDayStreak = Math.max(prev.bestDayStreak, currentDayStreak)
  const isFirstGameEver = prev.vsCpu.played + prev.twoPlayer.played === 0
  const firstGameResult = isFirstGameEver ? (outcome.type === 'draw' ? 'draw' : outcome.winner === 1 ? 'win' : 'loss') : prev.firstGameResult

  let vsCpu = prev.vsCpu
  let twoPlayer = prev.twoPlayer

  if (context.gameMode === 'vsCpu') {
    // Human is always seat 1 (see cpuAi.ts's CPU_PLAYER).
    const humanWon = outcome.type === 'win' && outcome.winner === 1
    const humanLost = outcome.type === 'win' && outcome.winner === 2
    const nextStreak = humanWon ? vsCpu.currentWinStreak + 1 : 0
    const prevDifficulty = vsCpu.byDifficulty[context.cpuDifficulty]
    vsCpu = {
      played: vsCpu.played + 1,
      wins: vsCpu.wins + (humanWon ? 1 : 0),
      losses: vsCpu.losses + (humanLost ? 1 : 0),
      draws: vsCpu.draws + (outcome.type === 'draw' ? 1 : 0),
      byDifficulty: {
        ...vsCpu.byDifficulty,
        [context.cpuDifficulty]: {
          played: prevDifficulty.played + 1,
          wins: prevDifficulty.wins + (humanWon ? 1 : 0),
          losses: prevDifficulty.losses + (humanLost ? 1 : 0),
          draws: prevDifficulty.draws + (outcome.type === 'draw' ? 1 : 0)
        }
      },
      currentWinStreak: nextStreak,
      bestWinStreak: Math.max(vsCpu.bestWinStreak, nextStreak)
    }
  } else {
    twoPlayer = {
      played: twoPlayer.played + 1,
      p1Wins: twoPlayer.p1Wins + (outcome.type === 'win' && outcome.winner === 1 ? 1 : 0),
      p2Wins: twoPlayer.p2Wins + (outcome.type === 'win' && outcome.winner === 2 ? 1 : 0),
      draws: twoPlayer.draws + (outcome.type === 'draw' ? 1 : 0)
    }
  }

  // Both seats' colors are tracked unconditionally, regardless of gameMode — color choice is the
  // one thing tracked uniformly across vsCpu and twoPlayer (see types/index.ts's StatsState).
  let colors = prev.colors
  for (const seat of [1, 2] as Player[]) {
    const result = outcome.type === 'draw' ? 'draw' : outcome.winner === seat ? 'win' : 'loss'
    colors = bumpColorStats(colors, context.colors[seat], result)
  }

  // Unlike colors above, only seats with an actual saved profile selected this round contribute —
  // most rounds have none, and vsCpu's CPU seat never has one (enforced at the source in game.tsx's
  // profileIds construction, not re-checked here).
  let profiles = prev.profiles
  if (context.profileIds) {
    for (const seat of [1, 2] as Player[]) {
      const profileId = context.profileIds[seat]
      if (!profileId) continue
      profiles = bumpProfileForSeat(profiles, profileId, seat, outcome, context, today)
    }
  }

  return { vsCpu, twoPlayer, colors, profiles, distinctDaysPlayed, currentDayStreak, bestDayStreak, lastPlayedDate: today, firstGameResult }
}

// Device-wide only — DO NOT call this on a synthesized per-profile view (see getProfileStatsView
// below). Its `losses` formula relies on a device-aggregate identity (every non-draw two-player
// round has exactly one winner and one loser SOMEWHERE on the device, so "total losses" can mirror
// "total wins") that does not hold for one profile's own personal record. Use
// getProfileOverallTotals for a profile's own totals instead.
export function getOverallTotals(stats: StatsState): { played: number; wins: number; losses: number; draws: number } {
  const twoPlayerNonDraws = stats.twoPlayer.p1Wins + stats.twoPlayer.p2Wins
  return {
    played: stats.vsCpu.played + stats.twoPlayer.played,
    // "Any win by anyone on this device" — the human's vsCpu wins, plus every two-player round's
    // winner (whichever seat that was).
    wins: stats.vsCpu.wins + twoPlayerNonDraws,
    // Mirrors wins: every non-draw two-player round has exactly one winner and one loser, so the
    // loss count is the same tally viewed from the other seat. Keeps "total losses" meaningful
    // without inventing a fake personal identity for local pass-and-play.
    losses: stats.vsCpu.losses + twoPlayerNonDraws,
    draws: stats.vsCpu.draws + stats.twoPlayer.draws
  }
}

// Synthesizes a full StatsState-shaped view from one profile's own bucket, so the exact same
// achievement predicates (see achievementEngine.ts's evaluateUnlockedIdsForProfile) and display
// helpers below (getFavoriteColor/getBestPerformingColor/getMaxSingleColorWins/
// getColorsWithAtLeastOneWin) that already evaluate a device-wide StatsState can evaluate a
// profile's own view completely unchanged. `profiles: {}` since this view has no nesting of its
// own; `firstGameResult: null` is never read through this view — every achievement that touches it
// is scope:'device' (see constants/achievements.ts's flawless_debut), always evaluated against the
// real device-wide StatsState, never this synthesized one. DO NOT pass this view's output through
// getOverallTotals — see that function's own caveat comment above; use getProfileOverallTotals.
export function getProfileStatsView(profileStats: ProfileStats): StatsState {
  return {
    vsCpu: profileStats.vsCpu,
    twoPlayer: profileStats.twoPlayer,
    colors: profileStats.colors,
    profiles: {},
    distinctDaysPlayed: profileStats.distinctDaysPlayed,
    currentDayStreak: profileStats.currentDayStreak,
    bestDayStreak: profileStats.bestDayStreak,
    lastPlayedDate: profileStats.lastPlayedDate,
    firstGameResult: null
  }
}

// The profile-scoped counterpart to getOverallTotals, with a correct `losses` for one profile's own
// personal record (see getOverallTotals' own caveat comment on why that function can't be reused
// here) — derived as played-minus-everything-else rather than mirroring wins.
export function getProfileOverallTotals(profileStats: ProfileStats): { played: number; wins: number; losses: number; draws: number } {
  const twoPlayerWins = profileStats.twoPlayer.p1Wins + profileStats.twoPlayer.p2Wins
  const twoPlayerLosses = profileStats.twoPlayer.played - twoPlayerWins - profileStats.twoPlayer.draws
  return {
    played: profileStats.vsCpu.played + profileStats.twoPlayer.played,
    wins: profileStats.vsCpu.wins + twoPlayerWins,
    losses: profileStats.vsCpu.losses + twoPlayerLosses,
    draws: profileStats.vsCpu.draws + profileStats.twoPlayer.draws
  }
}

export function getFavoriteColor(stats: StatsState): string | null {
  let best: string | null = null
  let bestPlayed = 0
  for (const [hex, colorStats] of Object.entries(stats.colors)) {
    if (colorStats.played > bestPlayed) {
      best = hex
      bestPlayed = colorStats.played
    }
  }
  return best
}

export function getBestPerformingColor(stats: StatsState, minSample = COLOR_STATS_MIN_SAMPLE): string | null {
  let best: string | null = null
  let bestRate = -1
  for (const [hex, colorStats] of Object.entries(stats.colors)) {
    if (colorStats.played < minSample) continue
    const rate = colorStats.wins / colorStats.played
    if (rate > bestRate) {
      best = hex
      bestRate = rate
    }
  }
  return best
}

export function getMaxSingleColorWins(stats: StatsState): number {
  return Object.values(stats.colors).reduce((max, colorStats) => Math.max(max, colorStats.wins), 0)
}

export function getColorsWithAtLeastOneWin(stats: StatsState): number {
  return Object.values(stats.colors).filter((colorStats) => colorStats.wins > 0).length
}

export interface ProfileRanking {
  profile: Profile
  played: number
  wins: number
  losses: number
  draws: number
  winRate: number
}

// Sorted by wins, then win rate, both descending — a profile with no rounds recorded yet still
// appears (played: 0, winRate: 0), so a freshly created profile shows up in the rankings
// immediately rather than only once it's played its first round.
export function getProfileRankings(profiles: Profile[], profileStats: Record<string, ProfileStats>): ProfileRanking[] {
  return profiles
    .map((profile) => {
      const totals = getProfileOverallTotals(profileStats[profile.id] ?? DEFAULT_PROFILE_STATS)
      return { profile, ...totals, winRate: totals.played > 0 ? totals.wins / totals.played : 0 }
    })
    .sort((a, b) => b.wins - a.wins || b.winRate - a.winRate)
}
