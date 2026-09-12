import { Canvas, Circle, Line, Path, Shadow, Skia, vec } from '@shopify/react-native-skia'
import { cellKey, cellToPixel, isAdjacent } from '@tastic/grid'
import { MysteryPickup, ObstacleRect } from '@tastic/sprites/shapes'
import { useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import { Easing, SharedValue, useDerivedValue, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'

import { deathAnimationDurationMs, MIN_TRAIL_LENGTH_BEFORE_TRIM, POWERUP_EFFECT_COLORS, POWERUP_PULSE_DURATION_MS, POWERUP_PULSE_SCALE, POWERUP_SPAWN_FADE_MS, powerupPickupRadiusPx, TRAIL_SEVER_EAT_MAX_MS, TRAIL_SEVER_EAT_MIN_MS, TRAIL_SEVER_EAT_MS_PER_CELL } from '@/constants/game'
import { GamePhase, GridCell, GridSize, OrientationMode, Player, PlayerState, Portal, PowerupPickup, Tunnel } from '@/types'
import { zoneSideFor } from '@/utils/playerZones'

export interface GameBoardProps {
  players: Record<Player, PlayerState>
  phase: GamePhase
  tickIntervalMs: number
  cellPx: number
  grid: GridSize
  orientationMode: OrientationMode
  // Only meaningful when orientationMode === 'sideBySide' — see useAccelerometerOrientation and
  // TouchInputLayer.tsx's identical prop.
  p1OnRight: boolean
  // Ticks elapsed this round — see GameState's own comment. Drives PlayerTrail's head-glide
  // retrigger instead of trail.length, which a laggy trailSpeedTier can leave unchanged on a tick
  // that both grows and trims the trail.
  tick: number
  pickups: PowerupPickup[]
  // The app theme's tertiary color — pickups render in this, distinct from either player's own
  // primary/secondary trail color, so a glyph never gets mistaken for either player's own head.
  pickupColor: string
  // Static per-round obstacle layout (see GameState's own comment) — rendered by Obstacles below.
  obstacles: GridCell[]
  // The app theme's outline color — distinct from primary/secondary/tertiary, so obstacle geometry
  // reads as inert board structure rather than being mistaken for either player's trail or a pickup.
  obstacleColor: string
  // Static per-round portal pair (see GameState's own comment) — rendered by Portals below. Reuses
  // obstacleColor rather than a dedicated prop: like obstacles, a portal is static per-round board
  // structure, not per-player state or a pickup, so the same "inert board structure" color reads
  // correctly for it too — shape (two rings vs. a filled cell) is what tells them apart.
  portals: Portal[]
  // Static per-round tunnel corridor (see GameState's own comment) — rendered by Tunnels below, and
  // fed into PlayerTrail so it can highlight each player's own underground segments. Also reuses
  // obstacleColor, same reasoning as `portals` above.
  tunnels: Tunnel[]
  // The resolved TRAIL_SPEED_RATE number for the active trailSpeedTier (see constants/game.ts) —
  // lets PlayerTrail interpolate the tail's position continuously between trims instead of holding
  // still and then snapping a whole cell forward. Passed as the raw rate, not the tier, so this
  // component stays as decoupled from the tier enum as gameEngine.ts's own tickGame already is.
  trailSpeedRate: number
  // Per-round GameSettings.wrapEdges — see that field's own comment. Hides Walls below entirely:
  // the boundary outline promises "this edge is fatal," which stops being true once wrap is on.
  wrapEdges: boolean
}

function cellCenter(cell: GridCell, cellPx: number) {
  const { x, y } = cellToPixel(cell, cellPx)
  return { x: x + cellPx / 2, y: y + cellPx / 2 }
}

// Thin on purpose — this is a boundary marker, not a trail, and shouldn't compete with the
// trails/heads for visual weight. Flat rather than scaled with cellPx, same reasoning as the head
// ring's own stroke width above.
const WALL_STROKE_WIDTH = 1.5

// Every live pickup renders identically, regardless of its actual (already-decided, see
// gameEngine.ts's maybeSpawnPickup) type — Mario-Kart mystery-box style. The type is only ever
// revealed once collected, in the holder's own HUD badge (see PowerupHud.tsx), never on the board.
// Thin wrapper around @tastic/sprites/shapes' MysteryPickup, which was reconciled directly from
// this component's own former implementation (mount-triggered grow+fade-in, settling into an
// endless back-and-forth radius pulse — see its own doc comment) — its unspecified defaults
// (fillOpacity 0.35, ringOpacity 1, ringWidth 1.5, spawnStartScale 0.4, and ringColor falling back
// to `color`) are this app's own literal former values, so only the three tuning constants below
// are passed explicitly: LightCycles owns those via constants/game.ts and should stay in control
// of them rather than silently inheriting whatever the shared package defaults to, even though
// those defaults currently happen to equal the same numbers.
function PowerupGlyph({ pickup, cellPx, color }: { pickup: PowerupPickup; cellPx: number; color: string }) {
  const center = cellCenter(pickup.cell, cellPx)
  return <MysteryPickup x={center.x} y={center.y} radius={powerupPickupRadiusPx(cellPx)} color={color} spawnFadeMs={POWERUP_SPAWN_FADE_MS} pulseDurationMs={POWERUP_PULSE_DURATION_MS} pulseScale={POWERUP_PULSE_SCALE} />
}

function Powerups({ pickups, cellPx, color }: { pickups: PowerupPickup[]; cellPx: number; color: string }) {
  return (
    <>
      {pickups.map((pu) => (
        <PowerupGlyph key={pu.id} pickup={pu} cellPx={cellPx} color={color} />
      ))}
    </>
  )
}

// Static per-round board structure, not per-player game state — unlike PowerupGlyph, there's
// nothing here that ever changes once a round starts (see GameState's own comment on `obstacles`),
// so this is a plain Rect per cell with no shared values/animation at all. Same two-layer fill+
// stroke idea as PowerupGlyph's own circles (a near-opaque fill so the cell reads as solid/
// impassable, plus a stroked outline at the same WALL_STROKE_WIDTH the perimeter walls use, so
// obstacle geometry reads as the same kind of boundary marker rather than a different visual
// language) — just static instead of pulsing. Thin wrapper around @tastic/sprites/shapes'
// ObstacleRect, which was reconciled directly from this component's own former implementation —
// strokeColor/strokeWidth opt into that second stroked Rect (omitted, its own default draws no
// outline at all — a different app's plain-fill look, not this one's).
function ObstacleCell({ cell, cellPx, color }: { cell: GridCell; cellPx: number; color: string }) {
  const { x, y } = cellToPixel(cell, cellPx)
  return <ObstacleRect x={x} y={y} width={cellPx} height={cellPx} color={color} opacity={0.85} strokeColor={color} strokeWidth={WALL_STROKE_WIDTH} />
}

function Obstacles({ obstacles, cellPx, color }: { obstacles: GridCell[]; cellPx: number; color: string }) {
  return (
    <>
      {obstacles.map((cell) => (
        <ObstacleCell key={cellKey(cell)} cell={cell} cellPx={cellPx} color={color} />
      ))}
    </>
  )
}

// Same static-per-round-structure reasoning as ObstacleCell above, but stroke-only (no opaque fill)
// — a portal must not read as impassable the way a wall does, since stepping onto one redirects the
// mover rather than blocking them (see gameEngine.ts's tickGame). Renders `a`/`b` identically —
// neither end is "the" entrance (see Portal's own comment in types/index.ts).
function PortalGlyph({ portal, cellPx, color }: { portal: Portal; cellPx: number; color: string }) {
  // Matches PowerupGlyph's own footprint exactly — a portal is meant to read as a real landmark on
  // the board, not a one-cell blip, and this is already the size players learn to associate with
  // "something here." The real gameplay hitbox is still just the single a/b cell (see gameEngine.ts's
  // tickGame) — same "glyph reads bigger than its actual footprint" precedent PowerupGlyph itself
  // already sets against POWERUP_COLLECT_RADIUS_CELLS.
  const radius = powerupPickupRadiusPx(cellPx)
  const a = cellCenter(portal.a, cellPx)
  const b = cellCenter(portal.b, cellPx)
  return (
    <>
      <Circle cx={a.x} cy={a.y} r={radius} style='stroke' strokeWidth={WALL_STROKE_WIDTH * 1.5} color={color} />
      <Circle cx={b.x} cy={b.y} r={radius} style='stroke' strokeWidth={WALL_STROKE_WIDTH * 1.5} color={color} />
    </>
  )
}

function Portals({ portals, cellPx, color }: { portals: Portal[]; cellPx: number; color: string }) {
  return (
    <>
      {portals.map((portal) => (
        <PortalGlyph key={cellKey(portal.a)} portal={portal} cellPx={cellPx} color={color} />
      ))}
    </>
  )
}

// Reads as an ordinary piece of board structure — a straight road, not a special glyph — per
// explicit user feedback that the previous single faint centerline + corner-marker mouths didn't
// read clearly. The corridor is always axis-aligned and dead straight (see arenas.ts's buildTunnel),
// so its two long edges are just the mouth-to-mouth centerline offset by half a cell, perpendicular
// to the direction of travel — the same solid WALL_STROKE_WIDTH stroke Walls/ObstacleCell already
// use, plus a drop shadow so the corridor reads as sitting at a different depth than the flat board
// around it (still walkable — the underground exemption is purely a collision rule, see
// gameEngine.ts's tickGame — this is just what makes that legible at a glance).
function TunnelGlyph({ tunnel, cellPx, color }: { tunnel: Tunnel; cellPx: number; color: string }) {
  const first = tunnel.cells[0]
  const last = tunnel.cells[tunnel.cells.length - 1]
  const firstCenter = cellCenter(first, cellPx)
  const lastCenter = cellCenter(last, cellPx)
  const horizontal = first.y === last.y
  const offsetX = horizontal ? 0 : cellPx / 2
  const offsetY = horizontal ? cellPx / 2 : 0
  return (
    <>
      <Line p1={vec(firstCenter.x - offsetX, firstCenter.y - offsetY)} p2={vec(lastCenter.x - offsetX, lastCenter.y - offsetY)} strokeWidth={WALL_STROKE_WIDTH} color={color}>
        <Shadow dx={0} dy={2} blur={3} color='rgba(0, 0, 0, 0.65)' />
      </Line>
      <Line p1={vec(firstCenter.x + offsetX, firstCenter.y + offsetY)} p2={vec(lastCenter.x + offsetX, lastCenter.y + offsetY)} strokeWidth={WALL_STROKE_WIDTH} color={color}>
        <Shadow dx={0} dy={2} blur={3} color='rgba(0, 0, 0, 0.65)' />
      </Line>
    </>
  )
}

function Tunnels({ tunnels, cellPx, color }: { tunnels: Tunnel[]; cellPx: number; color: string }) {
  return (
    <>
      {tunnels.map((tunnel) => (
        <TunnelGlyph key={cellKey(tunnel.cells[0])} tunnel={tunnel} cellPx={cellPx} color={color} />
      ))}
    </>
  )
}

// Each player "owns" the half of the perimeter behind their own zone — so the wall reads as which
// player crashes into which edge, not just an arbitrary boundary. Which player owns which side is
// zoneSideFor's job, not this function's — see its own comment. Drawn at the grid's own pixel size
// (cols/rows * cellPx), not the container's, since a container a few pixels larger than a whole
// number of cells (see computeGridSize's flooring) still crashes exactly at the grid edge — the
// outline should hug that real boundary, not the container's.
function wallPath(grid: GridSize, cellPx: number, orientationMode: OrientationMode, p1OnRight: boolean, player: Player) {
  const width = grid.cols * cellPx
  const height = grid.rows * cellPx
  const midX = width / 2
  const midY = height / 2
  const path = Skia.Path.Make()

  // Three sides of this player's own zone, omitting the fourth (the shared midline with the other
  // player's zone).
  const side = zoneSideFor(player, orientationMode, p1OnRight)
  if (side === 'top') {
    path.moveTo(0, midY)
    path.lineTo(0, 0)
    path.lineTo(width, 0)
    path.lineTo(width, midY)
  } else if (side === 'bottom') {
    path.moveTo(0, midY)
    path.lineTo(0, height)
    path.lineTo(width, height)
    path.lineTo(width, midY)
  } else if (side === 'left') {
    path.moveTo(midX, 0)
    path.lineTo(0, 0)
    path.lineTo(0, height)
    path.lineTo(midX, height)
  } else {
    path.moveTo(midX, 0)
    path.lineTo(width, 0)
    path.lineTo(width, height)
    path.lineTo(midX, height)
  }
  return path
}

function Walls({ grid, cellPx, orientationMode, p1OnRight, players, phase, wrapEdges }: { grid: GridSize; cellPx: number; orientationMode: OrientationMode; p1OnRight: boolean; players: Record<Player, PlayerState>; phase: GamePhase; wrapEdges: boolean }) {
  const p1Path = useMemo(() => wallPath(grid, cellPx, orientationMode, p1OnRight, 1), [grid, cellPx, orientationMode, p1OnRight])
  const p2Path = useMemo(() => wallPath(grid, cellPx, orientationMode, p1OnRight, 2), [grid, cellPx, orientationMode, p1OnRight])

  // Hidden during the onboarding countdown — the boundary marker is only meaningful once a round
  // is actually live, and it visually clutters the countdown's own player-zone overlay. Hidden for
  // the whole round under wrapEdges — see GameBoardProps' own comment on that prop.
  if (phase === 'onboarding' || wrapEdges) return null

  return (
    <>
      <Path path={p1Path} style='stroke' strokeWidth={WALL_STROKE_WIDTH} color={players[1].color} />
      <Path path={p2Path} style='stroke' strokeWidth={WALL_STROKE_WIDTH} color={players[2].color} />
    </>
  )
}

// How far the tail should have visually crept from trail[0] toward trail[1] as of `tick`, as a
// fraction in [0, 1) — the *continuous* counterpart to gameEngine.ts's shouldTrimTrailAt, which
// only tracks the discrete "has a whole cell been trimmed yet" boundary. Trimming one whole cell
// exactly when this fraction wraps from just-under-1 back to 0 is what keeps this consistent with
// the actual (discrete) trail data: shouldTrimTrailAt's own condition is precisely "did this
// fraction's floor change this tick," so the two can never disagree about when a trim happens —
// this just fills in what the trim looks like *between* ticks instead of holding still until it
// does. Without it, every tick that doesn't land on a whole trim left the tail dead still, then
// jumped a full cell on the tick that did — a held-then-hop cadence, not a following one.
// `trailLength` mirrors gameEngine.ts's own MIN_TRAIL_LENGTH_BEFORE_TRIM gate on the trim itself —
// without it this would compute a nonzero creep purely from elapsed ticks even during the grace
// period where the trail isn't actually being trimmed yet, visually detaching the tail from
// trail[0] before any cell has really been removed.
function tailProgress(tick: number, growthRate: number, trailLength: number): number {
  if (growthRate >= 1 || trailLength <= MIN_TRAIL_LENGTH_BEFORE_TRIM) return 0
  const fractionalTrims = tick * (1 - growthRate)
  return fractionalTrims - Math.floor(fractionalTrims)
}

function trailPath(trail: PlayerState['trail'], cellPx: number) {
  const path = Skia.Path.Make()
  if (trail.length === 0) return path
  const first = cellCenter(trail[0], cellPx)
  path.moveTo(first.x, first.y)
  let prev = trail[0]
  for (const cell of trail.slice(1)) {
    const { x, y } = cellCenter(cell, cellPx)
    // A portal crossing (see gameEngine.ts's tickGame) is the one way two consecutive trail cells
    // can land non-adjacent — moveTo instead of lineTo there so the path starts a fresh subpath on
    // the far side instead of drawing a straight line across the board between them.
    if (isAdjacent(prev, cell)) path.lineTo(x, y)
    else path.moveTo(x, y)
    prev = cell
  }
  return path
}

// The underground portion of a player's own trail, as a separate Skia path rendered underneath the
// normal trail so both players can see at a glance which segments are "safe crossings" that don't
// block surface traffic (see gameEngine.ts's tickGame). Structurally identical to trailPath above,
// just filtered to tunnel-member runs instead of walking the whole trail — breaks to a fresh
// subpath at any non-member gap. Never needs trailPath's own isAdjacent branching: tunnel traversal
// is always a chain of geometrically adjacent steps (unlike a portal jump), so consecutive
// tunnel-member cells are always genuinely adjacent here too.
function tunnelHighlightPath(trail: PlayerState['trail'], tunnelCellSet: ReadonlySet<string>, cellPx: number) {
  const path = Skia.Path.Make()
  let drawing = false
  for (const cell of trail) {
    const isMember = tunnelCellSet.has(cellKey(cell))
    if (!isMember) {
      drawing = false
      continue
    }
    const { x, y } = cellCenter(cell, cellPx)
    if (drawing) path.lineTo(x, y)
    else {
      path.moveTo(x, y)
      drawing = true
    }
  }
  return path
}

// Walks `progress` (0 = nothing eaten, 1 = fully eaten) across an ordered chain of grid cells and
// returns a path through only the still-uneaten suffix — the boundary cell itself is interpolated
// between its two neighbors (rather than snapping a whole cell at a time) so the eaten edge creeps
// smoothly. Shared by two callers that feed it differently-ordered chains for two different
// reasons: severedPath (break-point-first, eating toward the old tail) and PlayerTrail's own death
// wipe (head-first, eating toward the tail — see deathWipeCells below), both driven by this exact
// same algorithm. Marked 'worklet' (rather than relying on the Babel plugin's auto-workletizing of
// the useDerivedValue callbacks that call it) since it's a standalone named function referenced
// from inside those callbacks, not itself passed directly to a Reanimated hook — see
// resolveTurnIntent in utils/turnIntent.ts for the same pattern.
function partialTrailPath(cells: { x: number; y: number }[], progress: number, cellPx: number) {
  'worklet'
  const path = Skia.Path.Make()
  if (cells.length < 2) return path
  const eatenFloat = progress * (cells.length - 1)
  const eatenWhole = Math.floor(eatenFloat)
  if (eatenWhole >= cells.length - 1) return path
  const frac = eatenFloat - eatenWhole
  const a = cells[eatenWhole]
  const b = cells[eatenWhole + 1]
  // A portal crossing (see gameEngine.ts's tickGame) is the one way two consecutive cells here can
  // land non-adjacent — skip the fractional lerp across it (which would otherwise draw an off-grid
  // diagonal for a frame) and jump straight to `b` instead. Inlined rather than calling grid.ts's
  // isAdjacent: this function is a Reanimated worklet, and an imported function isn't guaranteed to
  // cross that boundary the way a same-file worklet can.
  const adjacent = Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1
  if (adjacent) path.moveTo((a.x + (b.x - a.x) * frac) * cellPx + cellPx / 2, (a.y + (b.y - a.y) * frac) * cellPx + cellPx / 2)
  else path.moveTo(b.x * cellPx + cellPx / 2, b.y * cellPx + cellPx / 2)
  for (let i = eatenWhole + 1; i < cells.length; i++) {
    path.lineTo(cells[i].x * cellPx + cellPx / 2, cells[i].y * cellPx + cellPx / 2)
  }
  return path
}

// Purely cosmetic shape/sizing for the burst below — kept local rather than in constants/game.ts,
// which is reserved for the cross-file *timing* numbers game.tsx also needs (see
// deathAnimationDurationMs) — nothing here needs to be known outside this file, same precedent as
// WALL_STROKE_WIDTH above.
const DEATH_EXPLOSION_RING_MAX_SCALE = 4 // shockwave ring's peak radius, as a multiple of headRadius
const DEATH_EXPLOSION_SHARD_COUNT = 8

// The crashed player's head bursting apart: a flash core, an expanding shockwave ring, and a fixed
// ring of shard dots flying outward — all driven off the single `explosion` shared value (0 -> 1,
// see PlayerTrail's own death-trigger effect) so every piece stays exactly in sync with no separate
// timers to drift apart. Drawn in the player's own color, like every other on-board effect in this
// file (the effect-tell rings above included) — no new neutral/white tint introduced just for this.
// The flash is the head's own replacement, not an addition on top of it — PlayerTrail's dead branch
// below no longer draws a static head circle at all once a player's crashed.
function DeathExplosion({ centerX, centerY, explosion, headRadius, color }: { centerX: number; centerY: number; explosion: SharedValue<number>; headRadius: number; color: string }) {
  // Confined to the burst's first 40% (remapped, same layered-remap trick PowerupGlyph.radius above
  // already does with intro/pulse) so it reads as an instant flash rather than a slow fade.
  const flashRadius = useDerivedValue(() => headRadius * (1 + Math.min(1, explosion.value / 0.4) * 0.6))
  const flashOpacity = useDerivedValue(() => 1 - Math.min(1, explosion.value / 0.4))
  const ringRadius = useDerivedValue(() => headRadius * (1 + explosion.value * (DEATH_EXPLOSION_RING_MAX_SCALE - 1)))
  const ringOpacity = useDerivedValue(() => 1 - explosion.value)

  return (
    <>
      <Circle cx={centerX} cy={centerY} r={flashRadius} color={color} opacity={flashOpacity} />
      <Circle cx={centerX} cy={centerY} r={ringRadius} style='stroke' strokeWidth={2} color={color} opacity={ringOpacity} />
      {Array.from({ length: DEATH_EXPLOSION_SHARD_COUNT }, (_, i) => (
        <ExplosionShard key={i} angle={(i / DEATH_EXPLOSION_SHARD_COUNT) * Math.PI * 2} centerX={centerX} centerY={centerY} explosion={explosion} headRadius={headRadius} color={color} />
      ))}
    </>
  )
}

// One flying ember of the burst above, as its own component rather than a loop of hooks inside
// DeathExplosion — keeps each shard's own useDerivedValue calls one-hook-per-component-instance,
// which a variable-length loop inside a single component can't safely do. `angle` is deterministic
// (evenly spaced, not random) so the burst is reproducible and never looks lopsided.
function ExplosionShard({ angle, centerX, centerY, explosion, headRadius, color }: { angle: number; centerX: number; centerY: number; explosion: SharedValue<number>; headRadius: number; color: string }) {
  const distance = headRadius * DEATH_EXPLOSION_RING_MAX_SCALE
  const cx = useDerivedValue(() => centerX + Math.cos(angle) * distance * explosion.value)
  const cy = useDerivedValue(() => centerY + Math.sin(angle) * distance * explosion.value)
  const radius = useDerivedValue(() => headRadius * 0.35 * (1 - explosion.value))
  const opacity = useDerivedValue(() => 1 - explosion.value)

  return <Circle cx={cx} cy={cy} r={radius} color={color} opacity={opacity} />
}

function PlayerTrail({ player, tickIntervalMs, cellPx, tick, trailSpeedRate, tunnelCellSet }: { player: PlayerState; tickIntervalMs: number; cellPx: number; tick: number; trailSpeedRate: number; tunnelCellSet: ReadonlySet<string> }) {
  // Nearly fill their own cell on purpose — combined with a small cellPx (see constants/game.ts's
  // GRID_CELL_PX), this makes the actual hit-detection boundary obvious at a glance: a trail or head
  // reads as occupying essentially the whole cell it's in, so a one-cell gap between two trails
  // looks (and is) a real, precise near-miss rather than a vague blob-to-blob distance.
  const trailWidth = cellPx * 0.85
  const headRadius = cellPx * 0.475 // 95% diameter

  const trail = player.trail
  const head = cellCenter(trail[trail.length - 1], cellPx)
  const tail = cellCenter(trail[0], cellPx)
  // trail[1] doubles as two different things below: the fixed far end of the tail's own segment
  // (once the trail is long enough that it's a distinct cell from the head), and the "next" cell
  // the tail creeps toward between trims (see tailTarget below). Falls back to trail[0] itself —
  // same as trail[1] would equal once trimmed all the way down — when there's nothing else yet.
  const nextCell = trail.length > 1 ? trail[1] : trail[0]
  const nextCenter = cellCenter(nextCell, cellPx)
  // Continuously interpolated toward nextCenter (see tailProgress) rather than snapping straight to
  // `tail` — the fractional creep between trims, not just the trims themselves, is what needs to
  // animate for the tail to read as *following* rather than holding still and then hopping.
  const progress = tailProgress(tick, trailSpeedRate, trail.length)
  const tailTarget = { x: tail.x + (nextCenter.x - tail.x) * progress, y: tail.y + (nextCenter.y - tail.y) * progress }

  // The game state advances in discrete grid steps (see gameEngine.ts) — snapping straight to
  // each new cell every tick is what read as "choppy" at a tick rate well under the screen's own
  // refresh rate. Animating the head (and the trail's last segment, which follows it) smoothly
  // between cells over the tick's own duration decouples how it looks from how often the
  // simulation actually steps, without touching the underlying grid logic at all. The tail end
  // gets the identical treatment below it: under a laggy trailSpeedTier (see gameEngine.ts's
  // shouldTrimTrailAt) it also advances, and snapping it forward a whole cell on every trim tick
  // read exactly as janky as the head snapping did before this glide existed.
  const animX = useSharedValue(head.x)
  const animY = useSharedValue(head.y)
  const tailAnimX = useSharedValue(tail.x)
  const tailAnimY = useSharedValue(tail.y)
  // The head segment's fixed starting point. Deliberately a shared value snapshotted from
  // animX/animY's own current position (see the tick effect below) rather than recomputed fresh
  // from trail data each render — that was the real source of the jolt: trail data updates the
  // instant a tick commits, but the previous glide's *duration* was only ever a best guess (see
  // lastTickAtRef below), so it routinely hadn't actually finished yet at that instant. A fresh
  // trail-derived anchor would snap straight to the new cell regardless, landing ahead of wherever
  // animX/animY actually were and opening a visible gap/backtrack every single tick it happened on
  // — which, under any jitter, was most of them.
  const edgeStartX = useSharedValue(head.x)
  const edgeStartY = useSharedValue(head.y)
  // Wall-clock time (see lastTickAtRef below) the previous glide actually started at — always set
  // by the reset branch before the animate branch can read it.
  const lastTickAtRef = useRef(0)
  // The chain of cells a Prune or Shield break-through just severed from the front, ordered from
  // the break point (nearest the surviving trail) to the old tail (farthest) — see the severed-eat
  // effect and severedPath below. Grid coordinates, not pixels, so cellPx changing (it never does
  // mid-round, but nothing here should assume that) wouldn't desync it. Plain objects rather than
  // GridCell[] directly only because a shared value's contents need to be worklet-safe/serializable.
  const severedCells = useSharedValue<{ x: number; y: number }[]>([])
  // 0 = the full severed chain still visible, 1 = fully eaten away — see severedPath, which draws
  // only the suffix of severedCells still "ahead of" this progress. Starts at 1 (nothing to show)
  // rather than 0, so an idle trail with no severed segment yet doesn't render one.
  const severedProgress = useSharedValue(1)
  // This player's own trail, snapshotted head-first/tail-last the instant they crash (see the
  // death-trigger effect below) — the reverse order severedCells above uses, since a death wipe
  // eats from the opposite end (the head, where the crash happened) rather than from a break point
  // toward the old tail. Same worklet-safe plain-object shape as severedCells, for the same reason.
  const deathWipeCells = useSharedValue<{ x: number; y: number }[]>([])
  // 0 = full trail still visible, 1 = fully wiped — same convention as severedProgress, consumed by
  // deathWipePath below via the same partialTrailPath helper severedPath itself now uses.
  const wipeProgress = useSharedValue(0)
  // Drives DeathExplosion, 0 -> 1. At exactly 0 (its resting value until the death-trigger effect
  // below starts it) the flash core's own radius/opacity formula happens to land on a plain solid
  // circle at headRadius, full opacity — i.e. an ordinary head marker — so there's no visible seam
  // between "still alive" and "just died, hasn't started bursting yet."
  const explosion = useSharedValue(0)
  // Guards the death-trigger effect below against re-firing on every re-render while `player.alive`
  // stays false for the rest of `'roundOver'` — a plain ref, not a shared value, since it's only
  // ever read/written from JS-thread effects, never from a worklet. Reset alongside the other death
  // shared values in the tick === 0 branch above, which is load-bearing, not just tidy: without
  // that reset, a second round's own death would be silently swallowed by this ref still saying
  // "already started" from round 1.
  const deathAnimStartedRef = useRef(false)

  useEffect(() => {
    if (tick === 0) {
      // First paint, or a fresh round via rematch — GameState.tick resets to 0 on every new round
      // (see createInitialGameState), which is what actually distinguishes this from a real tick:
      // rematch resets game *state* but doesn't remount this component, so a plain "have we ever
      // mounted" ref stayed true across rounds and this branch never re-ran — the animate branch
      // below took over on round 2 and tried to glide from wherever the previous round ended all
      // the way to the new spawn point. Jump straight to the starting cell instead.
      animX.value = head.x
      animY.value = head.y
      tailAnimX.value = tailTarget.x
      tailAnimY.value = tailTarget.y
      edgeStartX.value = head.x
      edgeStartY.value = head.y
      lastTickAtRef.current = performance.now()
      // A break's own eat-away can still be mid-flight the instant its round ends (see the
      // severed-eat effect's own comment on why that's fine to just let vanish) — clear it here so
      // a rematch's fresh trail doesn't inherit a stale, unrelated severed segment left over from
      // wherever the previous round's animation happened to stop.
      severedCells.value = []
      severedProgress.value = 1
      // Same idea for the death sequence: a rematch always starts every player alive again, but the
      // shared values driving last round's explosion/wipe don't know that on their own. Resetting
      // deathAnimStartedRef here (not just the shared values) is what actually matters — without it,
      // the death-trigger effect below would still think this round's own death already "started",
      // from round 1, and silently never fire for round 2's.
      deathWipeCells.value = []
      wipeProgress.value = 0
      explosion.value = 0
      deathAnimStartedRef.current = false
      return
    }
    // Duration is measured against the actual gap since the previous tick's glide started, not
    // the nominal tickIntervalMs the tick loop (useGameState.ts) is targeting — that loop only
    // checks its own elapsed time once per rAF frame, so it can overshoot the target by up to a
    // frame every tick. Capped at 3x the nominal interval so a real stall (backgrounded tab, GC
    // pause) can't stretch a single glide across it.
    const now = performance.now()
    const duration = Math.max(1, Math.min(now - lastTickAtRef.current, tickIntervalMs * 3))
    lastTickAtRef.current = now
    // A portal crossing (see gameEngine.ts's tickGame) is the one way this tick's new head cell can
    // land non-adjacent to the one before it — the ordinary pixel-space glide below assumes
    // adjacency (it's a straight line from the old position to the new one), so a portal jump has
    // to snap instantly instead, or it'd visibly slide the head across unrelated board geometry.
    const prevHeadCell = trail.length > 1 ? trail[trail.length - 2] : null
    const isPortalJump = prevHeadCell !== null && !isAdjacent(prevHeadCell, trail[trail.length - 1])

    // Freeze wherever the head glide actually is *right now* — not its target — as the next
    // segment's fixed anchor, before retargeting it below. See edgeStartX's own comment for why:
    // this is what guarantees the fixed anchor and the animated point are always exactly
    // coincident the instant a new segment starts, regardless of whether the glide this replaces
    // had actually finished. A portal jump instead snaps this straight to the new head — there's no
    // meaningful "in-flight position" to freeze when the segment about to start isn't a real,
    // on-screen line at all.
    edgeStartX.value = isPortalJump ? head.x : animX.value
    edgeStartY.value = isPortalJump ? head.y : animY.value
    if (isPortalJump) {
      animX.value = head.x
      animY.value = head.y
    } else {
      animX.value = withTiming(head.x, { duration, easing: Easing.linear })
      animY.value = withTiming(head.y, { duration, easing: Easing.linear })
    }
    // Targets tailTarget (the fractional creep toward nextCenter — see tailProgress), not `tail`
    // itself, so this animates every tick under a non-static tier, not only the ones that trim a
    // whole cell off. That's what actually fixes the held-then-hop cadence: previously this only
    // had two states, sitting at `tail` or gliding to a new `tail`, so any tick that didn't trim
    // looked identical to the tail not following at all.
    tailAnimX.value = withTiming(tailTarget.x, { duration, easing: Easing.linear })
    tailAnimY.value = withTiming(tailTarget.y, { duration, easing: Easing.linear })
    // Only an actual new tick should retrigger this — tickIntervalMs changing mid-glide (speed
    // ramp) should finish the current glide at its original pace, not restart it. Keyed on `tick`
    // rather than trail.length: under a laggy trailSpeedTier, a tick that both appends and trims
    // the trail leaves its length unchanged, which would otherwise silently skip the glide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  // Detects a Prune/Shield-break severing more than one cell off the trail's front in one go, and
  // kicks off severedPath's eat-away for exactly that chain of cells. Compares against the trail
  // this component saw on its OWN last run (a plain ref is fine here — read and written only
  // inside this effect, never during render) rather than trail.length, which can't tell "1 cell
  // trimmed" from "40 cells severed" and wouldn't have the actual cut cells to animate through
  // anyway. Keyed on `trail` itself, not `tick`: a Prune activation (see useGameState.ts's
  // `activate`) trims the trail independent of the tick loop entirely, so gating this on `tick`
  // the way the glide effect above does would miss it until the next real tick happened to land.
  const prevTrailRef = useRef(trail)
  useEffect(() => {
    const prevTrail = prevTrailRef.current
    prevTrailRef.current = trail
    const newFront = trail[0]
    const cutIndex = prevTrail.findIndex((c) => c.x === newFront.x && c.y === newFront.y)
    // 0 = nothing cut. 1 = the routine single-cell growth-tier trim, already handled smoothly by
    // tailProgress/tailAnimX above — no jump to fix there. -1 = no relation at all to the previous
    // trail (a fresh round's spawn cell vs. the last round's final trail), which this same check
    // conveniently also skips correctly with no separate tick===0 case needed.
    if (cutIndex <= 1) return
    // Order: index 0 nearest the break (surviving trail), last index the old tail — the direction
    // severedPath actually eats through, matching where a player's eye is already looking (the
    // break just happened right there) rather than starting from the far, unwatched tail end.
    const removedCells = prevTrail.slice(0, cutIndex).reverse()
    const duration = Math.min(TRAIL_SEVER_EAT_MAX_MS, Math.max(TRAIL_SEVER_EAT_MIN_MS, removedCells.length * TRAIL_SEVER_EAT_MS_PER_CELL))
    // The surviving tail is now at `tail` (trail[0], post-break) — snapped instantly rather than
    // animated there, since the severed segment below is what now carries the "something just
    // happened" visual. Without this, the tick effect's own withTiming (see above — it runs first
    // within the same commit on a Shield break, which is tick-synchronized; this effect's plain
    // assignment overrides it, same "last write this commit wins" trick edgeStartX's snapshot
    // already relies on) would glide tailAnimX/Y from wherever it was toward the new, generally
    // non-adjacent `tail` in a straight pixel-space line — the exact diagonal this whole mechanism
    // exists to get rid of. Fresh fractional creep toward the new nextCenter (see tailTarget)
    // resumes correctly from here on subsequent ticks with no special-casing needed.
    //
    // react-hooks/immutability doesn't recognize Reanimated's SharedValue as the deliberate,
    // React-Compiler-exempt mutable escape hatch it is — every .value assignment in this file
    // (animX/tailAnimX/edgeStartX above included) has this identical shape, and this project
    // doesn't run the React Compiler itself (see eslint.config.cjs, where the rule is 'warn'-only
    // for exactly this reason: a heads-up for a future migration, not an enforced constraint now).
    /* eslint-disable react-hooks/immutability */
    severedCells.value = removedCells.map((c) => ({ x: c.x, y: c.y }))
    severedProgress.value = 0
    severedProgress.value = withTiming(1, { duration, easing: Easing.linear })
    tailAnimX.value = tail.x
    tailAnimY.value = tail.y
    /* eslint-enable react-hooks/immutability */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail])

  // Kicks off this player's death sequence the instant `player.alive` flips false — the crash
  // itself, not a tick or a phase prop, is the real trigger (mirrors the severed-eat effect above's
  // own "react to the data itself" idiom). Guarded by deathAnimStartedRef, not just the `false`
  // dependency, since `player.alive` staying false for the rest of `'roundOver'` would otherwise
  // re-run this every time PlayerTrail re-renders for any other reason (an opponent's own
  // still-live head animating, for instance).
  useEffect(() => {
    if (player.alive || deathAnimStartedRef.current) return
    deathAnimStartedRef.current = true
    const { explosionMs, wipeMs } = deathAnimationDurationMs(trail.length)
    // See the severed-eat effect above's own comment on react-hooks/immutability — same
    // SharedValue.value idiom, same reason it's safe to disable here.
    /* eslint-disable react-hooks/immutability */
    // Head-first, tail-last (the reverse of severedCells' own break-point-first order above) — see
    // partialTrailPath's own comment for why that ordering is what makes progress 0->1 eat from the
    // head end toward the tail, matching where the crash actually happened.
    deathWipeCells.value = [...trail].reverse().map((c) => ({ x: c.x, y: c.y }))
    explosion.value = withTiming(1, { duration: explosionMs, easing: Easing.out(Easing.cubic) })
    // Doesn't start eating until the explosion's own burst has finished — the trail should still
    // read as "there," rooting the explosion to something, while the car itself is bursting apart.
    wipeProgress.value = withDelay(explosionMs, withTiming(1, { duration: wipeMs, easing: Easing.linear }))
    /* eslint-enable react-hooks/immutability */
    // Deliberately keyed only on player.alive — trail is read once here, at the exact instant it
    // flips, and (unlike a live player's trail) never changes again for the rest of the round, so
    // there's nothing for a wider dependency list to catch that this would miss.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.alive])

  // The severed chain's currently-visible suffix, as a Skia path — see partialTrailPath's own
  // comment for the interpolation technique. Renders nothing (Skia strokes an empty/1-point path as
  // nothing) once fully eaten, or when there's no severed segment at all — the idle default.
  const severedPath = useDerivedValue(() => partialTrailPath(severedCells.value, severedProgress.value, cellPx))

  // This player's own trail wiping itself out from head to tail once they've crashed — same
  // technique, walking deathWipeCells (head-first — see the death-trigger effect above) instead of
  // severedCells. Renders nothing once fully wiped, which is the deliberate final state: no dimmed
  // remnant left behind (see the dead-player render branch below).
  const deathWipePath = useDerivedValue(() => partialTrailPath(deathWipeCells.value, wipeProgress.value, cellPx))

  // This player's own underground segments — see tunnelHighlightPath's own comment. A plain useMemo
  // (not a shared value/worklet) is enough: unlike the death/sever animations above, there's nothing
  // here that needs to animate frame-by-frame, only to update when the trail itself changes.
  const tunnelPath = useMemo(() => tunnelHighlightPath(trail, tunnelCellSet, cellPx), [trail, tunnelCellSet, cellPx])

  // `anchorCell` is where the head stood BEFORE its most recent move, as a GRID cell — matching
  // `trail`'s own element type, not `head`'s pixel one, since boundaryIndex below searches for it
  // WITHIN `trail`; comparing pixel coordinates against grid ones there would never match at all.
  // `prevHeadCell` is scratch state purely for detecting the transition; `anchorCell` is the actual
  // payload, captured from `prevHeadCell`'s OLD value in the SAME render-phase update that advances
  // `prevHeadCell` to the new head cell. This two-state split is required, not stylistic: React's
  // "adjusting state during render" pattern (see
  // https://react.dev/reference/react/useState#storing-information-from-previous-renders, the
  // `trend`-derived-from-`prevCount` example) immediately re-invokes this component once
  // `prevHeadCell` is updated, and `prevHeadCell` reads as the NEW head cell from that very
  // re-invocation onward — a single `prevHeadCell` state, read anywhere outside this `if`, would
  // desync by exactly one head-move, always resolving to the head's own index and quietly breaking
  // the animated bridge to it. A ref would have the identical problem this pattern exists to avoid,
  // plus reading it during render is unsafe (and lint-forbidden) under concurrent rendering; an
  // effect-based update would land one render late, after `trail` had already moved on to yet
  // another tick's data.
  const headCell = trail[trail.length - 1]
  const [prevHeadCell, setPrevHeadCell] = useState(headCell)
  const [anchorCell, setAnchorCell] = useState(headCell)
  if (headCell.x !== prevHeadCell.x || headCell.y !== prevHeadCell.y) {
    setAnchorCell(prevHeadCell)
    setPrevHeadCell(headCell)
  }
  // Index of anchorCell within the CURRENT trail array — the front animated segment's true fixed
  // anchor (settledPath below stops there; everything past it is this tick's own new movement,
  // tracked live by animX/animY instead so it glides into place rather than snapping). Re-looked-up
  // fresh every render, rather than cached as an index alongside anchorCell, so it stays correct
  // even when the trail's FRONT also shifted since anchorCell was captured — a Prune/Shield severing
  // cells off the front (see the severed-eat effect below) can land on any render, not just the ones
  // where the head itself also happens to move, and a cached index would silently point at whatever
  // cell now sits at that position instead of at anchorCell's actual, possibly-shifted one. -1 (not
  // found — anchorCell itself got severed away too, or a fresh round's spawn cell has no relation to
  // the last round's final trail) clamps to 0: the whole current trail counts as new movement.
  const foundIndex = trail.findIndex((c) => c.x === anchorCell.x && c.y === anchorCell.y)
  const boundaryIndex = foundIndex === -1 ? 0 : foundIndex

  // Every settled cell except the first and the ones this tick's own movement just added (which
  // are instead tracked live by (tailAnimX, tailAnimY) and (animX, animY) below so both ends glide
  // into place rather than snapping).
  const settledPath = useMemo(() => trailPath(trail.slice(1, boundaryIndex + 1), cellPx), [trail, cellPx, boundaryIndex])

  // trail[boundaryIndex] (this segment's true fixed anchor) and trail[1] (nextCell/nextCenter, the
  // tail segment's own far end) are the exact same cell whenever boundaryIndex === 1 — the trail's
  // only "middle" cell is both at once (the single-step-per-tick case this used to hardcode as
  // trail.length === 3; boundaryIndex generalizes it to a boosted tick's larger step count too).
  // settledPath (trail.slice(1, boundaryIndex+1)) is what's supposed to visually cover any slack
  // between the two segments meeting there, but when boundaryIndex <= 1 that slice has at most one
  // point — Skia strokes nothing for a path with no line segments — so there's no stroke left to
  // mask even the small mismatch edgeStartX's own snapshot timing can leave (see its comment): the
  // two segments could each land a pixel or two short of the shared cell and the result is a visible
  // gap with nothing drawn between them. Using the real cell directly there instead of the snapshot
  // costs nothing and guarantees the two segments meet exactly, independent of animation timing.
  // boundaryIndex === 0 needs `tail` specifically, not `nextCenter` — trail[0] and trail[1] are
  // DIFFERENT cells (unlike the boundaryIndex === 1 case, where trail[1] IS trail[boundaryIndex]),
  // and substituting the wrong one here skips the tail-to-trail[1] cell entirely from this segment,
  // opening a real gap wherever tailEdgeStart/tailEdgeEnd doesn't independently happen to cover the
  // exact same span (see boundaryIndex's own comment for how it can land on 0: anchorCell itself
  // getting severed away, or a boost active before the trail's grown past its own step count).
  // Longer trails keep the snapshot: trail[boundaryIndex] is a cell neither `tail` nor `nextCenter`
  // there.
  const edgeAnchor = boundaryIndex === 0 ? tail : boundaryIndex === 1 ? nextCenter : null
  const edgeStart = useDerivedValue(() => (edgeAnchor ? vec(edgeAnchor.x, edgeAnchor.y) : vec(edgeStartX.value, edgeStartY.value)))
  const edgeEnd = useDerivedValue(() => vec(animX.value, animY.value))

  const tailEdgeStart = useDerivedValue(() => vec(tailAnimX.value, tailAnimY.value))
  // trail[1] (nextCell/nextCenter, computed above) IS the head itself once the trail's down to two
  // cells or less — trimmed aggressively enough (see 'fast', or any tier early in a round before
  // the trail has grown past a couple of cells) that there's nothing between the tail and the head
  // to be a distinct fixed point. Using nextCenter's plain (unanimated) position there snapped this
  // segment's far end straight to the head's *discrete* cell the instant that happened, while the
  // head itself was still mid-glide toward it — the tail's line would already reach exactly where
  // the head marker hadn't visually arrived yet, reading as the tail poking out ahead of the
  // vehicle. Following animX/animY instead — the same live position the head marker itself uses —
  // keeps the two exactly coincident the whole time, same fix as edgeStartX's own for the same
  // underlying mismatch (a static, trail-derived point vs. a live animated one that hasn't caught
  // up to it yet).
  const tailEdgeEnd = useDerivedValue(() => (trail.length > 2 ? vec(nextCenter.x, nextCenter.y) : vec(animX.value, animY.value)))

  // Where the explosion above bursts from — `player.crashCell` when set (populated even for an
  // out-of-bounds crash, whose true destination has no `trail` slot of its own — see PlayerState's
  // own comment) so the burst centers exactly on the real collision point rather than the last
  // valid on-grid cell short of it.
  const deathCenter = player.crashCell ? cellCenter(player.crashCell, cellPx) : head

  return (
    <>
      {player.alive ? (
        <>
          {/* Underneath everything else — see tunnelHighlightPath's own comment. */}
          <Path path={tunnelPath} style='stroke' strokeWidth={trailWidth * 1.6} strokeCap='round' strokeJoin='round' color={player.color} opacity={0.35} />
          <Path path={settledPath} style='stroke' strokeWidth={trailWidth} strokeCap='round' strokeJoin='round' color={player.color} />
          {/* The chain a Prune/Shield break just cut off `trail` entirely — no longer part of
          settledPath/tailEdgeEnd's own data at all, but still visibly eating itself away for a
          beat rather than just vanishing. See severedPath's own comment. */}
          <Path path={severedPath} style='stroke' strokeWidth={trailWidth} strokeCap='round' strokeJoin='round' color={player.color} />
          <Line p1={tailEdgeStart} p2={tailEdgeEnd} strokeWidth={trailWidth} strokeCap='round' color={player.color} />
          {/* Skipped once the tail's own segment already reaches the head (trail.length <= 2 —
          see tailEdgeEnd's comment): edgeStart is a snapshot of the head's own glide a moment
          ago, updated on its own schedule, unrelated to tailAnimX's — the two segments could
          each be "correct" on their own terms and still not meet exactly, leaving a visible gap
          between them right where the trail is shortest. There's nothing for this segment to add
          once the tail segment already spans tail-to-head on its own. */}
          {trail.length > 2 && <Line p1={edgeStart} p2={edgeEnd} strokeWidth={trailWidth} strokeCap='round' color={player.color} />}
          <Circle cx={animX} cy={animY} r={headRadius} color={player.color} />
          {/* Always white, not getContrastColor(player.color) — that picks black for light
          colors like yellow, which blends into the dark board background instead of standing
          out against it. */}
          <Circle cx={animX} cy={animY} r={headRadius} style='stroke' strokeWidth={1.5} color='#ffffff' />
          {/* Active-effect "tell" rings, nested at increasing radii so more than one at once
          (e.g. Shield popped while already Overclocked) stays visually distinguishable rather
          than overlapping exactly. Colored by what's actually driving the effect (see
          POWERUP_EFFECT_COLORS) so Overdrive/Overclock read as visually distinct at a glance
          despite sharing the same 2x multiplier — one is something you chose, the other isn't. */}
          {player.effects.speed && <Circle cx={animX} cy={animY} r={headRadius * 1.35} style='stroke' strokeWidth={2} color={POWERUP_EFFECT_COLORS[player.effects.speed.type]} />}
          {player.effects.control && <Circle cx={animX} cy={animY} r={headRadius * 1.7} style='stroke' strokeWidth={2} color={POWERUP_EFFECT_COLORS.hack} />}
          {player.effects.shield && <Circle cx={animX} cy={animY} r={headRadius * 2.05} style='stroke' strokeWidth={2} color={POWERUP_EFFECT_COLORS.shield} />}
        </>
      ) : (
        // Round already decided for this player — the crash itself already fired their death
        // sequence (see the death-trigger effect above): the head bursts apart, then the trail
        // wipes itself out from head to tail. No static freeze-frame anymore — deathWipePath
        // renders the full trail at explosion=wipeProgress=0 and progressively less as wipeProgress
        // advances, ending at nothing, which is the deliberate final state (see deathWipePath's own
        // comment) — nothing left to dim once it's gone.
        <>
          <Path path={tunnelPath} style='stroke' strokeWidth={trailWidth * 1.6} strokeCap='round' strokeJoin='round' color={player.color} opacity={0.35} />
          <Path path={deathWipePath} style='stroke' strokeWidth={trailWidth} strokeCap='round' strokeJoin='round' color={player.color} />
          <DeathExplosion centerX={deathCenter.x} centerY={deathCenter.y} explosion={explosion} headRadius={headRadius} color={player.color} />
        </>
      )}
    </>
  )
}

export function GameBoard({ players, phase, tickIntervalMs, cellPx, grid, orientationMode, p1OnRight, tick, pickups, pickupColor, obstacles, obstacleColor, portals, tunnels, trailSpeedRate, wrapEdges }: GameBoardProps) {
  // Computed once here (not inside PlayerTrail) so both players' own PlayerTrail instances share
  // the exact same Set rather than each rebuilding an identical one from the same static `tunnels`.
  const tunnelCellSet = useMemo(() => new Set(tunnels.flatMap((tunnel) => tunnel.cells.map(cellKey))), [tunnels])

  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Walls grid={grid} cellPx={cellPx} orientationMode={orientationMode} p1OnRight={p1OnRight} players={players} phase={phase} wrapEdges={wrapEdges} />
        {/* Unlike Walls above, not hidden during onboarding — obstacle/portal/tunnel placement is
        gameplay information a player needs to see before the round starts, not just a boundary
        marker that clutters the countdown's own zone overlay. */}
        <Obstacles obstacles={obstacles} cellPx={cellPx} color={obstacleColor} />
        <Portals portals={portals} cellPx={cellPx} color={obstacleColor} />
        <Tunnels tunnels={tunnels} cellPx={cellPx} color={obstacleColor} />
        <Powerups pickups={pickups} cellPx={cellPx} color={pickupColor} />
        <PlayerTrail player={players[1]} tickIntervalMs={tickIntervalMs} cellPx={cellPx} tick={tick} trailSpeedRate={trailSpeedRate} tunnelCellSet={tunnelCellSet} />
        <PlayerTrail player={players[2]} tickIntervalMs={tickIntervalMs} cellPx={cellPx} tick={tick} trailSpeedRate={trailSpeedRate} tunnelCellSet={tunnelCellSet} />
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 }
})
