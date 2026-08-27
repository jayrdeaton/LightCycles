import { DEFAULT_ACHIEVEMENTS, isValidAchievements } from '@/utils/achievementsValidation'

describe('isValidAchievements', () => {
  it('accepts DEFAULT_ACHIEVEMENTS', () => {
    expect(isValidAchievements(DEFAULT_ACHIEVEMENTS)).toBe(true)
  })

  it('accepts a populated unlocked-achievements map', () => {
    expect(isValidAchievements({ first_game_played: 1700000000000, total_wins_bronze: 1700000500000 })).toBe(true)
  })

  it('rejects non-objects', () => {
    expect(isValidAchievements(null)).toBe(false)
    expect(isValidAchievements(undefined)).toBe(false)
    expect(isValidAchievements('achievements')).toBe(false)
    expect(isValidAchievements(42)).toBe(false)
  })

  it('rejects a map with a non-numeric value', () => {
    expect(isValidAchievements({ first_game_played: 'yesterday' })).toBe(false)
  })

  it('rejects a map with a non-finite value', () => {
    expect(isValidAchievements({ first_game_played: Infinity })).toBe(false)
    expect(isValidAchievements({ first_game_played: NaN })).toBe(false)
  })

  it('does not reject an unrecognized achievement id — a stray entry is inert, not corrupt', () => {
    expect(isValidAchievements({ some_removed_achievement: 1700000000000 })).toBe(true)
  })

  // See achievementEngine.ts's unlockedKey — a bare id is a device-wide/"All Profiles" unlock, a
  // `profileId:achievementId` id is one profile's own unlock. This validator doesn't need to (and
  // doesn't) distinguish between the two formats.
  it('accepts a blob mixing bare-id and profileId:achievementId keys', () => {
    expect(isValidAchievements({ first_game_played: 1700000000000, 'profile-1:total_wins_bronze': 1700000500000 })).toBe(true)
  })
})
