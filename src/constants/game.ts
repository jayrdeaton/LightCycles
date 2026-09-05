import { CpuDifficulty, GridSizeTier, PowerupType, SpeedTier, TrailSpeedTier } from '@/types'

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

// Caps the board's own width via @tastic/core's computeContentBounds (see game.tsx) whenever
// extendIntoSafeArea is off — real phones/tablets in portrait (the match's permanently-locked
// orientation, see GameScreen's own comment) stay well under this and see gutterWidth === 0; it
// only actually kicks in on a maximized desktop-web window, where nothing else stops the board
// from stretching into an unplayably wide, short rectangle.
export const MAX_BOARD_CONTENT_WIDTH = 1000

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
// shouldTrimTrailAt). 'off' (1) is the original behavior: the tail never follows, so the trail
// is the entire path since spawn, appended every tick and never trimmed. Below that, the tail
// follows — trimmed off the front on enough ticks to hold the trail's long-run growth at this
// fraction — so the board still inevitably fills in (same as 'off', just delayed) rather than
// settling into a fixed-length trail players could dodge forever.
export const TRAIL_SPEED_RATE: Record<TrailSpeedTier, number> = {
  off: 1,
  medium: 0.5,
  fast: 0.25
}

// Below this length, a non-'off' tier still just grows every tick — trimming (see
// shouldTrimTrailAt) doesn't kick in until the trail's reached this many cells. Trims skipped
// during this grace period aren't caught up later; the round just starts a handful of ticks ahead
// of where the nominal rate alone would put it, which is the whole point. Without it, the trail
// spends its first few ticks at 1-2 cells regardless of tier — long enough for a 'fast' round to
// visibly start trimming before there's anything meaningful to trim, which is what actually read as
// "weird" at the very beginning: not a rendering bug on its own, just tuning the mechanic to stay
// out of the regime that triggers those edge cases in the first place (see GameBoard.tsx's
// tailEdgeEnd/edgeStart comments for what happens in it).
export const MIN_TRAIL_LENGTH_BEFORE_TRIM = 5

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

// A last beat once the death sequence (explosion + trail wipe, see GameBoard.tsx and
// deathAnimationDurationMs below) has already finished and the board's gone quiet — NOT the
// entire crash-to-dialog gap the way this used to be (see game.tsx, which now adds this on top of
// deathAnimationDurationMs's own totalMs rather than using it as the whole delay): the animation
// itself now covers most of "register what just happened," so this only needs to be a brief pause
// before it gets covered up, not a full second.
export const ROUND_OVER_DIALOG_HOLD_MS = 300
export const ONBOARDING_FADE_MS = 300

// ─── Death sequence (see GameBoard.tsx's DeathExplosion/deathWipePath) ─────────────────────────
// How long the crashed player's head takes to burst into the flash/ring/shards. Fixed, unlike the
// wipe below — an explosion at a single point has nothing to scale with trail length the way a
// wipe crossing every trail cell does.
export const DEATH_EXPLOSION_MS = 420

// How long the crashed player's trail takes to wipe itself out from head to tail, per cell —
// clamped below at DEATH_WIPE_MIN_MS/MAX_MS the same way TRAIL_SEVER_EAT_MS_PER_CELL's own
// severed-chunk eat-away is, and for the identical reason (trail length is unbounded), but at a
// noticeably lower per-cell rate than that constant's 18: a Prune/Shield break only ever severs a
// small chunk mid-round, while a death wipe can be walking a round-long trail hundreds of cells
// long — the same rate here would blow straight through the max clamp almost immediately and stop
// reading as scaling with trail length at all.
export const DEATH_WIPE_MS_PER_CELL = 6
export const DEATH_WIPE_MIN_MS = 250
export const DEATH_WIPE_MAX_MS = 1400

// Single source of truth for the death sequence's total timing, called independently by both
// GameBoard.tsx (drives the actual withTiming/withDelay calls that animate it) and game.tsx
// (schedules showResultDialog off the same numbers) — this is what guarantees the two can never
// drift apart: neither file computes its own duration, both call this against the same
// (post-crash, never-mutated-again) trail length.
export function deathAnimationDurationMs(trailLength: number): { explosionMs: number; wipeMs: number; totalMs: number } {
  const explosionMs = DEATH_EXPLOSION_MS
  // A 1-cell trail (crashed on the very first tick, before any real movement) has nothing for the
  // wipe to visibly consume — see GameBoard.tsx's deathWipePath, which already renders nothing
  // below 2 cells — so there's no reason to still hold the dialog back for DEATH_WIPE_MIN_MS of
  // nothing.
  const wipeMs = trailLength <= 1 ? 0 : Math.min(DEATH_WIPE_MAX_MS, Math.max(DEATH_WIPE_MIN_MS, trailLength * DEATH_WIPE_MS_PER_CELL))
  return { explosionMs, wipeMs, totalMs: explosionMs + wipeMs }
}

// Lobby player-panel area (see lobby.tsx): whenever a committed tilt reading changes orientationMode
// or which physical side P1 lands on (see useAccelerometerOrientation), the panels fade out, the
// layout underneath swaps while invisible, then they fade back in — masking what would otherwise be
// an instant jump-cut as panels reflow or swap sides. Short and symmetric on purpose: this is
// masking a reflow that already happened, not a deliberate reveal like onboarding's.
export const LOBBY_PANEL_SWAP_FADE_MS = 180

// Matches @rific/auto-paper's ColorPicker defaultColors swatches exactly ('Blue' / 'Red') so a
// player who hasn't customized their color yet sees it correctly highlighted/checked in the
// swatch grid, instead of a default that doesn't match any swatch at all.
export const DEFAULT_P1_COLOR = '#2196f3'
export const DEFAULT_P2_COLOR = '#f44336'

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

// ─── Powerups ───────────────────────────────────────────────────────────────
// Tick-based (not ms) throughout, matching TRAIL_SPEED_RATE's own precedent — see gameEngine.ts's
// tickGame, which already treats ticks (not wall-clock time) as this game's true unit of time.
// Real-world cadence then varies slightly with speedTier/gridSizeTier, same as every other
// tick-denominated constant here. Exactly one pickup is ever on the board at a time (see
// gameEngine.ts's maybeSpawnPickup) — a replacement appears the very next tick after one's
// collected, no interval/cooldown to wait out.
export const POWERUP_ALL_TYPES: PowerupType[] = ['overdrive', 'stasis', 'shield', 'prune', 'hack', 'overclock']

// Ticks a timed activation remains in force — see SpeedEffect/ControlEffect/ShieldEffect's own
// expiresAtTick comment. Tuned relative to 'normal' speed tier's ~16 ticks/sec.
export const POWERUP_EFFECT_DURATION_TICKS: Record<'overdrive' | 'stasis' | 'shield' | 'hack' | 'overclock', number> = {
  overdrive: 40, // ~2.5s of self-boost
  stasis: 24, // ~1.5s of forced opponent freeze — long enough to box them in, short enough not to just stall the round
  shield: 48, // ~3s armed window to actually reach a wall worth breaking through
  hack: 32, // ~2s of inverted opponent steering
  overclock: 32 // ~2s of forced opponent 2x speed
}

// Cells advanced in one tickGame sub-step loop for a boosted player — Stasis's 0 isn't a
// multiplier lookup, it's "skip movement entirely," handled as its own case in tickGame.
export const POWERUP_SPEED_MULTIPLIER: Record<'overdrive' | 'overclock', 2> = { overdrive: 2, overclock: 2 }

// Fraction of the opponent's own current trail length removed from its front on Prune activation
// — reuses trimTrailFront, the same slice-off-the-front primitive tickGame's periodic
// trailSpeedTier trim already uses, just applied all at once instead of gradually. Proportional
// rather than a fixed cell count so it stays a meaningful punish whether the round just started or
// has run long enough to leave a very long trail. Always leaves at least the head cell intact (see
// trimTrailFront's own clamp).
export const POWERUP_PRUNE_FRACTION = 0.5

// How long the segment severed by a Prune or a Shield break-through takes to visually eat itself
// away — see GameBoard.tsx's severed-segment animation, which replaces the instant, straight-line
// jump the tail's own live position used to make toward wherever the trail's new front ended up
// (routinely nowhere near the old one once several cells vanish at once, and never guaranteed to
// be axis-aligned with it — hence the diagonal streak this exists to fix). Scaled by how many
// cells actually got cut, clamped to a sane window either way: a 2-cell Shield nick shouldn't take
// as long as a Prune severing half a long trail, but neither should feel instant or drag on.
export const TRAIL_SEVER_EAT_MS_PER_CELL = 18
export const TRAIL_SEVER_EAT_MIN_MS = 120
export const TRAIL_SEVER_EAT_MAX_MS = 900

// Visual sizing for the on-board "mystery box" pickup glyph (see GameBoard.tsx's Powerups layer,
// which intentionally renders every pickup identically regardless of type) — floors above trail
// width so a pickup stays legible even on the 'small' grid tier's tiny cells.
export function powerupPickupRadiusPx(cellPx: number): number {
  return Math.max(cellPx * 1.8, 9)
}

// A player collects a pickup by driving through any cell within this Chebyshev radius of its own
// (1 = the pickup's own cell plus its full ring of 8 neighbors) — matching the glyph's own
// rendered footprint above, which visually spans well past a single cell, rather than requiring
// the exact cell dead-center (see gameEngine.ts's tickGame).
export const POWERUP_COLLECT_RADIUS_CELLS = 1

// On-board glyph animation timing — a quick grow/fade the instant a pickup spawns (so it doesn't
// just pop into existence), then an endless gentle pulse for as long as it sits uncollected (see
// GameBoard.tsx's PowerupGlyph). Purely cosmetic — never affects when it's actually collectible.
export const POWERUP_SPAWN_FADE_MS = 260
export const POWERUP_PULSE_DURATION_MS = 900
export const POWERUP_PULSE_SCALE = 0.16

// On-board head-effect-tell ring colors, keyed by what's actually driving the effect (not just its
// axis) so Overdrive/Stasis/Overclock read as visually distinct despite Overdrive and Overclock
// sharing the same 2x multiplier — a player should be able to tell "sped up because I chose to" from
// "sped up/frozen because my opponent did this to me" at a glance.
export const POWERUP_EFFECT_COLORS: Record<'overdrive' | 'stasis' | 'overclock' | 'hack' | 'shield', string> = {
  overdrive: '#FFC107', // gold — self speed-up
  stasis: '#29B6F6', // ice blue — frozen
  overclock: '#E53935', // red — danger, forced on you
  hack: '#AB47BC', // violet — control-axis interference
  shield: '#26C6DA' // bright cyan — invincible
}

// Held-item HUD badge icon per type (MDI names, matching the icon set already used throughout
// SettingsDialog/LobbySharedControls) — shown only once a pickup is collected, since the on-board
// glyph itself never reveals type (see powerupPickupRadiusPx's own comment).
export const POWERUP_ICONS: Record<PowerupType, string> = {
  overdrive: 'speedometer',
  stasis: 'pause-circle-outline',
  shield: 'shield-outline',
  prune: 'content-cut',
  hack: 'swap-horizontal-bold',
  overclock: 'chip'
}

// CPU powerup-awareness knobs, one config per difficulty tier — layered onto the existing
// flood-fill scoring the same way CPU_NORMAL_SUBOPTIMAL_CHANCE/CPU_EASY_RANDOM_CHANCE layer onto
// its base direction choice: same algorithm, different faithfulness per tier, not a different
// algorithm per tier. See cpuAi.ts's chooseCpuDirection/shouldCpuActivate.
export interface CpuPowerupAwareness {
  seekPickups: boolean // bias tied survival-safe directions toward a nearby pickup
  seekTieToleranceCells: number // how close two directions' space scores must be to let pickup-seeking break the tie
  defensiveCounters: boolean // pop held Shield when truly cornered
  opportunisticSelfUse: boolean // use held Overdrive proactively, not just reactively
  offensiveUse: boolean // use held Hack/Overclock/Stasis/Prune against the opponent when advantageous
}
export const CPU_POWERUP_AWARENESS: Record<CpuDifficulty, CpuPowerupAwareness> = {
  easy: { seekPickups: false, seekTieToleranceCells: 0, defensiveCounters: true, opportunisticSelfUse: false, offensiveUse: false },
  normal: { seekPickups: true, seekTieToleranceCells: 20, defensiveCounters: true, opportunisticSelfUse: true, offensiveUse: true },
  hard: { seekPickups: true, seekTieToleranceCells: 40, defensiveCounters: true, opportunisticSelfUse: true, offensiveUse: true }
}
export const POWERUP_CPU_OVERDRIVE_MIN_SPACE = 60 // "coast is clear" — floor for opportunistic Overdrive
export const POWERUP_CPU_OFFENSIVE_SPACE_THRESHOLD = 15 // opponent's own space this low = most punishing moment for Hack/Overclock/Stasis/Prune
export const POWERUP_CPU_OFFENSIVE_FALLBACK_CHANCE = 0.02 // per-tick chance to use Hack/Overclock/Stasis/Prune anyway, so 'normal'/'hard' don't hoard forever

// Per-tick chance the CPU "notices" it's currently Hack'd and steers to compensate — reasoning
// about the true best direction as always (see cpuAi.ts's chooseCpuDirection, which never itself
// knows about the inversion), then pre-inverting its own output so the automatic Hack flip cancels
// out and the correct direction still lands. Without this, a hacked CPU blindly applies the flip on
// top of its own genuinely-best choice, which reliably steers it into a wall whenever the correct
// escape happens to be lateral — a free kill rather than a real advantage earned by outplaying it.
// 'hard' always compensates (decision quality, not reaction speed, is what difficulty already
// models here — see chooseCpuDirection's own comment), so Hack stops being a steering handicap
// against it specifically, same as a genuinely sharp human opponent would shrug it off; 'normal'
// sometimes still gets caught out; 'easy' never adapts, same as its existing, deliberately weaker
// tier.
export const CPU_HACK_COMPENSATION_CHANCE: Record<CpuDifficulty, number> = { easy: 0, normal: 0.6, hard: 1 }
