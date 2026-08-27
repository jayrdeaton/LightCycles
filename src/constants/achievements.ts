import { AchievementDefinition, AchievementTier, CpuDifficulty } from '@/types'
import { getColorsWithAtLeastOneWin, getMaxSingleColorWins, getOverallTotals } from '@/utils/statsEngine'

export const ACHIEVEMENT_TIER_COLORS: Record<AchievementTier, string> = {
  bronze: '#CD7F32',
  silver: '#C0C0C8',
  gold: '#FFD54F'
}

// Total colors in @rific/auto-paper's ColorPicker `defaultColors` swatch grid — hardcoded rather
// than imported, matching constants/game.ts's own precedent (DEFAULT_P1_COLOR/DEFAULT_P2_COLOR are
// hardcoded hex literals with a cross-reference comment) so this stays a dependency-light,
// Jest-safe constants file rather than importing a large multi-export UI package for one number.
const TOTAL_SWATCH_COLORS = 20

interface TieredThresholds {
  bronze: number
  silver: number
  gold: number
}

function tieredFamily(idPrefix: string, titles: Record<AchievementTier, string>, description: (threshold: number) => string, icon: string, thresholds: TieredThresholds, getValue: (stats: Parameters<AchievementDefinition['isUnlocked']>[0]) => number): AchievementDefinition[] {
  return (['bronze', 'silver', 'gold'] as AchievementTier[]).map((tier) => {
    const threshold = thresholds[tier]
    return {
      id: `${idPrefix}_${tier}`,
      title: titles[tier],
      description: description(threshold),
      tier,
      icon,
      isUnlocked: (stats) => getValue(stats) >= threshold,
      progress: (stats) => Math.min(1, getValue(stats) / threshold)
    }
  })
}

const CPU_DIFFICULTY_TIER: Record<CpuDifficulty, AchievementTier> = { easy: 'bronze', normal: 'silver', hard: 'gold' }
const CPU_DIFFICULTY_LABEL: Record<CpuDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }

function beatCpuFamily(): AchievementDefinition[] {
  const titles: Record<CpuDifficulty, string> = { easy: 'Rookie Slayer', normal: 'Worthy Opponent', hard: 'Giant Slayer' }
  return (['easy', 'normal', 'hard'] as CpuDifficulty[]).map((difficulty) => ({
    id: `beat_cpu_${difficulty}`,
    title: titles[difficulty],
    description: `Beat the CPU on ${CPU_DIFFICULTY_LABEL[difficulty]} difficulty.`,
    tier: CPU_DIFFICULTY_TIER[difficulty],
    icon: 'robot',
    isUnlocked: (stats) => stats.vsCpu.byDifficulty[difficulty].wins >= 1
  }))
}

export const ACHIEVEMENT_CATALOG: AchievementDefinition[] = [
  // First-game one-offs lead the list — they're the achievements a new player unlocks soonest, so
  // they shouldn't be buried under a dozen tiered entries that take much longer to clear.
  {
    id: 'first_game_played',
    title: 'First Cycle',
    description: 'Play your first game.',
    tier: 'bronze',
    icon: 'flag-checkered',
    isUnlocked: (stats) => stats.vsCpu.played + stats.twoPlayer.played >= 1
  },
  {
    id: 'first_ever_win',
    title: 'First Victory',
    // Deliberately distinct from Beginner's Luck's copy below — this one's earnable any game,
    // any time, not just the very first, so it shouldn't read as the same achievement.
    description: 'Win a game — any game, any time.',
    // Bronze, not silver: this clears almost as fast as First Cycle for most players (a near-50%
    // shot every game), so it shouldn't share a tier with achievements that take real effort.
    tier: 'bronze',
    icon: 'star',
    isUnlocked: (stats) => getOverallTotals(stats).wins >= 1
  },
  {
    id: 'flawless_debut',
    title: "Beginner's Luck",
    description: 'Win the very first game you ever play.',
    tier: 'gold',
    icon: 'star-circle',
    // The one true global exception (see types/index.ts's AchievementDefinition.scope doc): reads
    // firstGameResult, a one-time device-wide flag set from seat 1's perspective on the very first
    // round ever recorded, with no profile identity at all — always evaluated against the real
    // device StatsState regardless of which profile tab is selected on the achievements screen.
    scope: 'device',
    isUnlocked: (stats) => stats.firstGameResult === 'win'
  },
  ...tieredFamily(
    'games_played',
    { bronze: 'Getting Started', silver: 'Regular', gold: 'Veteran' },
    (n) => `Play ${n} total games.`,
    'gamepad-variant',
    { bronze: 10, silver: 50, gold: 200 },
    (stats) => stats.vsCpu.played + stats.twoPlayer.played
  ),
  ...tieredFamily(
    'total_wins',
    { bronze: 'Winner', silver: 'Big Winner', gold: 'Champion' },
    (n) => `Win ${n} total games.`,
    'trophy',
    { bronze: 10, silver: 50, gold: 200 },
    (stats) => getOverallTotals(stats).wins
  ),
  ...tieredFamily(
    'cpu_streak',
    { bronze: 'On a Roll', silver: 'Hot Streak', gold: 'Unstoppable' },
    (n) => `Win ${n} games in a row against the CPU.`,
    'fire',
    { bronze: 3, silver: 5, gold: 10 },
    (stats) => stats.vsCpu.bestWinStreak
  ),
  ...beatCpuFamily(),
  ...tieredFamily('color_mastery', { bronze: 'Color Novice', silver: 'Color Expert', gold: 'Color Master' }, (n) => `Win ${n} games with a single color.`, 'palette', { bronze: 10, silver: 25, gold: 50 }, getMaxSingleColorWins),
  ...tieredFamily('color_collector', { bronze: 'Branching Out', silver: 'Rainbow Rider', gold: 'Full Spectrum' }, (n) => `Win with ${n} different colors.`, 'palette-swatch', { bronze: 5, silver: 12, gold: TOTAL_SWATCH_COLORS }, getColorsWithAtLeastOneWin),
  ...tieredFamily(
    'draws',
    { bronze: 'Stalemate', silver: 'Deadlock', gold: 'Mutually Assured' },
    (n) => `Draw ${n} games.`,
    'handshake-outline',
    { bronze: 5, silver: 15, gold: 40 },
    (stats) => stats.vsCpu.draws + stats.twoPlayer.draws
  ),
  ...tieredFamily(
    'local_matches',
    { bronze: 'Pass the Controller', silver: 'Couch Champion', gold: 'Living Room Legend' },
    (n) => `Play ${n} local two-player games.`,
    'account-multiple',
    { bronze: 10, silver: 50, gold: 150 },
    (stats) => stats.twoPlayer.played
  ),
  ...tieredFamily(
    'days_played',
    { bronze: 'Regular Visitor', silver: 'Dedicated', gold: 'Devoted' },
    (n) => `Play ${n} days in a row.`,
    'calendar-check',
    { bronze: 3, silver: 14, gold: 30 },
    (stats) => stats.bestDayStreak
  )
]
