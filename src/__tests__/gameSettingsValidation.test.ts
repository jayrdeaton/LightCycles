import { isValidSettings } from '@/utils/gameSettingsValidation'

const VALID = {
  speedTier: 'normal',
  speedRampEnabled: false,
  gameMode: 'twoPlayer',
  cpuDifficulty: 'normal',
  gridSizeTier: 'medium',
  trailGrowthTier: 'static',
  keyScheme: { 1: 'wasd', 2: 'arrows' },
  lockOrientation: false,
  enabledPowerups: []
}

describe('isValidSettings', () => {
  it('accepts a fully valid settings object', () => {
    expect(isValidSettings(VALID)).toBe(true)
  })

  it('accepts every valid enum value for each field', () => {
    for (const speedTier of ['slow', 'normal', 'fast']) {
      expect(isValidSettings({ ...VALID, speedTier })).toBe(true)
    }
    for (const gameMode of ['twoPlayer', 'vsCpu']) {
      expect(isValidSettings({ ...VALID, gameMode })).toBe(true)
    }
    for (const cpuDifficulty of ['easy', 'normal', 'hard']) {
      expect(isValidSettings({ ...VALID, cpuDifficulty })).toBe(true)
    }
    for (const gridSizeTier of ['small', 'medium', 'large']) {
      expect(isValidSettings({ ...VALID, gridSizeTier })).toBe(true)
    }
    for (const trailGrowthTier of ['fast', 'slow', 'static']) {
      expect(isValidSettings({ ...VALID, trailGrowthTier })).toBe(true)
    }
    for (const scheme of ['wasd', 'arrows', 'ijkl']) {
      expect(isValidSettings({ ...VALID, keyScheme: { 1: scheme, 2: scheme } })).toBe(true)
    }
  })

  it('rejects non-objects', () => {
    expect(isValidSettings(null)).toBe(false)
    expect(isValidSettings(undefined)).toBe(false)
    expect(isValidSettings('twoPlayer')).toBe(false)
    expect(isValidSettings(42)).toBe(false)
  })

  it('rejects an object missing a required field', () => {
    const { cpuDifficulty: _cpuDifficulty, ...missingCpuDifficulty } = VALID
    expect(isValidSettings(missingCpuDifficulty)).toBe(false)

    const { gridSizeTier: _gridSizeTier, ...missingGridSizeTier } = VALID
    expect(isValidSettings(missingGridSizeTier)).toBe(false)

    const { trailGrowthTier: _trailGrowthTier, ...missingTrailGrowthTier } = VALID
    expect(isValidSettings(missingTrailGrowthTier)).toBe(false)

    const { keyScheme: _keyScheme, ...missingKeyScheme } = VALID
    expect(isValidSettings(missingKeyScheme)).toBe(false)
  })

  it('rejects an object with an invalid enum value', () => {
    expect(isValidSettings({ ...VALID, speedTier: 'ludicrous' })).toBe(false)
    expect(isValidSettings({ ...VALID, gameMode: 'coop' })).toBe(false)
    expect(isValidSettings({ ...VALID, cpuDifficulty: 'nightmare' })).toBe(false)
    expect(isValidSettings({ ...VALID, gridSizeTier: 'huge' })).toBe(false)
    expect(isValidSettings({ ...VALID, trailGrowthTier: 'instant' })).toBe(false)
    expect(isValidSettings({ ...VALID, keyScheme: { 1: 'dvorak', 2: 'arrows' } })).toBe(false)
  })

  it('rejects a non-boolean speedRampEnabled', () => {
    expect(isValidSettings({ ...VALID, speedRampEnabled: 'true' })).toBe(false)
    expect(isValidSettings({ ...VALID, speedRampEnabled: 1 })).toBe(false)
  })

  it('rejects a non-boolean lockOrientation', () => {
    expect(isValidSettings({ ...VALID, lockOrientation: 'true' })).toBe(false)
    expect(isValidSettings({ ...VALID, lockOrientation: 1 })).toBe(false)
  })

  it('accepts a non-empty enabledPowerups list', () => {
    expect(isValidSettings({ ...VALID, enabledPowerups: ['overdrive', 'hack'] })).toBe(true)
  })

  it('rejects a non-array enabledPowerups', () => {
    expect(isValidSettings({ ...VALID, enabledPowerups: true })).toBe(false)
    expect(isValidSettings({ ...VALID, enabledPowerups: 'overdrive' })).toBe(false)
  })

  it('rejects an enabledPowerups list containing an invalid entry', () => {
    expect(isValidSettings({ ...VALID, enabledPowerups: ['overdrive', 'not-a-real-powerup'] })).toBe(false)
  })
})
