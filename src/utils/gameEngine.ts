import { cellKey, computeGridSize, isInBounds, isOppositeDirection, stepCell, wrapCell } from '@tastic/grid'

import { MIN_TRAIL_LENGTH_BEFORE_TRIM, POWERUP_COLLECT_RADIUS_CELLS, POWERUP_EFFECT_DURATION_TICKS, POWERUP_PRUNE_FRACTION, SPEED_RAMP_DECREMENT_MS, SPEED_RAMP_INTERVAL_MS, SPEED_RAMP_MIN_INTERVAL_MS } from '@/constants/game'
import { ArenaVariant, ControlEffect, Direction, GameState, GridCell, GridSize, OrientationMode, Player, PlayerEffects, PlayerState, Portal, PowerupPickup, PowerupType, RoundOutcome, ShieldEffect, SpeedEffect, Tunnel } from '@/types'

import { buildArenaObstacles, buildArenaPortals, buildArenaTunnels } from './arenas'
import { startingStateFor } from './grid'

function createPlayerState(grid: GridSize, player: Player, mode: OrientationMode, color: string, p1OnRight: boolean): PlayerState {
  const { head, direction } = startingStateFor(player, grid, mode, p1OnRight)
  return { trail: [head], direction, pendingDirection: null, alive: true, color, heldPowerup: null, effects: { speed: null, control: null, shield: null }, crashCell: null }
}

// The grid-cell margin along each edge that falls inside the device's own safe-area inset —
// `insetsPx` is expected to already be zeroed out by the caller (see GameScreen's own
// extendIntoSafeArea branch) whenever the board ISN'T bleeding under it, since otherwise the
// board's pixel container already stops short of the inset and every cell is already clear of it;
// this function itself stays agnostic of that setting. Ceil'd up to whole cells so a pickup can
// never spawn partially under the notch/Dynamic Island/home-indicator/speaker cutout — better to
// lose a cell of margin than leave one still hidden.
function buildUnsafeAreaCells(grid: GridSize, cellPx: number, insetsPx: { top: number; right: number; bottom: number; left: number }): GridCell[] {
  const marginTop = Math.ceil(insetsPx.top / cellPx)
  const marginBottom = Math.ceil(insetsPx.bottom / cellPx)
  const marginLeft = Math.ceil(insetsPx.left / cellPx)
  const marginRight = Math.ceil(insetsPx.right / cellPx)
  if (marginTop <= 0 && marginBottom <= 0 && marginLeft <= 0 && marginRight <= 0) return []
  const cells: GridCell[] = []
  for (let x = 0; x < grid.cols; x++) {
    for (let y = 0; y < grid.rows; y++) {
      if (x < marginLeft || x >= grid.cols - marginRight || y < marginTop || y >= grid.rows - marginBottom) cells.push({ x, y })
    }
  }
  return cells
}

// `arenaVariant` defaults to 'open' (the original, fully-open rectangle — buildArenaObstacles
// returns [] for it immediately) so every existing call site, including every current test that
// predates arenas, keeps compiling and stays byte-identical in behavior. `safeAreaInsetsPx`
// defaults to all-zero (no margin) for the same reason — see buildUnsafeAreaCells above.
export function createInitialGameState(width: number, height: number, mode: OrientationMode, colors: Record<Player, string>, cellPx: number, p1OnRight: boolean, arenaVariant: ArenaVariant = 'open', safeAreaInsetsPx: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 }): GameState {
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
    pickups: [],
    obstacles: buildArenaObstacles(arenaVariant, grid, mode, p1OnRight),
    portals: buildArenaPortals(arenaVariant, grid, mode, p1OnRight),
    tunnels: buildArenaTunnels(arenaVariant, grid, mode, p1OnRight),
    unsafeCells: buildUnsafeAreaCells(grid, cellPx, safeAreaInsetsPx)
  }
}

export function startPlaying(state: GameState): GameState {
  return state.phase === 'onboarding' ? { ...state, phase: 'playing' } : state
}

// Every cell either player's trail currently occupies, plus the round's static arena obstacles —
// the shared "what's blocked" set both tickGame's own collision check and cpuAi.ts's flood-fill
// scoring read from, built the same way in both places so they can never disagree about what
// counts as occupied. `obstacles` defaults to [] so any existing call site/test that only ever
// passed `players` keeps compiling and behaves exactly as before (an 'open' round has none anyway).
// `tunnelCellSet` excludes any trail cell that's a tunnel member (see buildTunnelOccupiedSet below,
// which builds the underground counterpart from exactly the cells this excludes) — a tunnel-
// traveler's trail is never visible to surface collision, which is the entire point of the
// mechanic: a surface trail can legitimately cross the same coordinate without either side hitting
// the other. Defaults to empty so every existing call site/test (predating tunnels) is unaffected.
export function buildOccupiedSet(players: Record<Player, PlayerState>, obstacles: GridCell[] = [], tunnelCellSet: ReadonlySet<string> = new Set()): Set<string> {
  const occupied = new Set<string>()
  for (const cell of players[1].trail) if (!tunnelCellSet.has(cellKey(cell))) occupied.add(cellKey(cell))
  for (const cell of players[2].trail) if (!tunnelCellSet.has(cellKey(cell))) occupied.add(cellKey(cell))
  for (const cell of obstacles) occupied.add(cellKey(cell))
  return occupied
}

// Flat membership set of every cell across the round's tunnel corridor(s) (see types/index.ts's own
// Tunnel comment) — the single source of truth for "is this coordinate part of the underground
// layer," consumed by buildOccupiedSet's own exclusion above, buildTunnelOccupiedSet below, and
// tickGame's own collision/deposit routing, so none of them can ever disagree about which cells are
// tunnel members.
export function buildTunnelCellSet(tunnels: Tunnel[]): Set<string> {
  const cells = new Set<string>()
  for (const tunnel of tunnels) for (const cell of tunnel.cells) cells.add(cellKey(cell))
  return cells
}

// The underground counterpart to buildOccupiedSet: every trail cell that IS a tunnel member,
// instead of every one that isn't. A trail cell is always exactly one or the other (never both,
// never neither — buildOccupiedSet excludes precisely what this includes), so together the two
// exactly partition `trail`, purely by re-deriving from `trail` + static tunnel geometry every time
// — no bookkeeping of when or how a cell was entered.
//
// `excludePlayer`, when given, leaves that player's own trail out — the set becomes "tunnel cells
// hazardous to THIS player specifically," i.e. only the opponent's underground trail. That's the
// actual promise the corridor makes (see types/index.ts's own Tunnel comment): crossing it should
// never trap you behind your own earlier pass, only behind someone else's. Omitted (the default),
// both players merge into one set — the "is ANY tunnel cell occupied at all" view every pre-existing
// caller (rendering, the standalone buildTunnelOccupiedSet tests) still wants.
export function buildTunnelOccupiedSet(players: Record<Player, PlayerState>, tunnelCellSet: ReadonlySet<string>, excludePlayer?: Player): Set<string> {
  const occupied = new Set<string>()
  if (excludePlayer !== 1) for (const cell of players[1].trail) if (tunnelCellSet.has(cellKey(cell))) occupied.add(cellKey(cell))
  if (excludePlayer !== 2) for (const cell of players[2].trail) if (tunnelCellSet.has(cellKey(cell))) occupied.add(cellKey(cell))
  return occupied
}

// Symmetric a<->b lookup for the round's portal pair (see types/index.ts's own Portal comment) —
// rebuilt fresh wherever needed rather than cached on GameState, matching the same "always re-
// derive from state" idiom buildOccupiedSet above already uses for `obstacles` (there's at most one
// pair, so this costs nothing to rebuild). Portal cells are deliberately absent from
// buildOccupiedSet's own output — entering one redirects the mover during movement resolution (see
// tickGame below), it never crashes them on its own.
export function buildPortalLookup(portals: Portal[]): Map<string, GridCell> {
  const lookup = new Map<string, GridCell>()
  for (const { a, b } of portals) {
    lookup.set(cellKey(a), b)
    lookup.set(cellKey(b), a)
  }
  return lookup
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
// simple fractions like 1/2 or 1/3. Exported so GameBoard.tsx's own tailProgress can look up the
// real previous/next trim tick from this exact schedule instead of a separately-derived formula
// that could drift out of sync with it — see tailProgress's own comment for why that drift used
// to be a real, visible bug.
export function shouldTrimTrailAt(tick: number, growthRate: number): boolean {
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
// "avoid the other live pickup's cell" case to account for here. `portalCells`/`tunnelCells`/
// `unsafeCells` all default to empty so every existing call site/test (predating portals/tunnels/
// safe-area avoidance) stays byte-identical — neither a portal cell nor a tunnel cell is itself
// ever in `occupied` (see buildPortalLookup's own comment, and buildOccupiedSet's tunnel exclusion
// above), so without this a pickup could otherwise spawn directly on a portal mouth or a live
// tunnel cell. `unsafeCells` (see buildUnsafeAreaCells) is the device safe-area margin — same
// treatment, since a cell inside it is still fully traversable board, just not somewhere a pickup
// should ever land.
function pickRandomEmptyCell(grid: GridSize, occupied: ReadonlySet<string>, random: () => number, portalCells: ReadonlySet<string> = new Set(), tunnelCells: ReadonlySet<string> = new Set(), unsafeCells: ReadonlySet<string> = new Set()): GridCell | null {
  const candidates: GridCell[] = []
  for (let x = 0; x < grid.cols; x++) {
    for (let y = 0; y < grid.rows; y++) {
      const cell = { x, y }
      if (portalCells.has(cellKey(cell)) || tunnelCells.has(cellKey(cell)) || unsafeCells.has(cellKey(cell))) continue
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
function maybeSpawnPickup(grid: GridSize, tick: number, pickups: PowerupPickup[], occupied: ReadonlySet<string>, enabledPowerups: PowerupType[], random: () => number, portalCells: ReadonlySet<string> = new Set(), tunnelCells: ReadonlySet<string> = new Set(), unsafeCells: ReadonlySet<string> = new Set()): PowerupPickup[] {
  if (enabledPowerups.length === 0) return pickups
  if (pickups.length > 0) return pickups
  const cell = pickRandomEmptyCell(grid, occupied, random, portalCells, tunnelCells, unsafeCells)
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
    // Offensive, like Hack/Overclock/Stasis below — severs a chunk off the opponent's own trail,
    // proportional to its current length (not a fixed cell count) so it stays a meaningful punish
    // no matter how long the round has run.
    const trimmed = trimTrailFront(opp.trail, Math.floor(opp.trail.length * POWERUP_PRUNE_FRACTION))
    return { ...state, players: { ...state.players, [player]: { ...p, heldPowerup: null }, [opponent]: { ...opp, trail: trimmed } } }
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
// no separate boolean gate. `portalLookup` defaults to a fresh build from `state.portals` (empty
// for every arena but 'portals'), same "rebuild by default, or pass an already-built one" shape as
// `occupied` itself. The per-player tunnel-hazard sets aren't threaded as their own params at all —
// see buildTunnelOccupiedSet's own `excludePlayer` comment for why each player needs a DIFFERENT
// view (their opponent's underground trail, never their own), so a single shared param the way
// `occupied` uses one couldn't represent both anyway; they're derived fresh from `state.players`
// below instead, right alongside `tunnelCellSet`. `wrapEdges` defaults to false (the original
// behavior — an off-grid step always crashes) so every existing call site/test stays unaffected.
export function tickGame(state: GameState, occupied: ReadonlySet<string> = buildOccupiedSet(state.players, state.obstacles, buildTunnelCellSet(state.tunnels)), trailSpeedRate: number = 1, enabledPowerups: PowerupType[] = [], random: () => number = Math.random, portalLookup: ReadonlyMap<string, GridCell> = buildPortalLookup(state.portals), wrapEdges: boolean = false): GameState {
  if (state.phase !== 'playing') return state

  const { grid } = state
  const p1 = state.players[1]
  const p2 = state.players[2]
  // Derived fresh from `state.tunnels` here too (not threaded as its own param) — every one of the
  // several places below that needs it can just close over this one local, rather than each
  // rebuilding it (or the caller having to pass yet another argument neither `occupied` nor either
  // tunnel-hazard set already covers).
  const tunnelCellSet = buildTunnelCellSet(state.tunnels)
  // Each player's OWN underground trail is never a hazard to them — only the opponent's is (see
  // buildTunnelOccupiedSet's own `excludePlayer` comment). Re-derived from `state.players` every
  // tick rather than threaded through as params, same "always re-derive, no bookkeeping" shape
  // buildTunnelOccupiedSet itself already uses for the merged view.
  const tunnelHazardFor1 = buildTunnelOccupiedSet(state.players, tunnelCellSet, 1)
  const tunnelHazardFor2 = buildTunnelOccupiedSet(state.players, tunnelCellSet, 2)

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
  const tunnelWorking1 = new Set(tunnelHazardFor1)
  const tunnelWorking2 = new Set(tunnelHazardFor2)
  // Which set a given cell's collision check (and, below, its deposit once a step there commits)
  // routes through — a function of tunnel-cell membership (never of how the mover got there or
  // whether they're "currently traversing" anything, see types/index.ts's own Tunnel comment) AND,
  // within that, of whose hazard set it is: a cell that's part of a tunnel is checked against the
  // MOVING player's own tunnelWorking1/2 — which only ever contains the OTHER player's underground
  // trail, never their own (see buildTunnelOccupiedSet's own `excludePlayer` comment) — so looping
  // back through your own earlier tunnel crossing is exactly as safe as the corridor promises. Every
  // other cell, including a tunnel's own mouths approached from outside, uses `working` exactly as
  // it always has.
  const isBlockedFor1 = (cell: GridCell): boolean => (tunnelCellSet.has(cellKey(cell)) ? tunnelWorking1 : working).has(cellKey(cell))
  const isBlockedFor2 = (cell: GridCell): boolean => (tunnelCellSet.has(cellKey(cell)) ? tunnelWorking2 : working).has(cellKey(cell))

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
    // `let`, not `const` — a step landing on a portal cell is immediately redirected to its paired
    // exit, right here, before any check below ever sees the raw stepCell destination. Every
    // downstream check (headOn, oob, rawHit, the trail append) already reads next1/next2 by name,
    // so this one redirect is the entire integration point: an already-occupied exit crashes like
    // any blocked move, two players landing on the same exit is an ordinary head-on, and a portal
    // cell can never itself appear in a trail (see buildPortalLookup's own comment) so it's never
    // "used up" by a prior crossing.
    let next1 = stepping1 ? stepCell(head1, dir1) : null
    let next2 = stepping2 ? stepCell(head2, dir2) : null
    // Wrap-mode redirect — same "rewrite next before any check sees it" integration point as the
    // portal redirect just below, applied first: an off-grid destination re-enters from the
    // opposite edge, so oob1/oob2 below come out false and this step proceeds like any ordinary
    // in-bounds move, including still chaining into a portal if the wrapped-onto cell is one.
    if (wrapEdges && next1 && !isInBounds(next1, grid)) next1 = wrapCell(next1, grid)
    if (wrapEdges && next2 && !isInBounds(next2, grid)) next2 = wrapCell(next2, grid)
    if (next1 && portalLookup.has(cellKey(next1))) next1 = portalLookup.get(cellKey(next1))!
    if (next2 && portalLookup.has(cellKey(next2))) next2 = portalLookup.get(cellKey(next2))!

    // Both cycles moving into the same cell on the same sub-step — a head-on collision.
    const headOn = stepping1 && stepping2 && next1!.x === next2!.x && next1!.y === next2!.y
    const oob1 = stepping1 && !isInBounds(next1!, grid)
    const oob2 = stepping2 && !isInBounds(next2!, grid)

    const rawHit1 = stepping1 && !headOn && !oob1 && isBlockedFor1(next1!)
    const rawHit2 = stepping2 && !headOn && !oob2 && isBlockedFor2(next2!)

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

    // A committed tunnel step deposits into the OTHER player's hazard set, never the mover's own —
    // mirroring isBlockedFor1/2 above, this is what actually makes a player's own underground trail
    // stay permanently safe for them while still becoming a real wall for their opponent the moment
    // it's laid.
    if (stepping1) {
      trail1 = [...trail1, next1!]
      const target1 = tunnelCellSet.has(cellKey(next1!)) ? tunnelWorking2 : working
      target1.add(cellKey(next1!))
    }
    if (stepping2) {
      trail2 = [...trail2, next2!]
      const target2 = tunnelCellSet.has(cellKey(next2!)) ? tunnelWorking1 : working
      target2.add(cellKey(next2!))
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
        1: { ...p1, trail: crashOob1 || !crashNext1 ? trail1 : [...trail1, crashNext1], alive: !crash1, pendingDirection: null, heldPowerup: heldPowerup1, effects: effects1, crashCell: crash1 ? crashNext1 : null },
        2: { ...p2, trail: crashOob2 || !crashNext2 ? trail2 : [...trail2, crashNext2], alive: !crash2, pendingDirection: null, heldPowerup: heldPowerup2, effects: effects2, crashCell: crash2 ? crashNext2 : null }
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

  const spawnedPickups = maybeSpawnPickup(grid, tick, pickups, working, enabledPowerups, random, new Set(portalLookup.keys()), tunnelCellSet, new Set(state.unsafeCells.map(cellKey)))

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
