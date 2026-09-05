import { DEFAULT_DAY_STREAK, DEFAULT_OUTCOME_RECORD, DEFAULT_WIN_STREAK } from '@tastic/achievements'

import { ColorStats, CpuDifficulty, DifficultyRecord, ProfileStats, StatsState, TwoPlayerStats, VsCpuStats } from '@/types'

// Pulled out of hooks/useGameStats.tsx specifically so it's testable without dragging in
// @react-native-async-storage/async-storage, which throws at import time under Jest's plain Node
// environment (its native module is never linked there) — mirrors gameSettingsValidation.ts.

// A zeroed vsCpu bucket: an empty win/loss/draw record, an empty per-difficulty breakdown, and a
// zeroed win streak. Built from @tastic/achievements' own defaults rather than restating the
// literals, so this can't drift from the shapes those helpers actually produce. A function, not a
// constant — DEFAULT_PROFILE_STATS and DEFAULT_STATS below each need their own independent object,
// not two references to the same one (every consumer only ever spreads/reads these today, but a
// shared reference is a standing invitation for a future in-place mutation to corrupt both at once).
function createDefaultVsCpu(): VsCpuStats {
  return {
    ...DEFAULT_OUTCOME_RECORD,
    byDifficulty: {
      easy: { ...DEFAULT_OUTCOME_RECORD },
      normal: { ...DEFAULT_OUTCOME_RECORD },
      hard: { ...DEFAULT_OUTCOME_RECORD }
    },
    ...DEFAULT_WIN_STREAK
  }
}

function createDefaultTwoPlayer(): TwoPlayerStats {
  return { played: 0, p1Wins: 0, p2Wins: 0, draws: 0 }
}

// A fresh profile's starting bucket — same zeroed vsCpu/twoPlayer shape as DEFAULT_STATS' own
// top-level fields, since ProfileStats mirrors StatsState's decomposable parts (see types/index.ts).
export const DEFAULT_PROFILE_STATS: ProfileStats = {
  vsCpu: createDefaultVsCpu(),
  twoPlayer: createDefaultTwoPlayer(),
  colors: {},
  ...DEFAULT_DAY_STREAK
}

// vsCpu/twoPlayer/colors are re-created here rather than spread straight from
// DEFAULT_PROFILE_STATS, specifically so the two don't end up aliasing the same nested objects —
// see createDefaultVsCpu's own doc.
export const DEFAULT_STATS: StatsState = {
  ...DEFAULT_PROFILE_STATS,
  vsCpu: createDefaultVsCpu(),
  twoPlayer: createDefaultTwoPlayer(),
  colors: {},
  profiles: {},
  firstGameResult: null
}

function isValidDifficultyRecord(value: unknown): value is DifficultyRecord {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<DifficultyRecord>
  return typeof v.played === 'number' && typeof v.wins === 'number' && typeof v.losses === 'number' && typeof v.draws === 'number'
}

function isValidByDifficulty(value: unknown): value is Record<CpuDifficulty, DifficultyRecord> {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<Record<CpuDifficulty, DifficultyRecord>>
  return isValidDifficultyRecord(v.easy) && isValidDifficultyRecord(v.normal) && isValidDifficultyRecord(v.hard)
}

// Extracted out of isValidStats' own inline checks so isValidProfileStats (below) can validate a
// profile's own vsCpu/twoPlayer buckets against the exact same shape, rather than duplicating it.
function isValidVsCpuStats(value: unknown): value is VsCpuStats {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<VsCpuStats>
  return typeof v.played === 'number' && typeof v.wins === 'number' && typeof v.losses === 'number' && typeof v.draws === 'number' && isValidByDifficulty(v.byDifficulty) && typeof v.currentWinStreak === 'number' && typeof v.bestWinStreak === 'number'
}

function isValidTwoPlayerStats(value: unknown): value is TwoPlayerStats {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<TwoPlayerStats>
  return typeof v.played === 'number' && typeof v.p1Wins === 'number' && typeof v.p2Wins === 'number' && typeof v.draws === 'number'
}

function isValidColorStats(value: unknown): value is ColorStats {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<ColorStats>
  return typeof v.played === 'number' && typeof v.wins === 'number' && typeof v.losses === 'number' && typeof v.draws === 'number'
}

// Doesn't reject unrecognized keys in `colors` — a stray/corrupted key is just an inert extra map
// entry, not a reason to discard the whole stats blob (matches Theme.tsx's per-field fallback
// philosophy rather than gameSettingsValidation.ts's all-or-nothing shape check).
function isValidColorsMap(value: unknown): value is Record<string, ColorStats> {
  if (!value || typeof value !== 'object') return false
  return Object.values(value).every(isValidColorStats)
}

function isValidProfileStats(value: unknown): value is ProfileStats {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<ProfileStats>
  return isValidVsCpuStats(v.vsCpu) && isValidTwoPlayerStats(v.twoPlayer) && isValidColorsMap(v.colors) && typeof v.distinctDaysPlayed === 'number' && typeof v.currentDayStreak === 'number' && typeof v.bestDayStreak === 'number' && (v.lastPlayedDate === null || typeof v.lastPlayedDate === 'string')
}

// Doesn't reject unrecognized keys — a stray/corrupted profile id is just an inert extra map entry,
// not a reason to discard the whole stats blob, same philosophy as isValidColorsMap above.
function isValidProfileStatsMap(value: unknown): value is Record<string, ProfileStats> {
  if (!value || typeof value !== 'object') return false
  return Object.values(value).every(isValidProfileStats)
}

export function isValidStats(value: unknown): value is StatsState {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<StatsState>
  // v.profiles === undefined is valid (a blob stored before this field existed) — see
  // useGameStats.tsx's load-time `profiles ?? {}` normalize, the only "migration" this needs.
  return isValidVsCpuStats(v.vsCpu) && isValidTwoPlayerStats(v.twoPlayer) && isValidColorsMap(v.colors) && (v.profiles === undefined || isValidProfileStatsMap(v.profiles)) && typeof v.distinctDaysPlayed === 'number' && typeof v.currentDayStreak === 'number' && typeof v.bestDayStreak === 'number' && (v.lastPlayedDate === null || typeof v.lastPlayedDate === 'string') && (v.firstGameResult === null || v.firstGameResult === 'win' || v.firstGameResult === 'loss' || v.firstGameResult === 'draw')
}
