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
}

export interface TurnIntentEvent {
  player: Player
  direction: Direction
}
