import { GridSizeTier, SpeedTier, TrailGrowthTier } from '@/types'

// Grid cell edge length in px per tier — cols/rows are derived from the safe area at this
// resolution (see utils/grid.ts). Matches the lobby's small/medium/large vehicle icons literally:
// 'small' means a SMALLER cell size, so the cycle's head/trail (which nearly fill their own cell —
// see GameBoard.tsx) render as a small, thin motorcycle-like line. 'large' means a larger cell
// size — a bigger, chunkier train-like body/trail, and fewer (bigger) cells covering the same
// physical board — less room to maneuver, and a coarser, lower-skill-ceiling near-miss margin.
// 'medium' is this app's original fixed CELL_SIZE.
export const GRID_CELL_PX: Record<GridSizeTier, number> = {
  small: 5,
  medium: 8,
  large: 14
}

export const DEFAULT_GRID_SIZE_TIER: GridSizeTier = 'medium'

// Every ms-per-tick constant below is tuned at GRID_CELL_PX.medium (this app's original fixed
// CELL_SIZE) — see scaleMsForCellPx, which rescales them to whichever tier is actually active so
// the cycle's on-screen (px/sec) pace stays constant across grid-size tiers instead of silently
// playing faster/slower depending which one is picked.
export const SPEED_TIER_INTERVAL_MS: Record<SpeedTier, number> = {
  slow: 90,
  normal: 63,
  fast: 43
}

// Speed ramp (optional, see SettingsDialog): every SPEED_RAMP_INTERVAL_MS of round time, the
// tick interval shrinks by SPEED_RAMP_DECREMENT_MS, floored at SPEED_RAMP_MIN_INTERVAL_MS — applied
// on top of whichever base tier is selected, so ramping from 'fast' gets to the floor much sooner
// than ramping from 'slow'. SPEED_RAMP_DECREMENT_MS/MIN_INTERVAL_MS are tuned at GRID_CELL_PX.medium
// for the same reason SPEED_TIER_INTERVAL_MS is (see scaleMsForCellPx); SPEED_RAMP_INTERVAL_MS is
// real round time, not a per-cell duration, so it doesn't scale.
export const SPEED_RAMP_INTERVAL_MS = 6000
export const SPEED_RAMP_DECREMENT_MS = 7
export const SPEED_RAMP_MIN_INTERVAL_MS = 26

// Net trail-length growth per tick, as a fraction of the append rate (see gameEngine.ts's
// shouldTrimTrailAt). 'static' (1) is the original behavior: the tail never follows, so the trail
// is the entire path since spawn, appended every tick and never trimmed. Below that, the tail
// follows — trimmed off the front on enough ticks to hold the trail's long-run growth at this
// fraction — so the board still inevitably fills in (same as 'static', just delayed) rather than
// settling into a fixed-length trail players could dodge forever.
export const TRAIL_GROWTH_RATE: Record<TrailGrowthTier, number> = {
  fast: 0.25,
  slow: 0.5,
  static: 1
}

// Rescales a ms value tuned at GRID_CELL_PX.medium to the active cell size, preserving on-screen
// px/sec pace: ms/tick scales linearly with px/tick (== cellPx), so px/sec cancels out to a
// constant regardless of which grid-size tier is active.
export function scaleMsForCellPx(referenceMs: number, cellPx: number): number {
  return referenceMs * (cellPx / GRID_CELL_PX.medium)
}

// Caps how much of a single rAF frame's gap counts toward round time (see useGameState.ts). A
// real stall — app backgrounded and resumed, a hidden browser tab, a long GC pause — can report a
// multi-second dt on the frame it recovers; from the player's perspective nothing happened during
// that stall, so it shouldn't dump seconds of "round time" into the ramp and jump straight to max
// speed the instant play resumes.
export const MAX_TICK_DT_MS = 250

// Onboarding zone overlay (see OnboardingOverlay.tsx): a "3, 2, 1, GO!" countdown, each digit
// held for ONBOARDING_COUNTDOWN_STEP_MS and "GO!" held for ONBOARDING_GO_HOLD_MS, then fades out
// over ONBOARDING_FADE_MS. The game loop itself doesn't start ticking until the fade completes,
// so the countdown IS the "get ready" beat.
export const ONBOARDING_COUNTDOWN_STEP_MS = 700
export const ONBOARDING_GO_HOLD_MS = 500

// How long the board sits on the crash's final frame before the round-over dialog appears (see
// game.tsx) — long enough to actually register what just happened (whose trail hit what) before
// it gets covered up.
export const ROUND_OVER_DIALOG_DELAY_MS = 700
export const ONBOARDING_FADE_MS = 300

// Lobby player-panel area (see lobby.tsx): whenever a real device rotation changes orientationMode
// or which physical side P1 lands on (see useP1OnRight), the panels fade out, the layout
// underneath swaps while invisible, then they fade back in — masking what would otherwise be an
// instant jump-cut as panels reflow or swap sides. Short and symmetric on purpose: this is masking
// a reflow that already happened at the OS's own pace, not a deliberate reveal like onboarding's.
export const LOBBY_PANEL_SWAP_FADE_MS = 180

// Matches @rific/auto-paper's ColorPicker defaultColors swatches exactly ('Blue' / 'Red') so a
// player who hasn't customized their color yet sees it correctly highlighted/checked in the
// swatch grid, instead of a default that doesn't match any swatch at all.
export const DEFAULT_P1_COLOR = '#2196f3'
export const DEFAULT_P2_COLOR = '#f44336'

// Below this pixel delta, a change to the measured board area (game.tsx's onLayout) is treated as
// jitter — a transient inset change (e.g. Android's gesture nav bar appearing), not a real resize
// — and ignored rather than remounting GameRound and discarding an in-progress round. A genuine
// rotation swaps width/height by hundreds of px, comfortably clearing this.
export const BOARD_RESIZE_THRESHOLD_PX = 40

// CPU difficulty (see utils/cpuAi.ts): both tiers below 'hard' still use the same flood-fill
// scoring, just follow it less faithfully — chance per tick of taking the second-best move
// instead of the best ('normal'), or a uniformly random non-instantly-fatal move instead of the
// best ('easy'). Reaction speed is never nerfed, only decision quality — see useGameState.ts.
// CPU_NORMAL_SUBOPTIMAL_CHANCE is rolled independently every tick (~16/sec at the default speed
// tier), so it compounds fast — 0.15 meant a >90% chance of at least one off-best move per second,
// which read as the bot zigzagging into itself and dying almost immediately instead of playing out
// a real match. Lowered so 'normal' still wobbles off the optimal line occasionally, but survives
// long enough to be a genuine opponent instead of a chaotic self-elimination.
export const CPU_NORMAL_SUBOPTIMAL_CHANCE = 0.05
export const CPU_EASY_RANDOM_CHANCE = 0.5

// Caps countReachableCells' flood fill (see cpuAi.ts/floodFill.ts) at this many cells. Once a
// candidate direction has this much open room, it reads as "plenty of space" regardless of the
// board's actual size — the bot only needs to compare candidates against each other, not know the
// exact count, and without a cap a large/maximized board would re-flood-fill most of the grid up
// to 3x every single tick. Scaled up from its previous value (300, at the previous CELL_SIZE of
// 14) to cover the same physical board area now that cells are smaller and there are more of them
// per unit area — otherwise this would read as "abundant" far too early relative to the real board.
export const CPU_FLOOD_FILL_CAP = 900
