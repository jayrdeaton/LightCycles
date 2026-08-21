export type Player = 1 | 2

export type Direction = 'up' | 'down' | 'left' | 'right'

export type OrientationMode = 'faceToFace' | 'sideBySide'

export type SpeedTier = 'slow' | 'normal' | 'fast'

export type GameMode = 'twoPlayer' | 'vsCpu'

export type CpuDifficulty = 'easy' | 'normal' | 'hard'

export type GridSizeTier = 'small' | 'medium' | 'large'

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
  orientationMode: OrientationMode
  speedTier: SpeedTier
  speedRampEnabled: boolean
  gameMode: GameMode
  cpuDifficulty: CpuDifficulty
  gridSizeTier: GridSizeTier
  // Web-only in practice (see TouchInputLayer.web.tsx) — native ignores it — but kept on the
  // shared settings shape rather than platform-split, same as every other field here.
  keyScheme: Record<Player, KeyScheme>
}

export interface GameState {
  phase: GamePhase
  grid: GridSize
  players: Record<Player, PlayerState>
  outcome: RoundOutcome | null
}

export interface TurnIntentEvent {
  player: Player
  direction: Direction
}
