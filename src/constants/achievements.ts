import { AchievementTier, tieredFamily } from '@tastic/achievements'

import { AchievementDefinition, CpuDifficulty, StatsState } from '@/types'
import { getColorsWithAtLeastOneWin, getMaxSingleColorWins, getOverallTotals } from '@/utils/statsEngine'

// Re-exported so the achievements screen keeps importing its badge palette from this module
// alongside the catalog itself, rather than reaching into the package for one of the two.
export { ACHIEVEMENT_TIER_COLORS } from '@tastic/achievements'

// Total colors in @rific/auto-paper's ColorPicker `defaultColors` swatch grid — hardcoded rather
// than imported, matching constants/game.ts's own precedent (DEFAULT_P1_COLOR/DEFAULT_P2_COLOR are
// hardcoded hex literals with a cross-reference comment) so this stays a dependency-light,
// Jest-safe constants file rather than importing a large multi-export UI package for one number.
const TOTAL_SWATCH_COLORS = 20

const CPU_DIFFICULTY_TIER: Record<CpuDifficulty, AchievementTier> = { easy: 'bronze', normal: 'silver', hard: 'gold' }
const CPU_DIFFICULTY_LABEL: Record<CpuDifficulty, string> = { easy: 'Easy', normal: 'Normal', hard: 'Hard' }

// Not a tieredFamily: the three tiers here are three DIFFERENT predicates (one per difficulty),
// not one value measured against three thresholds, and "progress toward beating Hard once" isn't a
// meaningful fraction — so these are hand-written and deliberately carry no `progress`.
function beatCpuFamily(): AchievementDefinition[] {
  const titles: Record<CpuDifficulty, string> = { easy: 'Rookie Slayer', normal: 'Worthy Opponent', hard: 'Giant Slayer' }
  return (['easy', 'normal', 'hard'] as CpuDifficulty[]).map((difficulty) => ({
    id: `beat_cpu_${difficulty}`,
    title: titles[difficulty],
    description: `Beat the CPU on ${CPU_DIFFICULTY_LABEL[difficulty]} difficulty.`,
    tier: CPU_DIFFICULTY_TIER[difficulty],
    icon: 'robot',
    isUnlocked: (stats: StatsState) => stats.vsCpu.byDifficulty[difficulty].wins >= 1
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
    // The one true global exception (see types/index.ts's AchievementDefinition scope doc): reads
    // firstGameResult, a one-time device-wide flag set from seat 1's perspective on the very first
    // round ever recorded, with no profile identity at all — always evaluated against the real
    // device StatsState regardless of which profile tab is selected on the achievements screen.
    scope: 'device',
    isUnlocked: (stats) => stats.firstGameResult === 'win'
  },
  ...tieredFamily<StatsState>({
    id: 'games_played',
    titles: { bronze: 'Getting Started', silver: 'Regular', gold: 'Veteran' },
    description: (n) => `Play ${n} total games.`,
    icon: 'gamepad-variant',
    thresholds: { bronze: 10, silver: 50, gold: 200 },
    value: (stats) => stats.vsCpu.played + stats.twoPlayer.played
  }),
  ...tieredFamily<StatsState>({
    id: 'total_wins',
    titles: { bronze: 'Winner', silver: 'Big Winner', gold: 'Champion' },
    description: (n) => `Win ${n} total games.`,
    icon: 'trophy',
    thresholds: { bronze: 10, silver: 50, gold: 200 },
    value: (stats) => getOverallTotals(stats).wins
  }),
  ...tieredFamily<StatsState>({
    id: 'cpu_streak',
    titles: { bronze: 'On a Roll', silver: 'Hot Streak', gold: 'Unstoppable' },
    description: (n) => `Win ${n} games in a row against the CPU.`,
    icon: 'fire',
    thresholds: { bronze: 3, silver: 5, gold: 10 },
    value: (stats) => stats.vsCpu.bestWinStreak
  }),
  ...beatCpuFamily(),
  ...tieredFamily<StatsState>({
    id: 'color_mastery',
    titles: { bronze: 'Color Novice', silver: 'Color Expert', gold: 'Color Master' },
    description: (n) => `Win ${n} games with a single color.`,
    icon: 'palette',
    thresholds: { bronze: 10, silver: 25, gold: 50 },
    value: getMaxSingleColorWins
  }),
  ...tieredFamily<StatsState>({
    id: 'color_collector',
    titles: { bronze: 'Branching Out', silver: 'Rainbow Rider', gold: 'Full Spectrum' },
    description: (n) => `Win with ${n} different colors.`,
    icon: 'palette-swatch',
    thresholds: { bronze: 5, silver: 12, gold: TOTAL_SWATCH_COLORS },
    value: getColorsWithAtLeastOneWin
  }),
  ...tieredFamily<StatsState>({
    id: 'draws',
    titles: { bronze: 'Stalemate', silver: 'Deadlock', gold: 'Mutually Assured' },
    description: (n) => `Draw ${n} games.`,
    icon: 'handshake-outline',
    thresholds: { bronze: 5, silver: 15, gold: 40 },
    value: (stats) => stats.vsCpu.draws + stats.twoPlayer.draws
  }),
  ...tieredFamily<StatsState>({
    id: 'local_matches',
    titles: { bronze: 'Pass the Controller', silver: 'Couch Champion', gold: 'Living Room Legend' },
    description: (n) => `Play ${n} local two-player games.`,
    icon: 'account-multiple',
    thresholds: { bronze: 10, silver: 50, gold: 150 },
    value: (stats) => stats.twoPlayer.played
  }),
  ...tieredFamily<StatsState>({
    id: 'days_played',
    titles: { bronze: 'Regular Visitor', silver: 'Dedicated', gold: 'Devoted' },
    description: (n) => `Play ${n} days in a row.`,
    icon: 'calendar-check',
    thresholds: { bronze: 3, silver: 14, gold: 30 },
    value: (stats) => stats.bestDayStreak
  })
]
