import { mapUnlocksBySeat, useAchievements } from '@tastic/achievements'
import { createContext, ReactNode, useCallback, useContext, useMemo } from 'react'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { AchievementDefinition, CpuDifficulty, GameMode, Player, RoundOutcome, StatsState, UnlockedAchievementsState } from '@/types'
import { applyRoundOutcome, getProfileStatsView } from '@/utils/statsEngine'
import { DEFAULT_STATS, isValidStats } from '@/utils/statsValidation'

// Produces 'lightcycles.stats' and 'lightcycles.achievements' — byte-identical to the two keys this
// app has always written, so an existing install's stored blobs load unchanged after this port.
const STORAGE_NAMESPACE = 'lightcycles'

interface RecordRoundOutcomeContext {
  gameMode: GameMode
  cpuDifficulty: CpuDifficulty
  colors: Record<Player, string>
  profileIds?: Partial<Record<Player, string>>
}

// Returned by recordRoundOutcome below — `device` is the device-wide/"All Profiles" newly-unlocked
// list (bare-id keyed), `profiles` is a parallel per-seat breakdown of whatever that seat's OWN
// saved profile newly unlocked this round (only seats present in context.profileIds ever get an
// entry). Kept as two separate lists rather than one merged one because game.tsx's two toast paths
// (the plain vsCpu Snackbar vs. two-player's per-player facing dialogs) need to tell them apart.
export interface RecordRoundOutcomeResult {
  device: AchievementDefinition[]
  profiles: Partial<Record<Player, AchievementDefinition[]>>
}

interface GameStatsContextValue {
  stats: StatsState
  unlockedAchievements: UnlockedAchievementsState
  // False until the stored blobs have been read (or failed to read) — see @tastic/achievements' own
  // useAchievements doc: lets achievements.tsx hold off rendering "0 games played" over real,
  // still-loading data.
  loaded: boolean
  // Updates both stats and achievement-unlock state in one call, persisting each, and returns
  // whatever newly unlocked this round (empty lists if nothing did) so the caller can surface a
  // toast — see RecordRoundOutcomeResult above.
  recordRoundOutcome: (outcome: RoundOutcome, context: RecordRoundOutcomeContext) => RecordRoundOutcomeResult
  // Wipes both stored keys back to defaults — irreversible, so the caller is expected to confirm
  // with the player first (see achievements.tsx's reset confirmation dialog).
  resetAll: () => void
  // Permanently drops one profile's stats entry and its unlock history — used when deleting a
  // profile (see app/profiles.tsx), so a deleted profile doesn't leave orphaned data behind.
  // Irreversible, same as resetAll — the caller is expected to confirm with the player first.
  removeProfileStats: (profileId: string) => void
}

const GameStatsContext = createContext<GameStatsContextValue | null>(null)

interface Props {
  children: ReactNode
}

// Every profile bucket, synthesized into the full StatsState-shaped view its achievements are
// evaluated against — this is what gives per-profile tracking full parity with the device-wide
// pass, since the exact same predicates run over both (see statsEngine.ts's getProfileStatsView).
function profileViews(stats: StatsState): Record<string, StatsState> {
  return Object.fromEntries(Object.entries(stats.profiles).map(([profileId, bucket]) => [profileId, getProfileStatsView(bucket)]))
}

// Single source of truth for local stats/achievements, mounted once in _layout.tsx — same
// single-Provider rationale as useGameSettings.tsx (expo-router keeps prior screens mounted, so a
// per-screen AsyncStorage-backed copy could go stale or clobber a concurrent update).
//
// Loading, validation, the self-healing unlock backfill and both AsyncStorage writes now all live
// in @tastic/achievements' useAchievements — what stays here is the LightCycles-specific part: the
// stats shape, its funnel (applyRoundOutcome), and the seat-vs-profile-id translation below.
export function GameStatsProvider({ children }: Props) {
  const { stats, unlockedAchievements, loaded, recordOutcome, resetAll, removeProfile } = useAchievements<StatsState>({
    namespace: STORAGE_NAMESPACE,
    catalog: ACHIEVEMENT_CATALOG,
    defaultStats: DEFAULT_STATS,
    isValidStats,
    profileViews,
    // `profiles ?? {}` is the entire "migration" a blob stored before that field existed needs —
    // see isValidStats, which already treats an absent `profiles` key as valid.
    migrateStats: (stored) => ({ ...stored, profiles: stored.profiles ?? {} })
  })

  const recordRoundOutcome = useCallback(
    (outcome: RoundOutcome, context: RecordRoundOutcomeContext): RecordRoundOutcomeResult => {
      const result = recordOutcome((prev) => applyRoundOutcome(prev, outcome, context))

      // The package reports per-profile unlocks keyed by profile id, since it has no notion of
      // seats; game.tsx thinks in seats, so translate back through the same profileIds map that
      // produced them. A seat with no profile selected simply has no entry either way.
      const profiles = mapUnlocksBySeat([1, 2] as Player[], context.profileIds, result.profiles)

      return { device: result.device, profiles }
    },
    [recordOutcome]
  )

  const removeProfileStats = useCallback(
    (profileId: string) => {
      // The unlock keys are the package's to prune; this app's own stats blob is pruned by the
      // updater, since only this app knows where a profile's bucket lives inside StatsState.
      removeProfile(profileId, (prev) => {
        if (!(profileId in prev.profiles)) return prev
        const { [profileId]: _removed, ...rest } = prev.profiles
        return { ...prev, profiles: rest }
      })
    },
    [removeProfile]
  )

  const value = useMemo(() => ({ stats, unlockedAchievements, loaded, recordRoundOutcome, resetAll, removeProfileStats }), [stats, unlockedAchievements, loaded, recordRoundOutcome, resetAll, removeProfileStats])

  return <GameStatsContext.Provider value={value}>{children}</GameStatsContext.Provider>
}

export function useGameStats() {
  const ctx = useContext(GameStatsContext)
  if (!ctx) throw new Error('useGameStats must be used within a GameStatsProvider')
  return ctx
}
