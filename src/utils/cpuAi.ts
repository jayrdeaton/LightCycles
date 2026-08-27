import { applyControlInversion } from '@tastic/input'

import { CPU_EASY_RANDOM_CHANCE, CPU_FLOOD_FILL_CAP, CPU_HACK_COMPENSATION_CHANCE, CPU_NORMAL_SUBOPTIMAL_CHANCE, CPU_POWERUP_AWARENESS, POWERUP_CPU_OFFENSIVE_FALLBACK_CHANCE, POWERUP_CPU_OFFENSIVE_SPACE_THRESHOLD, POWERUP_CPU_OVERDRIVE_MIN_SPACE } from '@/constants/game'
import { CpuDifficulty, Direction, GameState, GridCell, GridSize, Player, PlayerState, PowerupPickup, PowerupType } from '@/types'

import { countReachableCells, distanceToNearestTarget } from './floodFill'
import { applyActivation, applyTurnIntent, buildOccupiedSet, buildPortalLookup, buildTunnelCellSet, buildTunnelOccupiedSet, stepsFor } from './gameEngine'
import { ALL_DIRECTIONS, cellKey, isInBounds, isOppositeDirection, stepCell, wrapCell } from './grid'

// The CPU always plays player 2 — see index.tsx/game.tsx, which fix the human at player 1 (and
// suppress the face-to-face flip entirely) whenever gameMode is 'vsCpu'.
export const CPU_PLAYER: Player = 2

export interface ChooseCpuDirectionParams {
  player: PlayerState
  grid: GridSize
  occupied: ReadonlySet<string>
  difficulty: CpuDifficulty
  random?: () => number
  // How many cells THIS player itself advances this tick (see gameEngine.ts's stepsFor) — a
  // boosted CPU needs its own safety lookahead to walk the same number of cells ahead, or a
  // direction that's only safe for 1 cell but crashes on the 2nd (while boosted) would misscore as
  // safe. Defaults to 1 (today's behavior) for every existing call site/test.
  ownSteps?: number
  // Powerup awareness, both optional/defaulted so existing call sites/tests are unaffected.
  pickups?: PowerupPickup[]
  heldPowerup?: PowerupType | null
  // Portal-aware pathing (see gameEngine.ts's buildPortalLookup) — optional/defaulted so existing
  // call sites/tests (predating portals) are unaffected.
  portals?: ReadonlyMap<string, GridCell>
  // Tunnel-aware pathing (see gameEngine.ts's buildTunnelCellSet/buildTunnelOccupiedSet) — both
  // optional/defaulted so existing call sites/tests (predating tunnels) are unaffected.
  tunnelCellSet?: ReadonlySet<string>
  tunnelOccupied?: ReadonlySet<string>
  // The round's true GameSettings.wrapEdges — optional/defaulted (false) so existing call
  // sites/tests are unaffected. This is the ground truth, not a per-difficulty decision: whether
  // it's actually USED is gated to 'hard' further down (see this function's own wrapAware local),
  // same "truth flows in, the difficulty-indexed logic decides how much of it to use" shape
  // CPU_POWERUP_AWARENESS already uses for pickups/shield/offense above it.
  wrapEdges?: boolean
}

// Walks `ownSteps` cells ahead in `direction` from `head`, treating each intermediate cell as
// occupied for the next step's own check (mirroring gameEngine.ts's tickGame sub-step semantics),
// then flood-fills from wherever that lands. Unsafe (space -1, cell null) if any of those steps
// would be out of bounds or already occupied. `portals` defaults to empty so every existing call
// site/test stays byte-identical — a step landing on a portal cell redirects to its paired exit
// first, the same shape tickGame's own movement resolution uses, so the CPU's own lookahead can
// never disagree with what actually happens to it on a real portal crossing. `tunnelCellSet`/
// `tunnelOccupied` both default to empty for the same reason — a step landing on a tunnel cell is
// checked against `tunnelOccupied` instead of `occupied`, mirroring tickGame's own `isBlocked`;
// without this the CPU would see every tunnel cell as unconditionally empty and could walk straight
// into a live tunnel-trail hazard it has zero visibility into. `wrapEdges` defaults to false for the
// same byte-identical-by-default reason — see this file's own ChooseCpuDirectionParams.wrapEdges
// comment for why this takes the raw ground truth rather than doing its own difficulty gating.
function candidateSafety(head: GridCell, direction: Direction, grid: GridSize, occupied: ReadonlySet<string>, ownSteps: number, cap: number, portals: ReadonlyMap<string, GridCell> = new Map(), tunnelCellSet: ReadonlySet<string> = new Set(), tunnelOccupied: ReadonlySet<string> = new Set(), wrapEdges: boolean = false): { space: number; cell: GridCell | null } {
  let cell = head
  let working: ReadonlySet<string> = occupied
  let tunnelWorking: ReadonlySet<string> = tunnelOccupied
  const steps = Math.max(1, ownSteps)
  for (let i = 0; i < steps; i++) {
    cell = stepCell(cell, direction)
    if (wrapEdges && !isInBounds(cell, grid)) cell = wrapCell(cell, grid)
    const key = cellKey(cell)
    if (portals.has(key)) cell = portals.get(key)!
    const landedKey = cellKey(cell)
    const isTunnelCell = tunnelCellSet.has(landedKey)
    if (!isInBounds(cell, grid) || (isTunnelCell ? tunnelWorking : working).has(landedKey)) return { space: -1, cell: null }
    if (i < steps - 1) {
      if (isTunnelCell) tunnelWorking = new Set(tunnelWorking).add(landedKey)
      else working = new Set(working).add(landedKey)
    }
  }
  return { space: countReachableCells(cell, grid, working, cap, portals, tunnelCellSet, tunnelWorking, wrapEdges), cell }
}

// True only when every legal (non-180°) direction is unsafe within the player's own lookahead —
// used to decide when a held Shield is worth popping preemptively (see shouldCpuActivate) rather
// than accepting a move that's about to crash anyway.
function isCornered(player: PlayerState, grid: GridSize, occupied: ReadonlySet<string>, ownSteps: number, portals: ReadonlyMap<string, GridCell> = new Map(), tunnelCellSet: ReadonlySet<string> = new Set(), tunnelOccupied: ReadonlySet<string> = new Set(), wrapEdges: boolean = false): boolean {
  const head = player.trail[player.trail.length - 1]
  const candidates = ALL_DIRECTIONS.filter((direction) => !isOppositeDirection(direction, player.direction))
  return candidates.every((direction) => candidateSafety(head, direction, grid, occupied, ownSteps, CPU_FLOOD_FILL_CAP, portals, tunnelCellSet, tunnelOccupied, wrapEdges).space < 0)
}

// Scores each legal turn (i.e. not a 180° reversal — same rule the reducer enforces for human
// input, see gameEngine.ts) by how much open space it leads toward, via a flood fill from the
// resulting cell. That's what keeps the bot from boxing itself in the way a purely-greedy "avoid
// only the very next cell" bot would — a direction whose first step is safe but only opens onto a
// small pocket still scores low. Difficulty modulates how faithfully the bot follows that score,
// not how fast it reacts (see useGameState.ts) — 'hard' always takes the best-scoring move,
// 'normal'/'easy' sometimes settle for a worse one.
//
// Powerup-seeking (difficulty-gated via CPU_POWERUP_AWARENESS) only ever breaks a tie among
// directions that already score within `seekTieToleranceCells` of the best — it can never pull the
// bot toward a pickup at the cost of a genuinely safer option, which is what keeps existing
// survival behavior stable with powerups on.
export function chooseCpuDirection({ player, grid, occupied, difficulty, random = Math.random, ownSteps = 1, pickups = [], heldPowerup = null, portals = new Map(), tunnelCellSet = new Set(), tunnelOccupied = new Set(), wrapEdges = false }: ChooseCpuDirectionParams): Direction {
  const head = player.trail[player.trail.length - 1]
  const candidates = ALL_DIRECTIONS.filter((direction) => !isOppositeDirection(direction, player.direction))

  // Deliberately gated to 'hard' only, not a blanket read of the raw setting — easy/normal keep
  // treating the edge as a wall even when it isn't, which reads as in-character weakness for those
  // tiers (see lobby.tsx's CPU_DIFFICULTY_OPTIONS: Drone/Bot aren't supposed to be sharp) rather
  // than an unfinished feature, while MCP — this game's own "final boss" — is expected to actually
  // know the board.
  const wrapAware = wrapEdges && difficulty === 'hard'

  const scored = candidates.map((direction) => ({ direction, ...candidateSafety(head, direction, grid, occupied, ownSteps, CPU_FLOOD_FILL_CAP, portals, tunnelCellSet, tunnelOccupied, wrapAware) })).sort((a, b) => b.space - a.space)

  const maxSpace = scored[0].space
  const tiedForBest = scored.filter((s) => s.space === maxSpace)
  // Prefers continuing straight over an equally-good turn, purely so the bot doesn't zigzag
  // through symmetric open space for no reason — ties on open-space score are common early in a
  // round, when nothing has carved up the grid yet.
  let best = (tiedForBest.find((s) => s.direction === player.direction) ?? tiedForBest[0]).direction

  const awareness = CPU_POWERUP_AWARENESS[difficulty]
  if (awareness.seekPickups && !heldPowerup && pickups.length > 0 && maxSpace >= 0) {
    const targets = new Set(pickups.map((pu) => cellKey(pu.cell)))
    const tied = scored.filter((s) => s.space >= 0 && maxSpace - s.space <= awareness.seekTieToleranceCells)
    if (tied.length > 1) {
      const ranked = tied
        .map((s) => ({ direction: s.direction, dist: s.cell ? distanceToNearestTarget(s.cell, grid, occupied, targets, CPU_FLOOD_FILL_CAP, portals, tunnelCellSet, tunnelOccupied, wrapAware) : null }))
        .filter((s): s is { direction: Direction; dist: number } => s.dist !== null)
        .sort((a, b) => a.dist - b.dist)
      if (ranked.length > 0) best = ranked[0].direction
    }
  }

  if (difficulty === 'hard') return best

  if (difficulty === 'normal') {
    const runnerUp = scored.find((s) => s.direction !== best)
    if (runnerUp && runnerUp.space >= 0 && random() < CPU_NORMAL_SUBOPTIMAL_CHANCE) return runnerUp.direction
    return best
  }

  // 'easy': half the time, ignore the score entirely and take any move that at least survives
  // this step — weak, but not so weak it feels broken by driving straight into a wall on purpose.
  const safeOptions = scored.filter((s) => s.space >= 0)
  if (safeOptions.length > 0 && random() < CPU_EASY_RANDOM_CHANCE) {
    const index = Math.min(safeOptions.length - 1, Math.floor(random() * safeOptions.length))
    return safeOptions[index].direction
  }
  return best
}

// Whether the CPU "notices" it's currently Hack'd and steers to compensate this tick — difficulty
// gates how often, not whether it's even capable of it (see CPU_HACK_COMPENSATION_CHANCE's own
// comment: this is a decision-quality knob, same as every other difficulty-gated choice here, not
// a reaction-speed one). Chances of exactly 0 or 1 skip the random() call entirely, so 'easy'/'hard'
// never consume an extra roll a test wouldn't expect.
function shouldCompensateForHack(difficulty: CpuDifficulty, random: () => number): boolean {
  const chance = CPU_HACK_COMPENSATION_CHANCE[difficulty]
  if (chance <= 0) return false
  if (chance >= 1) return true
  return random() < chance
}

// Queues the CPU's chosen turn the same way a human input source would (see turnIntent.ts) —
// applyTurnIntent still owns the actual reversal/no-op/phase/alive guards, so the bot can't bypass
// those rules just by going through a different call site than human input does.
//
// chooseCpuDirection always reasons about the true best direction, uninverted — it has no idea
// whether it's currently Hack'd. Left uncorrected, blindly applying Hack's flip on top of that
// choice (the same way a human's own swipe gets flipped) reliably steers the CPU into a wall
// whenever the actual best escape happens to be lateral — a free kill, not an earned one. So
// whether the CPU compensates is decided first (see shouldCompensateForHack): if it does, the flip
// is skipped entirely (the two inversions — its own deliberate counter-steer and the automatic one
// applyControlInversion would otherwise apply — would just cancel out, so there's nothing to
// actually invert); if it doesn't "notice," the flip lands exactly as it would against unaware
// human input.
//
// `occupied` defaults to a fresh build from `state.players`, same reasoning as tickGame's own
// default in gameEngine.ts — useGameState.ts builds one set per tick and passes it to both this
// and the tickGame call that follows, instead of each rebuilding it independently. `portals`
// trails `random` — existing call sites/tests pass `random` positionally, and a param inserted
// before it would silently reinterpret those calls rather than fail loudly. The tunnel hazard set
// isn't a param at all (unlike `occupied`) — it's scoped to CPU_PLAYER specifically (see
// buildTunnelOccupiedSet's own `excludePlayer` comment: the CPU's own underground trail is never a
// hazard to itself, only the human's is), so it's derived fresh below rather than accepted as a
// generic caller-supplied set the way `occupied` is. `wrapEdges` trails `portals` for the same
// existing-call-site-safety reason and, like `occupied`/`portals`, is the raw per-round truth —
// useGameState.ts passes settings.wrapEdges straight through with no difficulty pre-gating; see
// chooseCpuDirection's own wrapAware local for where that gate actually lives.
export function applyCpuTurn(state: GameState, difficulty: CpuDifficulty, occupied: ReadonlySet<string> = buildOccupiedSet(state.players, state.obstacles, buildTunnelCellSet(state.tunnels)), random?: () => number, portals: ReadonlyMap<string, GridCell> = buildPortalLookup(state.portals), wrapEdges: boolean = false): GameState {
  if (state.phase !== 'playing') return state
  const player = state.players[CPU_PLAYER]
  if (!player.alive) return state

  const tunnelCellSet = buildTunnelCellSet(state.tunnels)
  const tunnelOccupied = buildTunnelOccupiedSet(state.players, tunnelCellSet, CPU_PLAYER)
  const rawDirection = chooseCpuDirection({ player, grid: state.grid, occupied, difficulty, random, ownSteps: stepsFor(player.effects), pickups: state.pickups, heldPowerup: player.heldPowerup, portals, tunnelCellSet, tunnelOccupied, wrapEdges })
  const hacked = player.effects.control?.type === 'hack'
  const compensates = hacked && shouldCompensateForHack(difficulty, random ?? Math.random)
  const direction = hacked && !compensates ? applyControlInversion(rawDirection, true) : rawDirection
  return applyTurnIntent(state, CPU_PLAYER, direction)
}

// Decides whether the CPU should activate its held powerup this tick — a difficulty-gated
// heuristic layer (see CPU_POWERUP_AWARENESS) on top of the same flood-fill space assessment
// chooseCpuDirection already uses, not a separate lookahead system. Each branch reasons only about
// its own held type; there's no "pick the best of several held items" question since the
// single-slot inventory (see gameEngine.ts's applyActivation) means at most one is ever held.
export function shouldCpuActivate(state: GameState, difficulty: CpuDifficulty, occupied: ReadonlySet<string>, random: () => number = Math.random, portals: ReadonlyMap<string, GridCell> = buildPortalLookup(state.portals), wrapEdges: boolean = false): boolean {
  const cpu = state.players[CPU_PLAYER]
  const held = cpu.heldPowerup
  if (!held) return false

  const tunnelCellSet = buildTunnelCellSet(state.tunnels)
  const awareness = CPU_POWERUP_AWARENESS[difficulty]
  // Same hard-only gate as chooseCpuDirection's own wrapAware — see that comment. Applied to BOTH
  // players' space assessments below, not just the CPU's own: an edge-unaware read of the human's
  // space could misjudge them as cornered near a wrapped edge when they're not, which would be just
  // as wrong a reason to fire an offensive powerup as misjudging the CPU's own escape route would be.
  const wrapAware = wrapEdges && difficulty === 'hard'
  const humanPlayer: Player = CPU_PLAYER === 1 ? 2 : 1
  const human = state.players[humanPlayer]
  const cpuOwnSteps = stepsFor(cpu.effects)
  const cpuHead = cpu.trail[cpu.trail.length - 1]
  const humanHead = human.trail[human.trail.length - 1]
  // Each player's own space/cornering assessment needs the tunnel hazard scoped to THEM (see
  // buildTunnelOccupiedSet's own `excludePlayer` comment) — the CPU's lookahead can't treat its
  // own underground trail as a threat any more than tickGame's real collision check does.
  const tunnelOccupiedForCpu = buildTunnelOccupiedSet(state.players, tunnelCellSet, CPU_PLAYER)
  const tunnelOccupiedForHuman = buildTunnelOccupiedSet(state.players, tunnelCellSet, humanPlayer)
  const ownSpace = candidateSafety(cpuHead, cpu.pendingDirection ?? cpu.direction, state.grid, occupied, cpuOwnSteps, CPU_FLOOD_FILL_CAP, portals, tunnelCellSet, tunnelOccupiedForCpu, wrapAware).space
  const humanSpace = candidateSafety(humanHead, human.pendingDirection ?? human.direction, state.grid, occupied, stepsFor(human.effects), CPU_FLOOD_FILL_CAP, portals, tunnelCellSet, tunnelOccupiedForHuman, wrapAware).space

  if (held === 'shield' && awareness.defensiveCounters) {
    return isCornered(cpu, state.grid, occupied, cpuOwnSteps, portals, tunnelCellSet, tunnelOccupiedForCpu, wrapAware)
  }
  if (held === 'overdrive' && awareness.opportunisticSelfUse) {
    return !cpu.effects.speed && ownSpace > POWERUP_CPU_OVERDRIVE_MIN_SPACE
  }
  if ((held === 'hack' || held === 'overclock' || held === 'stasis' || held === 'prune') && awareness.offensiveUse) {
    return (humanSpace >= 0 && humanSpace < POWERUP_CPU_OFFENSIVE_SPACE_THRESHOLD) || random() < POWERUP_CPU_OFFENSIVE_FALLBACK_CHANCE
  }
  return false
}

// Delegates to the exact same applyActivation a human's tap goes through — CPU-awareness is
// purely a decision layer on top (see shouldCpuActivate), mirroring how applyCpuTurn above
// delegates to applyTurnIntent.
export function applyCpuActivation(state: GameState, difficulty: CpuDifficulty, occupied: ReadonlySet<string> = buildOccupiedSet(state.players, state.obstacles, buildTunnelCellSet(state.tunnels)), random?: () => number, portals: ReadonlyMap<string, GridCell> = buildPortalLookup(state.portals), wrapEdges: boolean = false): GameState {
  if (state.phase !== 'playing') return state
  if (!shouldCpuActivate(state, difficulty, occupied, random, portals, wrapEdges)) return state
  return applyActivation(state, CPU_PLAYER)
}
