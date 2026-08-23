export type Player = 1 | 2

export type Direction = 'up' | 'down' | 'left' | 'right'

export type OrientationMode = 'faceToFace' | 'sideBySide'

export type SpeedTier = 'slow' | 'normal' | 'fast'

export type GameMode = 'twoPlayer' | 'vsCpu'

export type CpuDifficulty = 'easy' | 'normal' | 'hard'

export type GridSizeTier = 'small' | 'medium' | 'large'

// Named for how fast the trail's tail follows the head, not the visible outcome — describing the
// outcome (a fixed "short"/"full" length) read as backwards as describing the rate did (see
// lobby.tsx's TRAIL_GROWTH_OPTIONS), since the trail never actually settles at any fixed length
// under any tier — it still grows without bound, just slower than 1:1 when the tail follows.
// 'static' matches the game's original behavior: the tail never follows at all, so the trail is
// the entire path since spawn — see constants/game.ts's TRAIL_GROWTH_RATE and gameEngine.ts's
// shouldTrimTrailAt for the mechanics.
export type TrailGrowthTier = 'fast' | 'slow' | 'static'

export type KeyScheme = 'wasd' | 'arrows' | 'ijkl'

export type GamePhase = 'onboarding' | 'playing' | 'roundOver'

export type RoundOutcome = { type: 'win'; winner: Player } | { type: 'draw' }

// Overdrive is a self-targeted speed effect (2x); Overclock and Stasis are both opponent-targeted
// (2x/0x respectively — see gameEngine.ts's applyActivation) — kept as their own literals (not
// merged into Overdrive) so a boosted/frozen head can be told apart as "helping you" vs "done to
// you" for the on-board tell and CPU reasoning, even where the multiplier would otherwise match.
export type PowerupType = 'overdrive' | 'stasis' | 'shield' | 'prune' | 'hack' | 'overclock'

export interface SpeedEffect {
  type: 'overdrive' | 'stasis' | 'overclock'
  multiplier: 0 | 2
  // Absolute tick number this effect is in force through — tick-based (not a wall-clock
  // timestamp) to match the deterministic pure-tick model everything else here uses (see
  // shouldTrimTrailAt). Computed once at activation as `state.tick + duration` and never mutated
  // thereafter; tickGame just compares against it every tick.
  expiresAtTick: number
}

export interface ControlEffect {
  type: 'hack'
  expiresAtTick: number
}

export interface ShieldEffect {
  expiresAtTick: number
}

// One active effect per axis — a same-axis activation replaces whatever was already there rather
// than stacking (see applyActivation), which is what lets a landed Stasis instantly overwrite an
// existing Overclock (or vice versa) with a fresh timer instead of the two coexisting. Different
// axes coexist independently. Prune has no entry here at all — it's instant/one-shot, never an
// ongoing effect.
export interface PlayerEffects {
  speed: SpeedEffect | null
  control: ControlEffect | null
  shield: ShieldEffect | null
}

export interface PowerupPickup {
  id: string
  // Decided at spawn time (not collection) for simplicity — see GameBoard.tsx's Powerups layer,
  // which deliberately ignores this field and renders every live pickup identically, Mario-Kart
  // mystery-box style. Only revealed once collected, in the holder's own HUD badge.
  type: PowerupType
  cell: GridCell
}

export interface GridCell {
  x: number
  y: number
}

export interface GridSize {
  cols: number
  rows: number
}

export interface PlayerState {
  // Ordered cells the cycle has occupied, oldest first — trail[trail.length - 1] is the head.
  trail: GridCell[]
  direction: Direction
  // A turn queued by input but not yet applied — consumed (and cleared) on the next tick, so a
  // swipe that lands between ticks isn't dropped and can't apply more than one turn per tick.
  pendingDirection: Direction | null
  alive: boolean
  color: string
  // Single-slot inventory — null when empty. Set on pickup collection, cleared on activation.
  heldPowerup: PowerupType | null
  effects: PlayerEffects
}

export interface GameSettings {
  speedTier: SpeedTier
  speedRampEnabled: boolean
  gameMode: GameMode
  cpuDifficulty: CpuDifficulty
  gridSizeTier: GridSizeTier
  trailGrowthTier: TrailGrowthTier
  // Web-only in practice (see TouchInputLayer.web.tsx) — native ignores it — but kept on the
  // shared settings shape rather than platform-split, same as every other field here.
  keyScheme: Record<Player, KeyScheme>
  // Opt-in — see useOrientationLock. Off by default: the app-wide orientationMode (see
  // useDeviceOrientation) just follows however the phone is actually being held, rather than being
  // a stored preference itself.
  lockOrientation: boolean
  // Which powerup types can spawn this round — not a separate on/off flag: "powerups off" is just
  // an empty array (see gameEngine.ts's maybeSpawnPickup, which only ever spawns from this list),
  // so a single multi-select control (see PowerupPicker.tsx) covers both at once.
  enabledPowerups: PowerupType[]
}

export interface GameState {
  phase: GamePhase
  grid: GridSize
  players: Record<Player, PlayerState>
  outcome: RoundOutcome | null
  // Ticks elapsed since 'playing' started — GameBoard.tsx's head-glide animation keys off this
  // rather than trail length, since a laggy trailGrowthTier can leave trail length unchanged on a
  // tick that both grows and trims it (see gameEngine.ts's tickGame).
  tick: number
  // Board-wide, not per-player — at most one entry at a time (see gameEngine.ts's
  // maybeSpawnPickup), so a linear scan is fine.
  pickups: PowerupPickup[]
}

export interface TurnIntentEvent {
  player: Player
  direction: Direction
}
