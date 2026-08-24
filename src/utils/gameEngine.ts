import { MIN_TRAIL_LENGTH_BEFORE_TRIM, POWERUP_COLLECT_RADIUS_CELLS, POWERUP_EFFECT_DURATION_TICKS, POWERUP_PRUNE_FRACTION, SPEED_RAMP_DECREMENT_MS, SPEED_RAMP_INTERVAL_MS, SPEED_RAMP_MIN_INTERVAL_MS } from '@/constants/game'
import { ControlEffect, Direction, GameState, GridCell, GridSize, OrientationMode, Player, PlayerEffects, PlayerState, PowerupPickup, PowerupType, RoundOutcome, ShieldEffect, SpeedEffect } from '@/types'

import { cellKey, computeGridSize, isInBounds, isOppositeDirection, startingStateFor, stepCell } from './grid'

function createPlayerState(grid: GridSize, player: Player, mode: OrientationMode, color: string, p1OnRight: boolean): PlayerState {
  const { head, direction } = startingStateFor(player, grid, mode, p1OnRight)
  return { trail: [head], direction, pendingDirection: null, alive: true, color, heldPowerup: null, effects: { speed: null, control: null, shield: null } }
}

export function createInitialGameState(width: number, height: number, mode: OrientationMode, colors: Record<Player, string>, cellPx: number, p1OnRight: boolean): GameState {
  const grid = computeGridSize(width, height, cellPx)
  return {
    phase: 'onboarding',
    grid,
    players: {
      1: createPlayerState(grid, 1, mode, colors[1], p1OnRight),
      2: createPlayerState(grid, 2, mode, colors[2], p1OnRight)
    },
    outcome: null,
    tick: 0,
    pickups: []
  }
}

export function startPlaying(state: GameState): GameState {
  return state.phase === 'onboarding' ? { ...state, phase: 'playing' } : state
}

// Every cell either player's trail currently occupies — the shared "what's blocked" set both
// tickGame's own collision check and cpuAi.ts's flood-fill scoring read from, built the same way
// in both places so they can never disagree about what counts as occupied.
export function buildOccupiedSet(players: Record<Player, PlayerState>): Set<string> {
  const occupied = new Set<string>()
  for (const cell of players[1].trail) occupied.add(cellKey(cell))
  for (const cell of players[2].trail) occupied.add(cellKey(cell))
  return occupied
}

// Queues a turn for the next tick. Ignored outside 'playing', for an eliminated player, or when
// the requested direction is a no-op (already heading that way) or a 180° reversal into the
// player's own trail — enforced here, once, rather than by every input source that could dispatch
// a turn. A frozen (Stasis'd) player can still queue a turn here — it just won't move this tick;
// see tickGame's own handling of a 0-step player, which leaves `direction` pinned to whichever way
// the player was actually last moving (only `pendingDirection` changes) until they unfreeze. That
// pin is what makes the opposite-direction check above safe across multiple frozen ticks: if
// `direction` resolved every tick the way a moving player's does, two individually-legal 90° turns
// queued back to back while frozen (e.g. left→up, then up→right) would compound into a net 180°
// that this check never sees coming — the player then unfreezes still facing "left" on the trail
// but instantly steps right into the cell they just came from.
export function applyTurnIntent(state: GameState, player: Player, direction: Direction): GameState {
  if (state.phase !== 'playing') return state
  const p = state.players[player]
  if (!p.alive) return state
  if (direction === p.direction) return state
  if (isOppositeDirection(direction, p.direction)) return state
  if (p.pendingDirection === direction) return state

  return { ...state, players: { ...state.players, [player]: { ...p, pendingDirection: direction } } }
}

// True on ticks that should trim one cell off the trail's tail, to hold its long-run average
// growth at `growthRate` cells/tick (1 = never trims, i.e. the original behavior). Compares how
// many trims *should* have happened by this tick vs. by the last one, rather than a fixed
// "every Nth tick" cadence, so any rate between 0 and 1 is honored exactly on average — not just
// simple fractions like 1/2 or 1/3.
function shouldTrimTrailAt(tick: number, growthRate: number): boolean {
  if (growthRate >= 1) return false
  const trimsDueBefore = Math.floor((tick - 1) * (1 - growthRate))
  const trimsDueNow = Math.floor(tick * (1 - growthRate))
  return trimsDueNow > trimsDueBefore
}

// Slices `count` cells off the front (oldest end), clamped so the head is never removed — shared
// by the periodic trailSpeedTier trim above, Prune's instant multi-cell application (see
// applyActivation), and Shield's break-through trim (see trimTrailAtCell) below.
function trimTrailFront(trail: GridCell[], count: number): GridCell[] {
  const maxRemovable = trail.length - 1
  return trail.slice(Math.min(count, maxRemovable))
}

// Shield's break-through variant: destroys everything at-or-behind `cell` (the point a shielded
// player just punched through), keeping only the newer portion — clamped, via trimTrailFront, so
// the trail's own current head always survives even if `cell` happens to be it (e.g. a shielded
// player passing through the exact cell the trail's owner currently occupies).
function trimTrailAtCell(trail: GridCell[], cell: GridCell): GridCell[] {
  const index = trail.findIndex((c) => c.x === cell.x && c.y === cell.y)
  if (index === -1) return trail
  return trimTrailFront(trail, index + 1)
}

// Which trail (if either) currently contains `cell` — used only once a Shield negation has already
// confirmed the cell is occupied, to decide which trail trimTrailAtCell above should apply to. A
// cell can only ever belong to one trail at a time (the collision rules that already exist prevent
// both trails from ever double-occupying the same cell), so this is an either/or, never both.
function locateOccupyingTrail(cell: GridCell, trail1: GridCell[], trail2: GridCell[]): Player | null {
  if (trail1.some((c) => c.x === cell.x && c.y === cell.y)) return 1
  if (trail2.some((c) => c.x === cell.x && c.y === cell.y)) return 2
  return null
}

// Deterministic id — a spawn tick + cell pair is already unique for a single spawn event, so no
// uuid/Date.now() is needed (this file stays pure/I-O-free).
function pickupId(tick: number, cell: GridCell): string {
  return `pu-${tick}-${cell.x}-${cell.y}`
}

// A pickup's full collection footprint — its own cell plus every neighbor within
// POWERUP_COLLECT_RADIUS_CELLS — must be clear of any trail, not just its own cell, so a player
// can actually approach it from an open direction rather than finding part of that footprint
// boxed in behind a wall of trail. The grid edge doesn't count as blocking — a footprint spilling
// off the board there is fine, since there's no trail to be unreachable behind.
function hasClearCollectionArea(cell: GridCell, grid: GridSize, occupied: ReadonlySet<string>): boolean {
  for (let dx = -POWERUP_COLLECT_RADIUS_CELLS; dx <= POWERUP_COLLECT_RADIUS_CELLS; dx++) {
    for (let dy = -POWERUP_COLLECT_RADIUS_CELLS; dy <= POWERUP_COLLECT_RADIUS_CELLS; dy++) {
      const neighbor = { x: cell.x + dx, y: cell.y + dy }
      if (!isInBounds(neighbor, grid)) continue
      if (occupied.has(cellKey(neighbor))) return false
    }
  }
  return true
}

// Only ever called with an empty `pickups` (see maybeSpawnPickup's own guard), so there's no
// "avoid the other live pickup's cell" case to account for here.
function pickRandomEmptyCell(grid: GridSize, occupied: ReadonlySet<string>, random: () => number): GridCell | null {
  const candidates: GridCell[] = []
  for (let x = 0; x < grid.cols; x++) {
    for (let y = 0; y < grid.rows; y++) {
      const cell = { x, y }
      if (hasClearCollectionArea(cell, grid, occupied)) candidates.push(cell)
    }
  }
  if (candidates.length === 0) return null
  return candidates[Math.floor(random() * candidates.length)]
}

// Exactly one pickup on the board at a time, like a single apple in Snake — the instant it's
// collected (or none has spawned yet this round) a replacement appears immediately, on the very
// next tick, with no interval/cooldown to wait out. `occupied` here should already reflect every
// cell committed this tick (see tickGame's own `working` set) so a pickup never spawns under a
// cycle that just moved there. `enabledPowerups` is the per-round selection from GameSettings — an
// empty list (the "powerups off" case, see GameSettings' own comment) means this never spawns
// anything at all.
function maybeSpawnPickup(grid: GridSize, tick: number, pickups: PowerupPickup[], occupied: ReadonlySet<string>, enabledPowerups: PowerupType[], random: () => number): PowerupPickup[] {
  if (enabledPowerups.length === 0) return pickups
  if (pickups.length > 0) return pickups
  const cell = pickRandomEmptyCell(grid, occupied, random)
  if (!cell) return pickups
  const type = enabledPowerups[Math.floor(random() * enabledPowerups.length)]
  return [...pickups, { id: pickupId(tick, cell), type, cell }]
}

// Activation-side counterpart to applyTurnIntent — the single choke point a held powerup's effect
// goes through, for a human's tap or the CPU's own decision (see cpuAi.ts's applyCpuActivation).
// Clears the activating player's single-slot inventory in every branch. Same-axis effects replace
// rather than stack (see PlayerEffects) — assigning `effects.speed`/`.control`/`.shield` directly
// overwrites whatever was already there with a fresh expiresAtTick, which is what lets, say, a
// well-timed Overdrive shrug off an incoming Overclock's own timer with no special-casing.
export function applyActivation(state: GameState, player: Player): GameState {
  if (state.phase !== 'playing') return state
  const p = state.players[player]
  if (!p.alive) return state
  if (!p.heldPowerup) return state

  const opponent: Player = player === 1 ? 2 : 1
  const opp = state.players[opponent]
  const type = p.heldPowerup
  const tick = state.tick

  if (type === 'prune') {
    // Neutral utility — trims BOTH trails, not just the activator's own (see the roster's own
    // reasoning: nobody's trail can hurt its owner, so a self/opponent split doesn't apply here).
    // Proportional to each trail's own current length (not a fixed cell count) so it stays a
    // meaningful "oh shit" panic button no matter how long the round has run.
    const trail1 = trimTrailFront(state.players[1].trail, Math.floor(state.players[1].trail.length * POWERUP_PRUNE_FRACTION))
    const trail2 = trimTrailFront(state.players[2].trail, Math.floor(state.players[2].trail.length * POWERUP_PRUNE_FRACTION))
    return {
      ...state,
      players: {
        1: { ...state.players[1], trail: trail1, ...(player === 1 ? { heldPowerup: null } : {}) },
        2: { ...state.players[2], trail: trail2, ...(player === 2 ? { heldPowerup: null } : {}) }
      }
    }
  }

  if (type === 'overdrive') {
    const speed: SpeedEffect = { type: 'overdrive', multiplier: 2, expiresAtTick: tick + POWERUP_EFFECT_DURATION_TICKS.overdrive }
    return { ...state, players: { ...state.players, [player]: { ...p, heldPowerup: null, effects: { ...p.effects, speed } } } }
  }

  if (type === 'stasis') {
    // Offensive, like Hack/Overclock below — freezing yourself is a punishment, not a boon, so
    // Stasis (unlike Overdrive) always targets the opponent: pin them in place for the duration so
    // the activator can box them into a trap.
    const speed: SpeedEffect = { type: 'stasis', multiplier: 0, expiresAtTick: tick + POWERUP_EFFECT_DURATION_TICKS.stasis }
    return { ...state, players: { ...state.players, [player]: { ...p, heldPowerup: null }, [opponent]: { ...opp, effects: { ...opp.effects, speed } } } }
  }

  if (type === 'shield') {
    const shield: ShieldEffect = { expiresAtTick: tick + POWERUP_EFFECT_DURATION_TICKS.shield }
    return { ...state, players: { ...state.players, [player]: { ...p, heldPowerup: null, effects: { ...p.effects, shield } } } }
  }

  if (type === 'hack') {
    const control: ControlEffect = { type: 'hack', expiresAtTick: tick + POWERUP_EFFECT_DURATION_TICKS.hack }
    return { ...state, players: { ...state.players, [player]: { ...p, heldPowerup: null }, [opponent]: { ...opp, effects: { ...opp.effects, control } } } }
  }

  // type === 'overclock'
  const speed: SpeedEffect = { type: 'overclock', multiplier: 2, expiresAtTick: tick + POWERUP_EFFECT_DURATION_TICKS.overclock }
  return { ...state, players: { ...state.players, [player]: { ...p, heldPowerup: null }, [opponent]: { ...opp, effects: { ...opp.effects, speed } } } }
}

// How many grid cells a player advances THIS tick, from their current speed effect — Stasis's 0
// isn't a lookup miss, it's "skip movement entirely," so it's checked first and explicitly.
// Exported so cpuAi.ts's own survival scoring can walk the same number of cells ahead for itself
// when boosted, rather than a second, potentially-drifting copy of this same 3-line rule.
export function stepsFor(effects: PlayerEffects): number {
  if (effects.speed?.multiplier === 0) return 0
  if (effects.speed?.multiplier === 2) return 2
  return 1
}

// Advances the round exactly one tick, in 1 or 2 sub-steps per player depending on any active
// speed effect (Overdrive/Overclock cover 2 cells this call; Stasis covers 0). Each player still
// resolves exactly one queued direction for the whole tick — a boosted player just covers 2 cells
// in it, not two independent turns. Sub-steps are checked one at a time (rather than computing
// both players' full 2-cell paths up front) so a mid-tick crash — including one player's second
// step crossing where either player just landed on the first — is caught exactly when it happens,
// against a working occupancy set that includes every cell committed earlier this same tick.
//
// `occupied` defaults to a fresh build from `state.players` (correct for every existing call
// site/test), but a caller that's already built one from this same state can pass it in to skip
// rebuilding it a second time on the same tick (see useGameState.ts, which also feeds
// applyCpuTurn/applyCpuActivation from it). `trailSpeedRate` defaults to 1 (the original
// behavior). `enabledPowerups`/`random` default to []/Math.random so every existing call site and
// test — which never pass them — sees byte-identical behavior to before powerups existed. An empty
// `enabledPowerups` is what "powerups off" actually means (see GameSettings' own comment) — there's
// no separate boolean gate.
export function tickGame(state: GameState, occupied: ReadonlySet<string> = buildOccupiedSet(state.players), trailSpeedRate: number = 1, enabledPowerups: PowerupType[] = [], random: () => number = Math.random): GameState {
  if (state.phase !== 'playing') return state

  const { grid } = state
  const p1 = state.players[1]
  const p2 = state.players[2]

  const dir1 = p1.pendingDirection ?? p1.direction
  const dir2 = p2.pendingDirection ?? p2.direction

  const tick = state.tick + 1

  const steps1 = stepsFor(p1.effects)
  const steps2 = stepsFor(p2.effects)
  const maxSteps = Math.max(steps1, steps2)

  let trail1 = p1.trail
  let trail2 = p2.trail
  let heldPowerup1 = p1.heldPowerup
  let heldPowerup2 = p2.heldPowerup
  let effects1 = p1.effects
  let effects2 = p2.effects
  let pickups = state.pickups
  const working = new Set(occupied)

  let crash1 = false
  let crash2 = false
  let crashNext1: GridCell | null = null
  let crashNext2: GridCell | null = null
  let crashOob1 = false
  let crashOob2 = false

  for (let step = 1; step <= maxSteps; step++) {
    const stepping1 = step <= steps1
    const stepping2 = step <= steps2

    const head1 = trail1[trail1.length - 1]
    const head2 = trail2[trail2.length - 1]
    const next1 = stepping1 ? stepCell(head1, dir1) : null
    const next2 = stepping2 ? stepCell(head2, dir2) : null

    // Both cycles moving into the same cell on the same sub-step — a head-on collision.
    const headOn = stepping1 && stepping2 && next1!.x === next2!.x && next1!.y === next2!.y
    const oob1 = stepping1 && !isInBounds(next1!, grid)
    const oob2 = stepping2 && !isInBounds(next2!, grid)

    const rawHit1 = stepping1 && !headOn && !oob1 && working.has(cellKey(next1!))
    const rawHit2 = stepping2 && !headOn && !oob2 && working.has(cellKey(next2!))

    const shield1Active = effects1.shield !== null && tick <= effects1.shield.expiresAtTick
    const shield2Active = effects2.shield !== null && tick <= effects2.shield.expiresAtTick

    // A head-on is negated for a player only when THEY'RE shielded and the other one ISN'T — an
    // exactly-one-sided shield wins the head-on outright (a real, if rare, "clutch" moment) rather
    // than the usual mutual crash/draw; both or neither shielded stays an ordinary head-on for
    // both. The shield is consumed here, immediately, rather than through the wall-break path
    // below — the loser of a head-on always crashes this same sub-step, so that path (which only
    // runs once BOTH sides have avoided crashing) is never reached for this case.
    const headOnSurvives1 = headOn && shield1Active && !shield2Active
    const headOnSurvives2 = headOn && shield2Active && !shield1Active
    if (headOnSurvives1) effects1 = { ...effects1, shield: null }
    if (headOnSurvives2) effects2 = { ...effects2, shield: null }

    const wallNegated1 = rawHit1 && shield1Active
    const wallNegated2 = rawHit2 && shield2Active

    const stepCrash1 = stepping1 && ((headOn && !headOnSurvives1) || oob1 || (rawHit1 && !wallNegated1))
    const stepCrash2 = stepping2 && ((headOn && !headOnSurvives2) || oob2 || (rawHit2 && !wallNegated2))

    if (stepCrash1 || stepCrash2) {
      crash1 = stepCrash1
      crash2 = stepCrash2
      crashNext1 = next1
      crashNext2 = next2
      crashOob1 = oob1
      crashOob2 = oob2
      break
    }

    // Shield breaks (wall case — see above for head-on) — consume the shield and destroy the
    // broken trail back to (not including) the break point, before committing this sub-step's
    // moves. Applied by CELL, not a precomputed index, so two shielded breaks landing on the same
    // trail in the same sub-step (a rare but possible edge case) compose correctly regardless of
    // order — each lookup re-finds its own cell in whatever the trail currently is, rather than
    // risking a stale index into an already-shortened array.
    if (wallNegated1) {
      effects1 = { ...effects1, shield: null }
      const owner = locateOccupyingTrail(next1!, trail1, trail2)
      if (owner === 1) trail1 = trimTrailAtCell(trail1, next1!)
      else if (owner === 2) trail2 = trimTrailAtCell(trail2, next1!)
    }
    if (wallNegated2) {
      effects2 = { ...effects2, shield: null }
      const owner = locateOccupyingTrail(next2!, trail1, trail2)
      if (owner === 1) trail1 = trimTrailAtCell(trail1, next2!)
      else if (owner === 2) trail2 = trimTrailAtCell(trail2, next2!)
    }

    if (stepping1) {
      trail1 = [...trail1, next1!]
      working.add(cellKey(next1!))
    }
    if (stepping2) {
      trail2 = [...trail2, next2!]
      working.add(cellKey(next2!))
    }

    // Pickup collection — per sub-step, so a boosted player can't glide past a pickup on an
    // intermediate cell without collecting it. Any cell within POWERUP_COLLECT_RADIUS_CELLS of the
    // pickup's own counts, not just its exact cell — matching the glyph's own rendered footprint,
    // which visually spans past a single cell (see powerupPickupRadiusPx). Collecting always
    // REPLACES whatever's currently held, rather than no-op'ing while already holding something —
    // there's only ever one held slot, so grabbing a new pickup is a deliberate swap. Sequential
    // (player 1 checked first) rather than needing an explicit tie-break: two players within radius
    // of the SAME pickup in the same sub-step is now possible without a head-on (unlike the old
    // exact-cell match), but whichever is checked first removes it from `pickups` before the
    // other's own check runs, so at most one of them ever collects it.
    if (enabledPowerups.length > 0) {
      if (stepping1) {
        const found = pickups.find((pu) => Math.abs(pu.cell.x - next1!.x) <= POWERUP_COLLECT_RADIUS_CELLS && Math.abs(pu.cell.y - next1!.y) <= POWERUP_COLLECT_RADIUS_CELLS)
        if (found) {
          heldPowerup1 = found.type
          pickups = pickups.filter((pu) => pu.id !== found.id)
        }
      }
      if (stepping2) {
        const found = pickups.find((pu) => Math.abs(pu.cell.x - next2!.x) <= POWERUP_COLLECT_RADIUS_CELLS && Math.abs(pu.cell.y - next2!.y) <= POWERUP_COLLECT_RADIUS_CELLS)
        if (found) {
          heldPowerup2 = found.type
          pickups = pickups.filter((pu) => pu.id !== found.id)
        }
      }
    }
  }

  if (crash1 || crash2) {
    const outcome: RoundOutcome = crash1 && crash2 ? { type: 'draw' } : { type: 'win', winner: crash1 ? 2 : 1 }
    return {
      ...state,
      phase: 'roundOver',
      outcome,
      tick,
      pickups,
      players: {
        // A crash into a trail (own, opponent's, or head-on) still extends the trail to the
        // collision cell, so the cycle visibly reaches whatever it hit — an out-of-bounds crash
        // can't do this, since that cell doesn't exist on the grid to render. `crashNext` is null
        // when that player wasn't even part of the sub-step the crash happened on (already used up
        // their own step(s) earlier this same tick), in which case their trail is simply whatever
        // it already progressed to.
        1: { ...p1, trail: crashOob1 || !crashNext1 ? trail1 : [...trail1, crashNext1], alive: !crash1, pendingDirection: null, heldPowerup: heldPowerup1, effects: effects1 },
        2: { ...p2, trail: crashOob2 || !crashNext2 ? trail2 : [...trail2, crashNext2], alive: !crash2, pendingDirection: null, heldPowerup: heldPowerup2, effects: effects2 }
      }
    }
  }

  // Periodic trailSpeedTier trim — gated per-player on whether that player actually moved this
  // tick (a Stasis'd, 0-step player's trail is fully frozen: no append, no trim, for the duration)
  // and on having grown past MIN_TRAIL_LENGTH_BEFORE_TRIM — every tier just grows like 'off'
  // until then, so a round doesn't start trimming a trail that's barely begun.
  const trimDue = shouldTrimTrailAt(tick, trailSpeedRate)
  if (trimDue && steps1 > 0 && trail1.length > MIN_TRAIL_LENGTH_BEFORE_TRIM) trail1 = trimTrailFront(trail1, 1)
  if (trimDue && steps2 > 0 && trail2.length > MIN_TRAIL_LENGTH_BEFORE_TRIM) trail2 = trimTrailFront(trail2, 1)

  const spawnedPickups = maybeSpawnPickup(grid, tick, pickups, working, enabledPowerups, random)

  // Effect expiry — cleared once `tick` has fully consumed the effect's own expiresAtTick.
  const expire = (effects: PlayerEffects): PlayerEffects => ({
    speed: effects.speed && tick >= effects.speed.expiresAtTick ? null : effects.speed,
    control: effects.control && tick >= effects.control.expiresAtTick ? null : effects.control,
    shield: effects.shield && tick >= effects.shield.expiresAtTick ? null : effects.shield
  })

  // `direction` only resolves from `dir1`/`dir2` (and `pendingDirection` only clears) on a tick
  // where that player actually stepped. A 0-step (Stasis'd) player keeps their pre-freeze
  // `direction` and their still-unresolved `pendingDirection` untouched — see applyTurnIntent's own
  // comment for why that pin matters (it's what stops turns queued across separate frozen ticks
  // from compounding into an unnoticed 180°).
  return {
    ...state,
    tick,
    pickups: spawnedPickups,
    players: {
      1: { ...p1, trail: trail1, direction: steps1 > 0 ? dir1 : p1.direction, pendingDirection: steps1 > 0 ? null : p1.pendingDirection, heldPowerup: heldPowerup1, effects: expire(effects1) },
      2: { ...p2, trail: trail2, direction: steps2 > 0 ? dir2 : p2.direction, pendingDirection: steps2 > 0 ? null : p2.pendingDirection, heldPowerup: heldPowerup2, effects: expire(effects2) }
    }
  }
}

// Effective ms-per-grid-step at a given point in round time. Ramping is layered on top of the
// selected base tier rather than replacing it, so 'fast' + ramp reaches the floor sooner than
// 'slow' + ramp does. decrementMs/minIntervalMs default to the reference (medium grid-size tier)
// constants — a caller at a different tier passes its own scaleMsForCellPx'd values (see
// useGameState.ts) so the ramp scales consistently with the rest of the tick timing.
export function computeTickIntervalMs(baseIntervalMs: number, elapsedMs: number, rampEnabled: boolean, decrementMs: number = SPEED_RAMP_DECREMENT_MS, minIntervalMs: number = SPEED_RAMP_MIN_INTERVAL_MS): number {
  if (!rampEnabled) return baseIntervalMs
  const steps = Math.floor(elapsedMs / SPEED_RAMP_INTERVAL_MS)
  return Math.max(minIntervalMs, baseIntervalMs - steps * decrementMs)
}
