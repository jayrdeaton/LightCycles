import { ProfileStats, StatsState } from '@/types'
import { evaluateUnlockedIds, evaluateUnlockedIdsForProfile, unlockedKey } from '@/utils/achievementEngine'
import { DEFAULT_PROFILE_STATS, DEFAULT_STATS } from '@/utils/statsValidation'

function stats(overrides: Partial<StatsState>): StatsState {
  return { ...DEFAULT_STATS, ...overrides }
}

describe('evaluateUnlockedIds', () => {
  it('unlocks nothing for a completely fresh stats state', () => {
    expect(evaluateUnlockedIds(DEFAULT_STATS).size).toBe(0)
  })

  it('unlocks games_played_bronze at exactly the threshold, not one below', () => {
    const oneBelow = stats({ vsCpu: { ...DEFAULT_STATS.vsCpu, played: 9 } })
    const atThreshold = stats({ vsCpu: { ...DEFAULT_STATS.vsCpu, played: 10 } })
    expect(evaluateUnlockedIds(oneBelow).has('games_played_bronze')).toBe(false)
    expect(evaluateUnlockedIds(atThreshold).has('games_played_bronze')).toBe(true)
  })

  it('unlocks only the tiers whose threshold is met, not higher ones', () => {
    const unlocked = evaluateUnlockedIds(stats({ vsCpu: { ...DEFAULT_STATS.vsCpu, played: 50 } }))
    expect(unlocked.has('games_played_bronze')).toBe(true)
    expect(unlocked.has('games_played_silver')).toBe(true)
    expect(unlocked.has('games_played_gold')).toBe(false)
  })

  it('unlocks total_wins family off getOverallTotals, combining vsCpu and twoPlayer wins', () => {
    const unlocked = evaluateUnlockedIds(
      stats({
        vsCpu: { ...DEFAULT_STATS.vsCpu, wins: 6 },
        twoPlayer: { ...DEFAULT_STATS.twoPlayer, p1Wins: 3, p2Wins: 1 }
      })
    )
    expect(unlocked.has('total_wins_bronze')).toBe(true) // 6 + 3 + 1 = 10
  })

  it('unlocks cpu_streak family off bestWinStreak, not currentWinStreak', () => {
    const unlocked = evaluateUnlockedIds(stats({ vsCpu: { ...DEFAULT_STATS.vsCpu, currentWinStreak: 0, bestWinStreak: 10 } }))
    expect(unlocked.has('cpu_streak_gold')).toBe(true)
  })

  it('unlocks beat_cpu achievements independently per difficulty', () => {
    const easyOnly = stats({
      vsCpu: {
        ...DEFAULT_STATS.vsCpu,
        byDifficulty: { ...DEFAULT_STATS.vsCpu.byDifficulty, easy: { played: 1, wins: 1, losses: 0, draws: 0 } }
      }
    })
    const unlocked = evaluateUnlockedIds(easyOnly)
    expect(unlocked.has('beat_cpu_easy')).toBe(true)
    expect(unlocked.has('beat_cpu_normal')).toBe(false)
    expect(unlocked.has('beat_cpu_hard')).toBe(false)
  })

  it('unlocks color_mastery off the max single-color win count', () => {
    const unlocked = evaluateUnlockedIds(stats({ colors: { '#2196f3': { played: 10, wins: 10, losses: 0, draws: 0 } } }))
    expect(unlocked.has('color_mastery_bronze')).toBe(true)
    expect(unlocked.has('color_mastery_silver')).toBe(false)
  })

  it('unlocks color_collector off the count of distinct colors with at least one win', () => {
    const colors = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`#${i}${i}${i}${i}${i}${i}`, { played: 1, wins: 1, losses: 0, draws: 0 }]))
    const unlocked = evaluateUnlockedIds(stats({ colors }))
    expect(unlocked.has('color_collector_bronze')).toBe(true)
    expect(unlocked.has('color_collector_silver')).toBe(false)
  })

  it('unlocks draws family off the combined vsCpu + twoPlayer draw count', () => {
    const unlocked = evaluateUnlockedIds(
      stats({
        vsCpu: { ...DEFAULT_STATS.vsCpu, draws: 3 },
        twoPlayer: { ...DEFAULT_STATS.twoPlayer, draws: 2 }
      })
    )
    expect(unlocked.has('draws_bronze')).toBe(true)
  })

  it('unlocks local_matches off twoPlayer.played only', () => {
    const unlocked = evaluateUnlockedIds(stats({ twoPlayer: { ...DEFAULT_STATS.twoPlayer, played: 10 }, vsCpu: { ...DEFAULT_STATS.vsCpu, played: 999 } }))
    expect(unlocked.has('local_matches_bronze')).toBe(true)
  })

  it('unlocks days_played off bestDayStreak (consecutive days), not distinctDaysPlayed', () => {
    expect(evaluateUnlockedIds(stats({ bestDayStreak: 2, distinctDaysPlayed: 999 })).has('days_played_bronze')).toBe(false)
    expect(evaluateUnlockedIds(stats({ bestDayStreak: 3, distinctDaysPlayed: 3 })).has('days_played_bronze')).toBe(true)
  })

  it('unlocks first_game_played as soon as any game has been played', () => {
    expect(evaluateUnlockedIds(stats({ vsCpu: { ...DEFAULT_STATS.vsCpu, played: 1 } })).has('first_game_played')).toBe(true)
  })

  it('unlocks first_ever_win off any win, vsCpu or twoPlayer', () => {
    expect(evaluateUnlockedIds(stats({ twoPlayer: { ...DEFAULT_STATS.twoPlayer, p1Wins: 1 } })).has('first_ever_win')).toBe(true)
  })

  it('unlocks flawless_debut only when firstGameResult is a win', () => {
    expect(evaluateUnlockedIds(stats({ firstGameResult: 'win' })).has('flawless_debut')).toBe(true)
    expect(evaluateUnlockedIds(stats({ firstGameResult: 'draw' })).has('flawless_debut')).toBe(false)
    expect(evaluateUnlockedIds(stats({ firstGameResult: 'loss' })).has('flawless_debut')).toBe(false)
    expect(evaluateUnlockedIds(stats({ firstGameResult: null })).has('flawless_debut')).toBe(false)
  })
})

describe('unlockedKey', () => {
  it('returns the bare achievement id for a device-wide/"All Profiles" unlock (profileId null)', () => {
    expect(unlockedKey('total_wins_bronze', null)).toBe('total_wins_bronze')
  })

  it('returns a profileId:achievementId composite for a profile-scoped unlock', () => {
    expect(unlockedKey('total_wins_bronze', 'profile-1')).toBe('profile-1:total_wins_bronze')
  })
})

describe('evaluateUnlockedIdsForProfile', () => {
  function profileStats(overrides: Partial<ProfileStats>): ProfileStats {
    return { ...DEFAULT_PROFILE_STATS, ...overrides }
  }

  it('unlocks nothing for a completely fresh profile bucket', () => {
    expect(evaluateUnlockedIdsForProfile(DEFAULT_PROFILE_STATS).size).toBe(0)
  })

  it('unlocks off the profile bucket alone, independent of device-wide stats', () => {
    const unlocked = evaluateUnlockedIdsForProfile(profileStats({ vsCpu: { ...DEFAULT_PROFILE_STATS.vsCpu, played: 10, wins: 10 } }))
    expect(unlocked.has('games_played_bronze')).toBe(true)
    expect(unlocked.has('total_wins_bronze')).toBe(true)
  })

  it('never includes a scope:"device" achievement (flawless_debut), regardless of the profile bucket', () => {
    // getProfileStatsView forces firstGameResult: null on the synthesized view, so this would
    // already fail flawless_debut's own predicate — this test guards the scope filter itself, not
    // just that particular predicate's behavior, in case a future device-scoped achievement doesn't
    // happen to read a null-defaulted field.
    const unlocked = evaluateUnlockedIdsForProfile(profileStats({ vsCpu: { ...DEFAULT_PROFILE_STATS.vsCpu, played: 999, wins: 999 } }))
    expect(unlocked.has('flawless_debut')).toBe(false)
  })
})
