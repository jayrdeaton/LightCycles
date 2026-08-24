import { DEFAULT_GRID_SIZE_TIER, POWERUP_ALL_TYPES } from '@/constants/game'
import { GameSettings, KeyScheme, PowerupType } from '@/types'

// Pulled out of hooks/useGameSettings.ts specifically so it's testable without dragging in
// @react-native-async-storage/async-storage, which throws at import time under Jest's plain Node
// environment (its native module is never linked there) — see useGameSettings.ts's own import.
export const DEFAULT_SETTINGS: GameSettings = {
  speedTier: 'normal',
  speedRampEnabled: false,
  gameMode: 'twoPlayer',
  cpuDifficulty: 'normal',
  gridSizeTier: DEFAULT_GRID_SIZE_TIER,
  trailSpeedTier: 'off',
  keyScheme: { 1: 'wasd', 2: 'arrows' },
  lockOrientation: false,
  enabledPowerups: []
}

function isValidKeyScheme(value: unknown): value is KeyScheme {
  return value === 'wasd' || value === 'arrows' || value === 'ijkl'
}

function isValidEnabledPowerups(value: unknown): value is PowerupType[] {
  return Array.isArray(value) && value.every((v) => POWERUP_ALL_TYPES.includes(v as PowerupType))
}

export function isValidSettings(value: unknown): value is GameSettings {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<GameSettings>
  return (v.speedTier === 'slow' || v.speedTier === 'normal' || v.speedTier === 'fast') && typeof v.speedRampEnabled === 'boolean' && (v.gameMode === 'twoPlayer' || v.gameMode === 'vsCpu') && (v.cpuDifficulty === 'easy' || v.cpuDifficulty === 'normal' || v.cpuDifficulty === 'hard') && (v.gridSizeTier === 'small' || v.gridSizeTier === 'medium' || v.gridSizeTier === 'large') && (v.trailSpeedTier === 'off' || v.trailSpeedTier === 'medium' || v.trailSpeedTier === 'fast') && !!v.keyScheme && isValidKeyScheme(v.keyScheme[1]) && isValidKeyScheme(v.keyScheme[2]) && typeof v.lockOrientation === 'boolean' && isValidEnabledPowerups(v.enabledPowerups)
}
