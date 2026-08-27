import { DEFAULT_PROFILE_STATS, DEFAULT_STATS, isValidStats } from '@/utils/statsValidation'

describe('isValidStats', () => {
  it('accepts DEFAULT_STATS', () => {
    expect(isValidStats(DEFAULT_STATS)).toBe(true)
  })

  it('accepts a populated stats object', () => {
    const populated = {
      ...DEFAULT_STATS,
      vsCpu: { ...DEFAULT_STATS.vsCpu, played: 5, wins: 3, losses: 2, currentWinStreak: 1, bestWinStreak: 2 },
      colors: { '#2196f3': { played: 5, wins: 3, losses: 2, draws: 0 } },
      distinctDaysPlayed: 2,
      lastPlayedDate: '2026-08-24',
      firstGameResult: 'win'
    }
    expect(isValidStats(populated)).toBe(true)
  })

  it('rejects non-objects', () => {
    expect(isValidStats(null)).toBe(false)
    expect(isValidStats(undefined)).toBe(false)
    expect(isValidStats('stats')).toBe(false)
    expect(isValidStats(42)).toBe(false)
  })

  it('rejects an object missing vsCpu or twoPlayer', () => {
    const { vsCpu: _vsCpu, ...missingVsCpu } = DEFAULT_STATS
    expect(isValidStats(missingVsCpu)).toBe(false)

    const { twoPlayer: _twoPlayer, ...missingTwoPlayer } = DEFAULT_STATS
    expect(isValidStats(missingTwoPlayer)).toBe(false)
  })

  it('rejects vsCpu.byDifficulty missing a tier', () => {
    const { hard: _hard, ...missingHard } = DEFAULT_STATS.vsCpu.byDifficulty
    expect(isValidStats({ ...DEFAULT_STATS, vsCpu: { ...DEFAULT_STATS.vsCpu, byDifficulty: missingHard } })).toBe(false)
  })

  it('rejects a byDifficulty entry with a non-numeric field', () => {
    const corrupt = { ...DEFAULT_STATS.vsCpu.byDifficulty, easy: { ...DEFAULT_STATS.vsCpu.byDifficulty.easy, wins: '3' } }
    expect(isValidStats({ ...DEFAULT_STATS, vsCpu: { ...DEFAULT_STATS.vsCpu, byDifficulty: corrupt } })).toBe(false)
  })

  it('rejects a colors entry with a non-numeric field', () => {
    expect(isValidStats({ ...DEFAULT_STATS, colors: { '#2196f3': { played: 1, wins: '1', losses: 0, draws: 0 } } })).toBe(false)
  })

  it('does not reject an unrecognized colors key — a stray entry is inert, not corrupt', () => {
    expect(isValidStats({ ...DEFAULT_STATS, colors: { 'not-a-hex': { played: 1, wins: 0, losses: 1, draws: 0 } } })).toBe(true)
  })

  it('rejects a non-object colors map', () => {
    expect(isValidStats({ ...DEFAULT_STATS, colors: 'none' })).toBe(false)
  })

  it('accepts every valid firstGameResult value', () => {
    for (const firstGameResult of ['win', 'loss', 'draw']) {
      expect(isValidStats({ ...DEFAULT_STATS, firstGameResult })).toBe(true)
    }
  })

  it('rejects an invalid firstGameResult', () => {
    expect(isValidStats({ ...DEFAULT_STATS, firstGameResult: 'tie' })).toBe(false)
  })

  it('accepts a null lastPlayedDate and firstGameResult', () => {
    expect(isValidStats({ ...DEFAULT_STATS, lastPlayedDate: null, firstGameResult: null })).toBe(true)
  })

  it('rejects a non-numeric distinctDaysPlayed', () => {
    expect(isValidStats({ ...DEFAULT_STATS, distinctDaysPlayed: '2' })).toBe(false)
  })

  it('rejects a non-numeric currentDayStreak or bestDayStreak', () => {
    expect(isValidStats({ ...DEFAULT_STATS, currentDayStreak: '2' })).toBe(false)
    expect(isValidStats({ ...DEFAULT_STATS, bestDayStreak: '2' })).toBe(false)
  })

  it('accepts a stats object with no profiles field at all — a pre-profiles stored blob', () => {
    const { profiles: _profiles, ...withoutProfiles } = DEFAULT_STATS
    expect(isValidStats(withoutProfiles)).toBe(true)
  })

  it('accepts a populated profiles map', () => {
    const profileStats = { ...DEFAULT_PROFILE_STATS, twoPlayer: { ...DEFAULT_PROFILE_STATS.twoPlayer, played: 3, p1Wins: 2 } }
    expect(isValidStats({ ...DEFAULT_STATS, profiles: { 'profile-1': profileStats } })).toBe(true)
  })

  it('rejects a profiles entry with a non-numeric field', () => {
    const corrupt = { ...DEFAULT_PROFILE_STATS, twoPlayer: { ...DEFAULT_PROFILE_STATS.twoPlayer, played: '3' } }
    expect(isValidStats({ ...DEFAULT_STATS, profiles: { 'profile-1': corrupt } })).toBe(false)
  })

  it('rejects a profiles entry missing its vsCpu or twoPlayer bucket', () => {
    const { vsCpu: _vsCpu, ...missingVsCpu } = DEFAULT_PROFILE_STATS
    expect(isValidStats({ ...DEFAULT_STATS, profiles: { 'profile-1': missingVsCpu } })).toBe(false)
  })

  // Documents the accepted pre-ship migration gap (see statsValidation.ts's own comment on
  // isValidProfileStatsMap): a profiles entry stored under the old flat {played,wins,losses,draws}
  // shape, from before ProfileStats gained the full vsCpu/twoPlayer/colors/day-streak fields, fails
  // this check — and per the all-or-nothing philosophy shared with isValidColorsMap, that fails the
  // whole stats blob, not just the profiles field.
  it('rejects an old flat-shaped profiles entry', () => {
    expect(isValidStats({ ...DEFAULT_STATS, profiles: { 'profile-1': { played: 3, wins: 2, losses: 1, draws: 0 } } })).toBe(false)
  })

  it('rejects a non-object profiles map', () => {
    expect(isValidStats({ ...DEFAULT_STATS, profiles: 'none' })).toBe(false)
  })
})
