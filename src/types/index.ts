export type Player = 1 | 2

export type Direction = 'up' | 'down' | 'left' | 'right'

export type OrientationMode = 'faceToFace' | 'sideBySide'

export type SpeedTier = 'slow' | 'normal' | 'fast'

export type GameMode = 'twoPlayer' | 'vsCpu'

export type CpuDifficulty = 'easy' | 'normal' | 'hard'

export type GridSizeTier = 'small' | 'medium' | 'large'

// Selectable static obstacle layout for the round's board — see utils/arenas.ts's
// buildArenaObstacles, the sole place these are turned into actual GridCell obstacles. 'open' is
// the original, fully-open rectangle (empty obstacle list) and stays the default everywhere a
// caller doesn't specify otherwise (see gameEngine.ts's createInitialGameState). 'portals' and
// 'underpass' don't produce obstacles at all (see buildArenaObstacles' own branch for each) — their
// geometry lives on GameState.portals/.tunnels instead, since neither one blocks movement the way
// every other variant's obstacle cells do.
export type ArenaVariant = 'open' | 'pillars' | 'gauntlet' | 'portals' | 'underpass'

// How fast the trail's tail chases the head, not the visible outcome — describing the outcome (a
// fixed "short"/"full" length) would read backwards, since the trail never actually settles at any
// fixed length under any tier — it still grows without bound, just slower than 1:1 when the tail
// follows. 'off' matches the game's original behavior: the tail never follows at all, so the trail
// is the entire path since spawn — see constants/game.ts's TRAIL_SPEED_RATE and gameEngine.ts's
// shouldTrimTrailAt for the mechanics.
export type TrailSpeedTier = 'off' | 'medium' | 'fast'

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

// A linked pair of cells for the 'portals' arena (see utils/arenas.ts's buildArenaPortals) —
// stepping onto either one instantly redirects the mover to the other, continuing in the same
// direction, before any collision check runs (see gameEngine.ts's tickGame). Symmetric: `a` and
// `b` are interchangeable, neither is "the" entrance.
export interface Portal {
  a: GridCell
  b: GridCell
}

// A short, straight corridor for the 'underpass' arena (see utils/arenas.ts's buildArenaTunnels),
// ordered mouth-to-mouth. Traversing it checks collision against a separate underground-occupancy
// set instead of the surface one (see gameEngine.ts's buildTunnelOccupiedSet), so a tunnel-
// traveler and a surface trail can legitimately share the same coordinate without colliding.
// Direction of travel is unconstrained — either mouth, either direction — since `cells[i]` and
// `cells[i+1]` are always real geometric neighbors by construction.
export interface Tunnel {
  cells: GridCell[]
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
  // The cell this player actually attempted to move into on the tick they crashed — set once, in
  // tickGame's crash branch, and never touched again after. Unlike `trail` above, this is populated
  // even for an out-of-bounds crash, whose true destination has no `trail` slot to append to (it
  // doesn't exist on the grid) but is still exactly what GameBoard.tsx's death explosion needs to
  // center on: a GridCell just past the boundary is meaningless as board state, but perfectly fine
  // as a pixel coordinate (cellToPixel is pure arithmetic). Null while alive, and stays null forever
  // for a player who wins outright (never crashed this round).
  crashCell: GridCell | null
}

export interface GameSettings {
  speedTier: SpeedTier
  speedRampEnabled: boolean
  gameMode: GameMode
  cpuDifficulty: CpuDifficulty
  gridSizeTier: GridSizeTier
  trailSpeedTier: TrailSpeedTier
  // Web-only in practice (see TouchInputLayer.web.tsx) — native ignores it — but kept on the
  // shared settings shape rather than platform-split, same as every other field here.
  keyScheme: Record<Player, KeyScheme>
  // Opt-in — see useAccelerometerOrientation's `locked` param. Off by default: the app-wide
  // orientationMode just follows however the phone is actually being held, rather than being a
  // stored preference itself.
  lockOrientation: boolean
  // Which powerup types can spawn this round — not a separate on/off flag: "powerups off" is just
  // an empty array (see gameEngine.ts's maybeSpawnPickup, which only ever spawns from this list),
  // so a single multi-select control (see SectionedDropdown.tsx) covers both at once.
  enabledPowerups: PowerupType[]
  // Static obstacle layout for the round's board — see utils/arenas.ts's buildArenaObstacles.
  arenaVariant: ArenaVariant
  // Per-round lobby setting (not a persisted SettingsDialog preference): whether a player's trail
  // is allowed to extend into their own "safe" starting zone once they've left it. Rendering/
  // enforcement lives entirely in game.tsx, not here.
  extendIntoSafeArea: boolean
  // Per-round lobby setting, same shape as extendIntoSafeArea above: Pac-Man-style screen wrap —
  // stepping off one edge of the grid re-enters from the opposite edge instead of crashing (see
  // grid.ts's wrapCell and gameEngine.ts's tickGame, which applies it before the usual out-of-
  // bounds check). GameBoard.tsx's boundary outline is hidden whenever this is on, since edges
  // stop being fatal.
  wrapEdges: boolean
}

export interface GameState {
  phase: GamePhase
  grid: GridSize
  players: Record<Player, PlayerState>
  outcome: RoundOutcome | null
  // Ticks elapsed since 'playing' started — GameBoard.tsx's head-glide animation keys off this
  // rather than trail length, since a laggy trailSpeedTier can leave trail length unchanged on a
  // tick that both grows and trims it (see gameEngine.ts's tickGame).
  tick: number
  // Board-wide, not per-player — at most one entry at a time (see gameEngine.ts's
  // maybeSpawnPickup), so a linear scan is fine.
  pickups: PowerupPickup[]
  // Static per-round obstacle layout from the selected ArenaVariant (see utils/arenas.ts's
  // buildArenaObstacles) — computed once in createInitialGameState and never mutated after, unlike
  // pickups.
  obstacles: GridCell[]
  // Static per-round portal pair from the 'portals' ArenaVariant (see utils/arenas.ts's
  // buildArenaPortals) — empty for every other variant. Computed once in createInitialGameState and
  // never mutated after, same as `obstacles`.
  portals: Portal[]
  // Static per-round tunnel corridor from the 'underpass' ArenaVariant (see utils/arenas.ts's
  // buildArenaTunnels) — empty for every other variant. Computed once in createInitialGameState and
  // never mutated after, same as `obstacles`.
  tunnels: Tunnel[]
}

export interface TurnIntentEvent {
  player: Player
  direction: Direction
}

export type AchievementTier = 'bronze' | 'silver' | 'gold'

export interface DifficultyRecord {
  played: number
  wins: number
  losses: number
  draws: number
}

export interface VsCpuStats {
  played: number
  // Human wins/losses — the human is always seat 1 in vsCpu mode (see cpuAi.ts's CPU_PLAYER).
  wins: number
  losses: number
  draws: number
  byDifficulty: Record<CpuDifficulty, DifficultyRecord>
  // Human's current consecutive-win streak against the CPU, any difficulty — resets to 0 on a loss
  // or a draw, not just a loss, since a draw isn't a win either.
  currentWinStreak: number
  bestWinStreak: number
}

export interface TwoPlayerStats {
  played: number
  p1Wins: number
  p2Wins: number
  draws: number
}

export interface ColorStats {
  played: number
  wins: number
  losses: number
  draws: number
}

// A profile's own personal record — mirrors the decomposable parts of StatsState (vsCpu/twoPlayer/
// colors/day-streak fields), so the exact same achievement predicates and statsEngine.ts helpers
// that evaluate device-wide StatsState can evaluate a profile's own view unchanged (see
// statsEngine.ts's getProfileStatsView). twoPlayer.p1Wins/p2Wins are reinterpreted per profile: they
// count THIS profile's own wins while occupying that seat that round, not "whoever occupied seat N"
// — see statsEngine.ts's bumpProfileForSeat. Omits `profiles` (no nesting) and `firstGameResult`
// (a one-time device-wide flag with no profile identity — see AchievementDefinition.scope). Accumulates
// prospectively only, from whenever a profile is first attached to a seat going forward — there's no
// per-round history stored anywhere (only running aggregates), so an existing profile's bucket cannot
// retroactively inherit any share of stats recorded before this field gained this shape.
export interface ProfileStats {
  vsCpu: VsCpuStats
  twoPlayer: TwoPlayerStats
  colors: Record<string, ColorStats>
  distinctDaysPlayed: number
  currentDayStreak: number
  bestDayStreak: number
  lastPlayedDate: string | null
}

// A locally-saved player identity — name, color, and a short tag, entirely opt-in. Independent of
// any seat's live round color (see components/Theme.tsx's playerColors) — selecting a profile for
// a seat just pre-fills that seat's own color picker once as a starting point, never binds to it
// going forward (see LobbyPlayerPanel.tsx's handleProfileSelect and lobby.tsx's own color-change
// handlers, which deliberately don't sync back to the profile — a seat's live color is a per-match
// override, not an edit to the saved "favorite").
export interface Profile {
  id: string
  name: string
  color: string
  // User-typed identity mark shown on the seat's own color button and in the profile switcher —
  // one emoji, or up to MAX_TAG_LENGTH plain characters (see profilesValidation.ts's isValidTag).
  // Can be empty (no tag yet), which just falls back to a generic icon wherever it's shown.
  tag: string
  // Only ever surfaced in the editor UI on non-touch web (see LobbyPlayerPanel.tsx's showKeyScheme)
  // since it's the one field with no meaning on a swipe-controlled touch device — still always set
  // (defaults to 'wasd'), same "always-set, sensible default" treatment as color/emoji, rather than
  // optional, so nothing downstream has to handle an absent value.
  keyScheme: KeyScheme
  createdAt: number
  updatedAt: number
}

export interface StatsState {
  vsCpu: VsCpuStats
  twoPlayer: TwoPlayerStats
  // Keyed by lowercase hex — every seat's color counts here regardless of gameMode, since color
  // choice is the one thing tracked uniformly across both modes (see statsEngine.ts).
  colors: Record<string, ColorStats>
  // Keyed by Profile.id — only populated for a seat that had a saved profile selected when its
  // round outcome was recorded (see useGameStats.tsx's recordRoundOutcome context.profileIds). A
  // stored blob from before this field existed is still valid (see statsValidation.ts's
  // isValidStats, which treats an absent `profiles` key as valid) and gets backfilled to {} once,
  // on load, in useGameStats.tsx — no schema-versioning machinery needed for a purely-additive field.
  // Full-parity per-profile achievement tracking (see achievementEngine.ts's
  // evaluateUnlockedIdsForProfile and achievements.tsx's profile picker) reads this map.
  profiles: Record<string, ProfileStats>
  distinctDaysPlayed: number
  // Consecutive local calendar days played, ending today — resets to 1 (not 0) on any gap of a
  // full day or more, since the day just played always counts as day one of a new streak. See
  // statsEngine.ts's applyRoundOutcome for how a "gap" is detected.
  currentDayStreak: number
  bestDayStreak: number
  // Local YYYY-MM-DD bookkeeping for distinctDaysPlayed/currentDayStreak — never rendered directly.
  lastPlayedDate: string | null
  // Set once, only when the very first round ever is recorded, then never touched again — powers
  // the one-off "your first-ever game was a win" achievement, which isn't derivable from
  // cumulative totals alone once later games start piling on top. Always from seat 1's
  // perspective (the only well-defined "first game" framing across both vsCpu and twoPlayer,
  // where there's no other stable identity — see statsEngine.ts's applyRoundOutcome).
  firstGameResult: 'win' | 'loss' | 'draw' | null
}

// Achievement id -> unlock timestamp (Date.now() ms).
export type UnlockedAchievementsState = Record<string, number>

export interface AchievementDefinition {
  id: string
  title: string
  description: string
  tier: AchievementTier
  icon: string
  // 'profile' (the default, when omitted) evaluates against whichever StatsState view is currently
  // selected on the achievements screen — device-wide for "All Profiles", or a synthesized
  // per-profile view (see statsEngine.ts's getProfileStatsView) for a specific profile tab. 'device'
  // always evaluates against the real device-wide StatsState regardless of which tab is active —
  // reserved for an achievement with no profile identity at all (see constants/achievements.ts's
  // flawless_debut, the one true global exception: it reads firstGameResult, a one-time flag with no
  // per-profile analog).
  scope?: 'profile' | 'device'
  isUnlocked: (stats: StatsState) => boolean
  // 0-1 fraction toward unlocking, for the achievements screen's progress bars — omitted for
  // one-off/binary achievements where "progress" isn't a meaningful concept (e.g. beat-a-difficulty).
  progress?: (stats: StatsState) => number
}
