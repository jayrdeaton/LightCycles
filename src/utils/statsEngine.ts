import { applyDayPlayed, applyResult, applyResultToBucket, applyWinStreak, countBucketsWithAWin, DEFAULT_MIN_SAMPLE, getBestWinRateKey, getMaxWinsInAnyBucket, getMostPlayedKey, resultFor, RoundResult } from '@tastic/achievements'

import { CpuDifficulty, GameMode, Player, Profile, ProfileStats, RoundOutcome, StatsState } from '@/types'
import { DEFAULT_PROFILE_STATS } from '@/utils/statsValidation'

// Colors need at least this many recorded games before they're eligible for "best performing
// color" — otherwise a single lucky win reads as a fluke 100% win rate. Aliases the shared
// default rather than restating 3, since the rationale is identical.
export const COLOR_STATS_MIN_SAMPLE = DEFAULT_MIN_SAMPLE

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

// This round's result from one seat's point of view. A draw is a draw for everyone; otherwise it's
// a win for the winning seat and a loss for the other.
function seatResult(outcome: RoundOutcome, seat: Player): RoundResult {
  return resultFor(outcome.type === 'draw' ? null : outcome.winner, seat)
}

// Both the device-wide and per-profile paths bump a vsCpu bucket identically — the only difference
// is whose bucket it is — so the shared shape lives here rather than being written twice.
function bumpVsCpu(prev: StatsState['vsCpu'], result: RoundResult, difficulty: CpuDifficulty): StatsState['vsCpu'] {
  return {
    ...applyResult(prev, result),
    byDifficulty: applyResultToBucket(prev.byDifficulty, difficulty, result) as StatsState['vsCpu']['byDifficulty'],
    ...applyWinStreak(prev, result)
  }
}

// Same shared-shape rationale as bumpVsCpu above, for the twoPlayer bucket. Takes p1Won/p2Won/isDraw
// as plain booleans rather than each seat's own RoundResult — applyRoundOutcome's device-wide call
// always has both seats' outcomes at once, but bumpProfileForSeat's call only ever has ONE seat's own
// result (the other seat's win/loss doesn't count toward this profile's personal bucket), so a
// per-seat RoundResult pair would leave that call site inventing a placeholder for the seat it isn't
// scoring — three independent booleans let each caller state exactly what it knows.
function bumpTwoPlayer(prev: StatsState['twoPlayer'], p1Won: boolean, p2Won: boolean, isDraw: boolean): StatsState['twoPlayer'] {
  return {
    played: prev.played + 1,
    p1Wins: prev.p1Wins + (p1Won ? 1 : 0),
    p2Wins: prev.p2Wins + (p2Won ? 1 : 0),
    draws: prev.draws + (isDraw ? 1 : 0)
  }
}

// Mirrors applyRoundOutcome's own vsCpu/twoPlayer/day-streak logic below, exactly, but scoped to one
// profile's own bucket — this is what makes a profile's stats a full StatsState-shaped view (see
// getProfileStatsView) rather than just played/wins/losses/draws. twoPlayer.p1Wins/p2Wins bump on
// `seat === 1/2 && result === 'win'` — i.e. always this profile's OWN win, regardless of which seat
// they sat in that particular round (see types/index.ts's ProfileStats doc comment).
function bumpProfileForSeat(profiles: Record<string, ProfileStats>, profileId: string, seat: Player, outcome: RoundOutcome, context: RoundOutcomeContext, now: Date): Record<string, ProfileStats> {
  const prev = profiles[profileId] ?? DEFAULT_PROFILE_STATS
  const result = seatResult(outcome, seat)

  const vsCpu = context.gameMode === 'vsCpu' ? bumpVsCpu(prev.vsCpu, result, context.cpuDifficulty) : prev.vsCpu
  const twoPlayer = context.gameMode === 'vsCpu' ? prev.twoPlayer : bumpTwoPlayer(prev.twoPlayer, seat === 1 && result === 'win', seat === 2 && result === 'win', result === 'draw')

  const colors = applyResultToBucket(prev.colors, context.colors[seat].toLowerCase(), result)
  return { ...profiles, [profileId]: { vsCpu, twoPlayer, colors, ...applyDayPlayed(prev, now) } }
}

// `now` defaults to the real clock — overridable so tests can exercise day-boundary/streak logic
// without mocking the global Date.
export function applyRoundOutcome(prev: StatsState, outcome: RoundOutcome, context: RoundOutcomeContext, now: Date = new Date()): StatsState {
  const isFirstGameEver = prev.vsCpu.played + prev.twoPlayer.played === 0
  const firstGameResult = isFirstGameEver ? seatResult(outcome, 1) : prev.firstGameResult

  // Human is always seat 1 in vsCpu mode (see cpuAi.ts's CPU_PLAYER).
  const vsCpu = context.gameMode === 'vsCpu' ? bumpVsCpu(prev.vsCpu, seatResult(outcome, 1), context.cpuDifficulty) : prev.vsCpu
  const twoPlayer = context.gameMode === 'vsCpu' ? prev.twoPlayer : bumpTwoPlayer(prev.twoPlayer, outcome.type === 'win' && outcome.winner === 1, outcome.type === 'win' && outcome.winner === 2, outcome.type === 'draw')

  // Both seats' colors are tracked unconditionally, regardless of gameMode — color choice is the
  // one thing tracked uniformly across vsCpu and twoPlayer (see types/index.ts's StatsState).
  let colors = prev.colors
  for (const seat of [1, 2] as Player[]) {
    colors = applyResultToBucket(colors, context.colors[seat].toLowerCase(), seatResult(outcome, seat))
  }

  // Unlike colors above, only seats with an actual saved profile selected this round contribute —
  // most rounds have none, and vsCpu's CPU seat never has one (enforced at the source in game.tsx's
  // profileIds construction, not re-checked here).
  let profiles = prev.profiles
  if (context.profileIds) {
    for (const seat of [1, 2] as Player[]) {
      const profileId = context.profileIds[seat]
      if (!profileId) continue
      profiles = bumpProfileForSeat(profiles, profileId, seat, outcome, context, now)
    }
  }

  return { vsCpu, twoPlayer, colors, profiles, firstGameResult, ...applyDayPlayed(prev, now) }
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
// helpers below that already evaluate a device-wide StatsState can evaluate a profile's own view
// completely unchanged. `profiles: {}` since this view has no nesting of its own; `firstGameResult:
// null` is never read through this view — every achievement that touches it is scope:'device' (see
// constants/achievements.ts's flawless_debut), always evaluated against the real device-wide
// StatsState, never this synthesized one. DO NOT pass this view's output through getOverallTotals —
// see that function's own caveat comment above; use getProfileOverallTotals.
export function getProfileStatsView(profileStats: ProfileStats): StatsState {
  return { ...profileStats, profiles: {}, firstGameResult: null }
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

// The four color selectors below are thin StatsState-shaped adapters over @tastic/achievements'
// generic bucket helpers — `colors` is just an OutcomeRecord bucket map, so the package's own
// implementations apply verbatim. Kept as named exports (rather than inlining the package calls at
// each call site) so the achievements screen and the catalog keep reading in this app's own
// vocabulary, and so the "which map, and what sample floor" decision lives in exactly one place.
export function getFavoriteColor(stats: StatsState): string | null {
  return getMostPlayedKey(stats.colors)
}

export function getBestPerformingColor(stats: StatsState, minSample = COLOR_STATS_MIN_SAMPLE): string | null {
  return getBestWinRateKey(stats.colors, minSample)
}

export function getMaxSingleColorWins(stats: StatsState): number {
  return getMaxWinsInAnyBucket(stats.colors)
}

export function getColorsWithAtLeastOneWin(stats: StatsState): number {
  return countBucketsWithAWin(stats.colors)
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
