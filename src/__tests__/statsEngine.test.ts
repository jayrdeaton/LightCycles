import { Profile, ProfileStats, RoundOutcome, StatsState } from '@/types'
import { applyRoundOutcome, COLOR_STATS_MIN_SAMPLE, getBestPerformingColor, getColorsWithAtLeastOneWin, getFavoriteColor, getMaxSingleColorWins, getOverallTotals, getProfileOverallTotals, getProfileRankings, getProfileStatsView } from '@/utils/statsEngine'
import { DEFAULT_PROFILE_STATS, DEFAULT_STATS } from '@/utils/statsValidation'

const P1_COLOR = '#2196f3'
const P2_COLOR = '#f44336'
const COLORS = { 1: P1_COLOR, 2: P2_COLOR }

const WIN_P1: RoundOutcome = { type: 'win', winner: 1 }
const WIN_P2: RoundOutcome = { type: 'win', winner: 2 }
const DRAW: RoundOutcome = { type: 'draw' }

const DAY_1 = new Date(2026, 7, 24, 10, 0)
const DAY_1_LATER = new Date(2026, 7, 24, 20, 0)
const DAY_2 = new Date(2026, 7, 25, 0, 1)
const DAY_3 = new Date(2026, 7, 26, 9, 0)
const DAY_5 = new Date(2026, 7, 28, 9, 0) // skips day 4 — breaks the streak
const JAN_31 = new Date(2027, 0, 31, 9, 0)
const FEB_1 = new Date(2027, 1, 1, 9, 0) // consecutive across a month boundary

function vsCpu(outcome: RoundOutcome, prev: StatsState = DEFAULT_STATS, cpuDifficulty: 'easy' | 'normal' | 'hard' = 'normal') {
  return applyRoundOutcome(prev, outcome, { gameMode: 'vsCpu', cpuDifficulty, colors: COLORS }, DAY_1)
}

function twoPlayer(outcome: RoundOutcome, prev: StatsState = DEFAULT_STATS) {
  return applyRoundOutcome(prev, outcome, { gameMode: 'twoPlayer', cpuDifficulty: 'normal', colors: COLORS }, DAY_1)
}

describe('applyRoundOutcome — vsCpu mode', () => {
  it('records a human win', () => {
    const next = vsCpu(WIN_P1)
    expect(next.vsCpu).toMatchObject({ played: 1, wins: 1, losses: 0, draws: 0, currentWinStreak: 1, bestWinStreak: 1 })
    expect(next.vsCpu.byDifficulty.normal).toMatchObject({ played: 1, wins: 1, losses: 0, draws: 0 })
  })

  it('records a CPU win (human loss) and does not touch twoPlayer', () => {
    const next = vsCpu(WIN_P2)
    expect(next.vsCpu).toMatchObject({ played: 1, wins: 0, losses: 1, draws: 0, currentWinStreak: 0 })
    expect(next.twoPlayer).toEqual(DEFAULT_STATS.twoPlayer)
  })

  it('records a draw', () => {
    const next = vsCpu(DRAW)
    expect(next.vsCpu).toMatchObject({ played: 1, wins: 0, losses: 0, draws: 1, currentWinStreak: 0 })
  })

  it('tallies streak across consecutive wins, and resets on a loss', () => {
    let stats = vsCpu(WIN_P1)
    stats = vsCpu(WIN_P1, stats)
    stats = vsCpu(WIN_P1, stats)
    expect(stats.vsCpu.currentWinStreak).toBe(3)
    expect(stats.vsCpu.bestWinStreak).toBe(3)

    stats = vsCpu(WIN_P2, stats)
    expect(stats.vsCpu.currentWinStreak).toBe(0)
    // bestWinStreak persists past the reset.
    expect(stats.vsCpu.bestWinStreak).toBe(3)
  })

  it('resets streak on a draw, not just a loss', () => {
    let stats = vsCpu(WIN_P1)
    stats = vsCpu(WIN_P1, stats)
    stats = vsCpu(DRAW, stats)
    expect(stats.vsCpu.currentWinStreak).toBe(0)
    expect(stats.vsCpu.bestWinStreak).toBe(2)
  })

  it('buckets byDifficulty separately per difficulty', () => {
    let stats = vsCpu(WIN_P1, DEFAULT_STATS, 'easy')
    stats = vsCpu(WIN_P2, stats, 'hard')
    expect(stats.vsCpu.byDifficulty.easy).toMatchObject({ played: 1, wins: 1, losses: 0 })
    expect(stats.vsCpu.byDifficulty.hard).toMatchObject({ played: 1, wins: 0, losses: 1 })
    expect(stats.vsCpu.byDifficulty.normal).toMatchObject({ played: 0, wins: 0, losses: 0 })
  })
})

describe('applyRoundOutcome — twoPlayer mode', () => {
  it('records seat wins without touching vsCpu', () => {
    const next = twoPlayer(WIN_P1)
    expect(next.twoPlayer).toMatchObject({ played: 1, p1Wins: 1, p2Wins: 0, draws: 0 })
    expect(next.vsCpu).toEqual(DEFAULT_STATS.vsCpu)
  })

  it('records a draw', () => {
    const next = twoPlayer(DRAW)
    expect(next.twoPlayer).toMatchObject({ played: 1, p1Wins: 0, p2Wins: 0, draws: 1 })
  })
})

describe('applyRoundOutcome — color tracking (both seats, both modes)', () => {
  it('attributes win/loss to each seat color on a vsCpu round', () => {
    const next = vsCpu(WIN_P1)
    expect(next.colors[P1_COLOR]).toEqual({ played: 1, wins: 1, losses: 0, draws: 0 })
    expect(next.colors[P2_COLOR]).toEqual({ played: 1, wins: 0, losses: 1, draws: 0 })
  })

  it('attributes both seats as draws', () => {
    const next = twoPlayer(DRAW)
    expect(next.colors[P1_COLOR]).toEqual({ played: 1, wins: 0, losses: 0, draws: 1 })
    expect(next.colors[P2_COLOR]).toEqual({ played: 1, wins: 0, losses: 0, draws: 1 })
  })

  it('accumulates across rounds for the same color', () => {
    let stats = vsCpu(WIN_P1)
    stats = vsCpu(WIN_P2, stats)
    expect(stats.colors[P1_COLOR]).toEqual({ played: 2, wins: 1, losses: 1, draws: 0 })
  })

  it('keys colors case-insensitively', () => {
    const next = applyRoundOutcome(DEFAULT_STATS, WIN_P1, { gameMode: 'vsCpu', cpuDifficulty: 'normal', colors: { 1: '#ABCDEF', 2: P2_COLOR } }, DAY_1)
    expect(next.colors['#abcdef']).toBeDefined()
    expect(next.colors['#ABCDEF']).toBeUndefined()
  })
})

describe('applyRoundOutcome — profile tracking', () => {
  function withProfiles(outcome: RoundOutcome, profileIds: Partial<Record<1 | 2, string>>, prev: StatsState = DEFAULT_STATS) {
    return applyRoundOutcome(prev, outcome, { gameMode: 'twoPlayer', cpuDifficulty: 'normal', colors: COLORS, profileIds }, DAY_1)
  }

  it('leaves profiles untouched when context.profileIds is absent', () => {
    const next = twoPlayer(WIN_P1)
    expect(next.profiles).toEqual({})
  })

  it('leaves profiles untouched when context.profileIds is an empty object', () => {
    const next = withProfiles(WIN_P1, {})
    expect(next.profiles).toEqual({})
  })

  it("attributes a win/loss to each seat's own profile, as that profile's own twoPlayer record", () => {
    const next = withProfiles(WIN_P1, { 1: 'alice', 2: 'bob' })
    expect(next.profiles.alice.twoPlayer).toEqual({ played: 1, p1Wins: 1, p2Wins: 0, draws: 0 })
    expect(next.profiles.bob.twoPlayer).toEqual({ played: 1, p1Wins: 0, p2Wins: 0, draws: 0 })
  })

  it('attributes both seats as draws', () => {
    const next = withProfiles(DRAW, { 1: 'alice', 2: 'bob' })
    expect(next.profiles.alice.twoPlayer).toEqual({ played: 1, p1Wins: 0, p2Wins: 0, draws: 1 })
    expect(next.profiles.bob.twoPlayer).toEqual({ played: 1, p1Wins: 0, p2Wins: 0, draws: 1 })
  })

  it('only bumps the seat that actually has a profile selected', () => {
    const next = withProfiles(WIN_P1, { 1: 'alice' })
    expect(next.profiles.alice.twoPlayer).toEqual({ played: 1, p1Wins: 1, p2Wins: 0, draws: 0 })
    expect(Object.keys(next.profiles)).toEqual(['alice'])
  })

  it('vsCpu mode only ever bumps seat 1 profile, never a phantom CPU-seat entry', () => {
    const next = vsCpu(WIN_P1, DEFAULT_STATS, 'normal')
    // vsCpu(...) helper never passes profileIds, so this also covers the "absent" no-op case above
    // for vsCpu specifically — asserting it here too since CPU-seat leakage is the actual risk.
    expect(next.profiles).toEqual({})
    const withProfile = applyRoundOutcome(DEFAULT_STATS, WIN_P1, { gameMode: 'vsCpu', cpuDifficulty: 'normal', colors: COLORS, profileIds: { 1: 'alice' } }, DAY_1)
    expect(Object.keys(withProfile.profiles)).toEqual(['alice'])
    expect(withProfile.profiles.alice.vsCpu).toMatchObject({ played: 1, wins: 1, losses: 0, draws: 0, currentWinStreak: 1, bestWinStreak: 1 })
  })

  it('accumulates across rounds for the same profile', () => {
    let stats = withProfiles(WIN_P1, { 1: 'alice', 2: 'bob' })
    stats = withProfiles(WIN_P2, { 1: 'alice', 2: 'bob' }, stats)
    expect(stats.profiles.alice.twoPlayer).toEqual({ played: 2, p1Wins: 1, p2Wins: 0, draws: 0 })
  })

  it("p1Wins/p2Wins reflect a profile's OWN wins regardless of which seat they occupied that round", () => {
    let stats = applyRoundOutcome(DEFAULT_STATS, WIN_P1, { gameMode: 'twoPlayer', cpuDifficulty: 'normal', colors: COLORS, profileIds: { 1: 'alice' } }, DAY_1)
    // Alice moves to seat 2 for the next round and wins from there — still her own win total.
    stats = applyRoundOutcome(stats, WIN_P2, { gameMode: 'twoPlayer', cpuDifficulty: 'normal', colors: COLORS, profileIds: { 2: 'alice' } }, DAY_1)
    expect(stats.profiles.alice.twoPlayer).toEqual({ played: 2, p1Wins: 1, p2Wins: 1, draws: 0 })
  })

  it('two different profiles in the same round are bumped independently, including their own colors', () => {
    const next = withProfiles(WIN_P1, { 1: 'alice', 2: 'bob' })
    expect(next.profiles.alice.colors[P1_COLOR]).toEqual({ played: 1, wins: 1, losses: 0, draws: 0 })
    expect(next.profiles.bob.colors[P2_COLOR]).toEqual({ played: 1, wins: 0, losses: 1, draws: 0 })
    expect(next.profiles.alice.colors[P2_COLOR]).toBeUndefined()
  })

  it('tracks day-streak state per profile, independent of both each other and the device-wide streak', () => {
    let stats = applyRoundOutcome(DEFAULT_STATS, WIN_P1, { gameMode: 'twoPlayer', cpuDifficulty: 'normal', colors: COLORS, profileIds: { 1: 'alice' } }, DAY_1)
    stats = applyRoundOutcome(stats, WIN_P1, { gameMode: 'twoPlayer', cpuDifficulty: 'normal', colors: COLORS, profileIds: { 1: 'alice' } }, DAY_2)
    expect(stats.profiles.alice.currentDayStreak).toBe(2)
    expect(stats.profiles.alice.bestDayStreak).toBe(2)
    expect(stats.currentDayStreak).toBe(2)
  })
})

describe('getProfileStatsView / getProfileOverallTotals', () => {
  function profileStatsWithTwoPlayerRecord(played: number, p1Wins: number, draws: number): ProfileStats {
    return { ...DEFAULT_PROFILE_STATS, twoPlayer: { played, p1Wins, p2Wins: 0, draws } }
  }

  it('getProfileStatsView synthesizes a full StatsState-shaped view with an empty profiles map and null firstGameResult', () => {
    const bucket = profileStatsWithTwoPlayerRecord(3, 2, 0)
    const view = getProfileStatsView(bucket)
    expect(view.twoPlayer).toBe(bucket.twoPlayer)
    expect(view.profiles).toEqual({})
    expect(view.firstGameResult).toBeNull()
  })

  it('getProfileOverallTotals derives a correct losses count even when wins and losses differ (unlike getOverallTotals, which only works device-wide)', () => {
    // 10 played, 6 wins, 1 draw -> 3 losses. getOverallTotals' own mirroring-wins-into-losses
    // formula would incorrectly report 6 losses here — this is exactly the trap its own caveat
    // comment warns about.
    const bucket = profileStatsWithTwoPlayerRecord(10, 6, 1)
    expect(getProfileOverallTotals(bucket)).toEqual({ played: 10, wins: 6, losses: 3, draws: 1 })
  })
})

describe('applyRoundOutcome — distinctDaysPlayed', () => {
  it('increments on the first round ever', () => {
    const next = applyRoundOutcome(DEFAULT_STATS, WIN_P1, { gameMode: 'vsCpu', cpuDifficulty: 'normal', colors: COLORS }, DAY_1)
    expect(next.distinctDaysPlayed).toBe(1)
    expect(next.lastPlayedDate).toBe('2026-08-24')
  })

  it('does not increment again for a later round on the same local day', () => {
    const first = applyRoundOutcome(DEFAULT_STATS, WIN_P1, { gameMode: 'vsCpu', cpuDifficulty: 'normal', colors: COLORS }, DAY_1)
    const second = applyRoundOutcome(first, WIN_P1, { gameMode: 'vsCpu', cpuDifficulty: 'normal', colors: COLORS }, DAY_1_LATER)
    expect(second.distinctDaysPlayed).toBe(1)
  })

  it('increments again once the local day changes', () => {
    const first = applyRoundOutcome(DEFAULT_STATS, WIN_P1, { gameMode: 'vsCpu', cpuDifficulty: 'normal', colors: COLORS }, DAY_1)
    const second = applyRoundOutcome(first, WIN_P1, { gameMode: 'vsCpu', cpuDifficulty: 'normal', colors: COLORS }, DAY_2)
    expect(second.distinctDaysPlayed).toBe(2)
  })
})

describe('applyRoundOutcome — day streak', () => {
  function playOn(date: Date, prev: StatsState = DEFAULT_STATS) {
    return applyRoundOutcome(prev, WIN_P1, { gameMode: 'vsCpu', cpuDifficulty: 'normal', colors: COLORS }, date)
  }

  it('starts the streak at 1 on the very first day played', () => {
    const stats = playOn(DAY_1)
    expect(stats.currentDayStreak).toBe(1)
    expect(stats.bestDayStreak).toBe(1)
  })

  it('leaves the streak unchanged for a repeat round the same day', () => {
    let stats = playOn(DAY_1)
    stats = playOn(DAY_1_LATER, stats)
    expect(stats.currentDayStreak).toBe(1)
  })

  it('extends the streak on the very next consecutive day', () => {
    let stats = playOn(DAY_1)
    stats = playOn(DAY_2, stats)
    stats = playOn(DAY_3, stats)
    expect(stats.currentDayStreak).toBe(3)
    expect(stats.bestDayStreak).toBe(3)
  })

  it('resets the streak to 1 (not 0) after skipping a day, while bestDayStreak persists', () => {
    let stats = playOn(DAY_1)
    stats = playOn(DAY_2, stats)
    stats = playOn(DAY_3, stats)
    stats = playOn(DAY_5, stats) // skips DAY_4 — breaks the streak
    expect(stats.currentDayStreak).toBe(1)
    expect(stats.bestDayStreak).toBe(3)
  })

  it('extends correctly across a month boundary', () => {
    let stats = playOn(JAN_31)
    stats = playOn(FEB_1, stats)
    expect(stats.currentDayStreak).toBe(2)
  })
})

describe('applyRoundOutcome — firstGameResult', () => {
  it('is set from the very first round played, from seat 1s perspective', () => {
    expect(vsCpu(WIN_P1).firstGameResult).toBe('win')
    expect(vsCpu(DRAW).firstGameResult).toBe('draw')
    expect(vsCpu(WIN_P2).firstGameResult).toBe('loss') // seat 2 (the CPU) won
  })

  it('is never overwritten by a later round', () => {
    let stats = vsCpu(WIN_P1)
    expect(stats.firstGameResult).toBe('win')
    stats = vsCpu(WIN_P2, stats)
    expect(stats.firstGameResult).toBe('win')
  })
})

describe('selectors', () => {
  function statsWithColors(entries: Record<string, { played: number; wins: number }>): StatsState {
    const colors = Object.fromEntries(Object.entries(entries).map(([hex, { played, wins }]) => [hex, { played, wins, losses: played - wins, draws: 0 }]))
    return { ...DEFAULT_STATS, colors }
  }

  it('getOverallTotals sums vsCpu and twoPlayer, mirroring wins into losses for twoPlayer', () => {
    let stats = vsCpu(WIN_P1)
    stats = twoPlayer(WIN_P1, stats)
    stats = twoPlayer(DRAW, stats)
    const totals = getOverallTotals(stats)
    expect(totals).toEqual({ played: 3, wins: 2, losses: 1, draws: 1 })
  })

  it('getFavoriteColor picks the most-played color', () => {
    const stats = statsWithColors({ '#111111': { played: 2, wins: 1 }, '#222222': { played: 5, wins: 1 } })
    expect(getFavoriteColor(stats)).toBe('#222222')
  })

  it('getFavoriteColor returns null with no color history', () => {
    expect(getFavoriteColor(DEFAULT_STATS)).toBeNull()
  })

  it('getBestPerformingColor excludes colors under the minimum sample size', () => {
    const stats = statsWithColors({
      '#111111': { played: COLOR_STATS_MIN_SAMPLE - 1, wins: COLOR_STATS_MIN_SAMPLE - 1 }, // 100% win rate, too few games
      '#222222': { played: COLOR_STATS_MIN_SAMPLE, wins: 1 }
    })
    expect(getBestPerformingColor(stats)).toBe('#222222')
  })

  it('getBestPerformingColor returns null when nobody meets the sample threshold', () => {
    const stats = statsWithColors({ '#111111': { played: COLOR_STATS_MIN_SAMPLE - 1, wins: COLOR_STATS_MIN_SAMPLE - 1 } })
    expect(getBestPerformingColor(stats)).toBeNull()
  })

  it('getMaxSingleColorWins and getColorsWithAtLeastOneWin', () => {
    const stats = statsWithColors({ '#111111': { played: 5, wins: 3 }, '#222222': { played: 5, wins: 5 }, '#333333': { played: 1, wins: 0 } })
    expect(getMaxSingleColorWins(stats)).toBe(5)
    expect(getColorsWithAtLeastOneWin(stats)).toBe(2)
  })

  function profile(id: string, name: string): Profile {
    return { id, name, color: '#2196f3', tag: '😎', keyScheme: 'wasd', createdAt: 0, updatedAt: 0 }
  }

  function profileStatsWithRecord(played: number, wins: number, draws: number): ProfileStats {
    return { ...DEFAULT_PROFILE_STATS, twoPlayer: { played, p1Wins: wins, p2Wins: 0, draws } }
  }

  it('getProfileRankings sorts by wins then win rate, both descending', () => {
    const alice = profile('alice', 'Alice')
    const bob = profile('bob', 'Bob')
    const carol = profile('carol', 'Carol')
    const profileStats = {
      alice: profileStatsWithRecord(10, 5, 0), // 50% rate
      bob: profileStatsWithRecord(6, 6, 0), // more wins than alice
      carol: profileStatsWithRecord(8, 5, 0) // same wins as alice, better rate (5/8 > 5/10)
    }
    const rankings = getProfileRankings([alice, bob, carol], profileStats)
    expect(rankings.map((r) => r.profile.id)).toEqual(['bob', 'carol', 'alice'])
  })

  it('getProfileRankings includes a profile with no recorded games at played:0, winRate:0 (never NaN)', () => {
    const alice = profile('alice', 'Alice')
    const rankings = getProfileRankings([alice], {})
    expect(rankings).toEqual([{ profile: alice, played: 0, wins: 0, losses: 0, draws: 0, winRate: 0 }])
  })
})
