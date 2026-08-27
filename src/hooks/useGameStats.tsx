import AsyncStorage from '@react-native-async-storage/async-storage'
import { createContext, ReactNode, useCallback, useContext, useEffect, useState } from 'react'

import { ACHIEVEMENT_CATALOG } from '@/constants/achievements'
import { AchievementDefinition, CpuDifficulty, GameMode, Player, RoundOutcome, StatsState, UnlockedAchievementsState } from '@/types'
import { evaluateUnlockedIds, evaluateUnlockedIdsForProfile, unlockedKey } from '@/utils/achievementEngine'
import { DEFAULT_ACHIEVEMENTS, isValidAchievements } from '@/utils/achievementsValidation'
import { applyRoundOutcome } from '@/utils/statsEngine'
import { DEFAULT_STATS, isValidStats } from '@/utils/statsValidation'

const STATS_STORAGE_KEY = 'lightcycles.stats'
const ACHIEVEMENTS_STORAGE_KEY = 'lightcycles.achievements'

interface RecordRoundOutcomeContext {
  gameMode: GameMode
  cpuDifficulty: CpuDifficulty
  colors: Record<Player, string>
  profileIds?: Partial<Record<Player, string>>
}

// Returned by recordRoundOutcome below — `device` is the existing device-wide/"All Profiles"
// newly-unlocked list (bare-id keyed, exactly as before this shape split), `profiles` is a parallel
// per-seat breakdown of whatever that seat's OWN saved profile newly unlocked this round (only seats
// present in context.profileIds ever get an entry). Kept as two separate lists rather than one
// merged one because game.tsx's two toast paths (the plain vsCpu Snackbar vs. two-player's
// per-player facing dialogs) need to tell them apart.
export interface RecordRoundOutcomeResult {
  device: AchievementDefinition[]
  profiles: Partial<Record<Player, AchievementDefinition[]>>
}

interface GameStatsContextValue {
  stats: StatsState
  unlockedAchievements: UnlockedAchievementsState
  // Updates both stats and achievement-unlock state in one call, persisting each, and returns
  // whatever newly unlocked this round (empty lists if nothing did) so the caller can surface a
  // toast — see RecordRoundOutcomeResult above.
  recordRoundOutcome: (outcome: RoundOutcome, context: RecordRoundOutcomeContext) => RecordRoundOutcomeResult
  // Wipes both stored keys back to defaults — irreversible, so the caller is expected to confirm
  // with the player first (see achievements.tsx's reset confirmation dialog).
  resetAll: () => void
  // Permanently drops one profile's stats entry — used when deleting a profile (see
  // app/profiles.tsx), so a deleted profile doesn't leave its stats behind as orphaned data.
  // Irreversible, same as resetAll — the caller is expected to confirm with the player first.
  removeProfileStats: (profileId: string) => void
}

const GameStatsContext = createContext<GameStatsContextValue | null>(null)

interface Props {
  children: ReactNode
}

// Self-healing sweep, both device-wide (as before) and now per-profile: covers a catalog gaining a
// new achievement that existing stats already clear, and the rare case where the stats write
// succeeded but the achievements write didn't. The per-profile pass only needs stats.profiles' own
// keys, not the full Profile[] roster from useProfiles() — which matters, since GameStatsProvider is
// mounted as an ancestor of ProfilesProvider in _layout.tsx and structurally can't reach it.
function backfillUnlocked(stats: StatsState, unlocked: UnlockedAchievementsState): UnlockedAchievementsState {
  let next = unlocked

  const missingDevice = [...evaluateUnlockedIds(stats)].filter((id) => !(id in next))
  if (missingDevice.length > 0) {
    next = { ...next }
    missingDevice.forEach((id) => {
      next[id] = Date.now()
    })
  }

  for (const profileId of Object.keys(stats.profiles)) {
    const missing = [...evaluateUnlockedIdsForProfile(stats.profiles[profileId])].filter((id) => !(unlockedKey(id, profileId) in next))
    if (missing.length === 0) continue
    if (next === unlocked) next = { ...unlocked }
    missing.forEach((id) => {
      next[unlockedKey(id, profileId)] = Date.now()
    })
  }

  return next
}

// Single source of truth for local stats/achievements, mounted once in _layout.tsx — same
// single-Provider rationale as useGameSettings.tsx (expo-router keeps prior screens mounted, so a
// per-screen AsyncStorage-backed copy could go stale or clobber a concurrent update).
export function GameStatsProvider({ children }: Props) {
  const [stats, setStats] = useState<StatsState>(DEFAULT_STATS)
  const [unlockedAchievements, setUnlockedAchievements] = useState<UnlockedAchievementsState>(DEFAULT_ACHIEVEMENTS)

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(STATS_STORAGE_KEY), AsyncStorage.getItem(ACHIEVEMENTS_STORAGE_KEY)])
      .then(([storedStats, storedAchievements]) => {
        let loadedStats = DEFAULT_STATS
        if (storedStats) {
          try {
            const parsed = JSON.parse(storedStats)
            // `profiles ?? {}` is the entire "migration" a blob stored before that field existed
            // needs — see isValidStats, which already treats an absent `profiles` key as valid.
            if (isValidStats(parsed)) loadedStats = { ...parsed, profiles: parsed.profiles ?? {} }
          } catch {
            // Corrupt/stale blob — keep defaults.
          }
        }

        let loadedAchievements = DEFAULT_ACHIEVEMENTS
        if (storedAchievements) {
          try {
            const parsed = JSON.parse(storedAchievements)
            if (isValidAchievements(parsed)) loadedAchievements = parsed
          } catch {
            // Corrupt/stale blob — keep defaults.
          }
        }

        // Self-healing backfill: covers a catalog gaining a new achievement that existing stats
        // already clear, and the rare case where the stats write succeeded but the achievements
        // write didn't.
        const reconciled = backfillUnlocked(loadedStats, loadedAchievements)
        if (reconciled !== loadedAchievements) AsyncStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(reconciled)).catch(() => {})

        setStats(loadedStats)
        setUnlockedAchievements(reconciled)
      })
      .catch(() => {
        // Unavailable storage — DEFAULT_STATS/DEFAULT_ACHIEVEMENTS already in state is a complete,
        // silent fallback, same as useGameSettings.tsx.
      })
  }, [])

  const recordRoundOutcome = useCallback(
    (outcome: RoundOutcome, context: RecordRoundOutcomeContext): RecordRoundOutcomeResult => {
      const nextStats = applyRoundOutcome(stats, outcome, context)

      const deviceUnlockedIds = evaluateUnlockedIds(nextStats)
      const device = ACHIEVEMENT_CATALOG.filter((achievement) => deviceUnlockedIds.has(achievement.id) && !(achievement.id in unlockedAchievements))

      const now = Date.now()
      let nextUnlocked = unlockedAchievements
      if (device.length > 0) {
        nextUnlocked = { ...nextUnlocked }
        device.forEach((achievement) => {
          nextUnlocked[achievement.id] = now
        })
      }

      const profiles: Partial<Record<Player, AchievementDefinition[]>> = {}
      if (context.profileIds) {
        for (const seat of [1, 2] as Player[]) {
          const profileId = context.profileIds[seat]
          if (!profileId) continue
          const profileStats = nextStats.profiles[profileId]
          if (!profileStats) continue
          const profileUnlockedIds = evaluateUnlockedIdsForProfile(profileStats)
          const newlyUnlockedForProfile = ACHIEVEMENT_CATALOG.filter((achievement) => profileUnlockedIds.has(achievement.id) && !(unlockedKey(achievement.id, profileId) in unlockedAchievements))
          if (newlyUnlockedForProfile.length === 0) continue
          profiles[seat] = newlyUnlockedForProfile
          if (nextUnlocked === unlockedAchievements) nextUnlocked = { ...unlockedAchievements }
          newlyUnlockedForProfile.forEach((achievement) => {
            nextUnlocked[unlockedKey(achievement.id, profileId)] = now
          })
        }
      }

      setStats(nextStats)
      AsyncStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(nextStats)).catch(() => {})

      if (nextUnlocked !== unlockedAchievements) {
        setUnlockedAchievements(nextUnlocked)
        AsyncStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(nextUnlocked)).catch(() => {})
      }

      return { device, profiles }
    },
    [stats, unlockedAchievements]
  )

  const resetAll = useCallback(() => {
    setStats(DEFAULT_STATS)
    setUnlockedAchievements(DEFAULT_ACHIEVEMENTS)
    AsyncStorage.removeItem(STATS_STORAGE_KEY).catch(() => {})
    AsyncStorage.removeItem(ACHIEVEMENTS_STORAGE_KEY).catch(() => {})
  }, [])

  const removeProfileStats = useCallback(
    (profileId: string) => {
      const hasStats = profileId in stats.profiles
      const unlockedKeysToDrop = Object.keys(unlockedAchievements).filter((key) => key.startsWith(`${profileId}:`))
      if (!hasStats && unlockedKeysToDrop.length === 0) return

      if (hasStats) {
        const { [profileId]: _removed, ...rest } = stats.profiles
        const nextStats = { ...stats, profiles: rest }
        setStats(nextStats)
        AsyncStorage.setItem(STATS_STORAGE_KEY, JSON.stringify(nextStats)).catch(() => {})
      }

      if (unlockedKeysToDrop.length > 0) {
        const nextUnlocked = { ...unlockedAchievements }
        unlockedKeysToDrop.forEach((key) => delete nextUnlocked[key])
        setUnlockedAchievements(nextUnlocked)
        AsyncStorage.setItem(ACHIEVEMENTS_STORAGE_KEY, JSON.stringify(nextUnlocked)).catch(() => {})
      }
    },
    [stats, unlockedAchievements]
  )

  return <GameStatsContext.Provider value={{ stats, unlockedAchievements, recordRoundOutcome, resetAll, removeProfileStats }}>{children}</GameStatsContext.Provider>
}

export function useGameStats() {
  const ctx = useContext(GameStatsContext)
  if (!ctx) throw new Error('useGameStats must be used within a GameStatsProvider')
  return ctx
}
