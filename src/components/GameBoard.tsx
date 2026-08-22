import { getContrastColor } from '@rific/auto-paper'
import { Canvas, Circle, Line, Path, Skia, vec } from '@shopify/react-native-skia'
import { Fragment, useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated'

import { POWERUP_EFFECT_COLORS, powerupPickupRadiusPx } from '@/constants/game'
import { GamePhase, GridCell, GridSize, OrientationMode, Player, PlayerState, PowerupPickup } from '@/types'
import { cellToPixel } from '@/utils/grid'

export interface GameBoardProps {
  players: Record<Player, PlayerState>
  phase: GamePhase
  tickIntervalMs: number
  cellPx: number
  grid: GridSize
  orientationMode: OrientationMode
  // Only meaningful when orientationMode === 'sideBySide' — see useP1OnRight and
  // TouchInputLayer.tsx's identical prop.
  p1OnRight: boolean
  // Ticks elapsed this round — see GameState's own comment. Drives PlayerTrail's head-glide
  // retrigger instead of trail.length, which a laggy trailGrowthTier can leave unchanged on a tick
  // that both grows and trims the trail.
  tick: number
  pickups: PowerupPickup[]
  // The resolved TRAIL_GROWTH_RATE number for the active trailGrowthTier (see constants/game.ts) —
  // lets PlayerTrail interpolate the tail's position continuously between trims instead of holding
  // still and then snapping a whole cell forward. Passed as the raw rate, not the tier, so this
  // component stays as decoupled from the tier enum as gameEngine.ts's own tickGame already is.
  trailGrowthRate: number
}

function cellCenter(cell: GridCell, cellPx: number) {
  const { x, y } = cellToPixel(cell, cellPx)
  return { x: x + cellPx / 2, y: y + cellPx / 2 }
}

// A crashed player's final trail dims relative to the survivor's, but stays legible — not faded
// to the point it's hard to make out against the board's own black/white background, especially
// now that the round-over dialog can be tucked away to actually look at the finished board.
const DEAD_TRAIL_OPACITY = 0.6
// A neutral grey rather than getContrastColor's black-or-white pick — that function is tuned for
// a *live* head marker standing out against the board, but on an already-dimmed dead one a pure
// white ring reads as too bright/stark against the muted fill it's outlining.
const DEAD_HEAD_OUTLINE_COLOR = '#888888'

// Thin on purpose — this is a boundary marker, not a trail, and shouldn't compete with the
// trails/heads for visual weight. Flat rather than scaled with cellPx, same reasoning as the head
// ring's own stroke width above.
const WALL_STROKE_WIDTH = 1.5

// Every live pickup renders identically, regardless of its actual (already-decided, see
// gameEngine.ts's maybeSpawnPickup) type — Mario-Kart mystery-box style. The type is only ever
// revealed once collected, in the holder's own HUD badge (see PowerupHud.tsx), never on the board.
const POWERUP_MYSTERY_FILL = '#CFD8DC'
const POWERUP_MYSTERY_STROKE = '#FFFFFF'

function pickupGlyphPath(center: { x: number; y: number }, radius: number) {
  const path = Skia.Path.Make()
  path.addCircle(center.x, center.y, radius)
  return path
}

function Powerups({ pickups, cellPx }: { pickups: PowerupPickup[]; cellPx: number }) {
  const radius = powerupPickupRadiusPx(cellPx)
  return (
    <>
      {pickups.map((pu) => {
        const path = pickupGlyphPath(cellCenter(pu.cell, cellPx), radius)
        return (
          <Fragment key={pu.id}>
            <Path path={path} color={POWERUP_MYSTERY_FILL} style='fill' opacity={0.35} />
            <Path path={path} color={POWERUP_MYSTERY_STROKE} style='stroke' strokeWidth={1.5} />
          </Fragment>
        )
      })}
    </>
  )
}

// Each player "owns" the half of the perimeter behind their own zone — the same top/bottom or
// left/right split TouchInputLayer already uses for input zones (see grid.ts's startingStateFor)
// — so the wall reads as which player crashes into which edge, not just an arbitrary boundary.
// Drawn at the grid's own pixel size (cols/rows * cellPx), not the container's, since a container
// a few pixels larger than a whole number of cells (see computeGridSize's flooring) still crashes
// exactly at the grid edge — the outline should hug that real boundary, not the container's.
function wallPath(grid: GridSize, cellPx: number, orientationMode: OrientationMode, p1OnRight: boolean, player: Player) {
  const width = grid.cols * cellPx
  const height = grid.rows * cellPx
  const path = Skia.Path.Make()

  if (orientationMode === 'faceToFace') {
    // Player 2 is the "far" (top) zone, player 1 the "near" (bottom) zone.
    const midY = height / 2
    if (player === 2) {
      path.moveTo(0, midY)
      path.lineTo(0, 0)
      path.lineTo(width, 0)
      path.lineTo(width, midY)
    } else {
      path.moveTo(0, midY)
      path.lineTo(0, height)
      path.lineTo(width, height)
      path.lineTo(width, midY)
    }
    return path
  }

  // Side-by-side (and web's shared layout): whichever player is currently on the right gets the
  // right zone — see useP1OnRight for which physical rotation direction puts P1 there (and
  // TouchInputLayer.tsx's identical split), so the wall matches wherever each player's zone
  // actually ended up rather than assuming a fixed side.
  const onRight = player === 1 ? p1OnRight : !p1OnRight
  const midX = width / 2
  if (!onRight) {
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

function Walls({ grid, cellPx, orientationMode, p1OnRight, players, phase }: { grid: GridSize; cellPx: number; orientationMode: OrientationMode; p1OnRight: boolean; players: Record<Player, PlayerState>; phase: GamePhase }) {
  const p1Path = useMemo(() => wallPath(grid, cellPx, orientationMode, p1OnRight, 1), [grid, cellPx, orientationMode, p1OnRight])
  const p2Path = useMemo(() => wallPath(grid, cellPx, orientationMode, p1OnRight, 2), [grid, cellPx, orientationMode, p1OnRight])

  // Hidden during the onboarding countdown — the boundary marker is only meaningful once a round
  // is actually live, and it visually clutters the countdown's own player-zone overlay.
  if (phase === 'onboarding') return null

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
function tailProgress(tick: number, growthRate: number): number {
  if (growthRate >= 1) return 0
  const fractionalTrims = tick * (1 - growthRate)
  return fractionalTrims - Math.floor(fractionalTrims)
}

function trailPath(trail: PlayerState['trail'], cellPx: number) {
  const path = Skia.Path.Make()
  if (trail.length === 0) return path
  const first = cellCenter(trail[0], cellPx)
  path.moveTo(first.x, first.y)
  for (const cell of trail.slice(1)) {
    const { x, y } = cellCenter(cell, cellPx)
    path.lineTo(x, y)
  }
  return path
}

function PlayerTrail({ player, phase, tickIntervalMs, cellPx, tick, trailGrowthRate }: { player: PlayerState; phase: GamePhase; tickIntervalMs: number; cellPx: number; tick: number; trailGrowthRate: number }) {
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
  const progress = tailProgress(tick, trailGrowthRate)
  const tailTarget = { x: tail.x + (nextCenter.x - tail.x) * progress, y: tail.y + (nextCenter.y - tail.y) * progress }

  // The game state advances in discrete grid steps (see gameEngine.ts) — snapping straight to
  // each new cell every tick is what read as "choppy" at a tick rate well under the screen's own
  // refresh rate. Animating the head (and the trail's last segment, which follows it) smoothly
  // between cells over the tick's own duration decouples how it looks from how often the
  // simulation actually steps, without touching the underlying grid logic at all. The tail end
  // gets the identical treatment below it: under a laggy trailGrowthTier (see gameEngine.ts's
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
    // Freeze wherever the head glide actually is *right now* — not its target — as the next
    // segment's fixed anchor, before retargeting it below. See edgeStartX's own comment for why:
    // this is what guarantees the fixed anchor and the animated point are always exactly
    // coincident the instant a new segment starts, regardless of whether the glide this replaces
    // had actually finished.
    edgeStartX.value = animX.value
    edgeStartY.value = animY.value
    animX.value = withTiming(head.x, { duration, easing: Easing.linear })
    animY.value = withTiming(head.y, { duration, easing: Easing.linear })
    // Targets tailTarget (the fractional creep toward nextCenter — see tailProgress), not `tail`
    // itself, so this animates every tick under a non-static tier, not only the ones that trim a
    // whole cell off. That's what actually fixes the held-then-hop cadence: previously this only
    // had two states, sitting at `tail` or gliding to a new `tail`, so any tick that didn't trim
    // looked identical to the tail not following at all.
    tailAnimX.value = withTiming(tailTarget.x, { duration, easing: Easing.linear })
    tailAnimY.value = withTiming(tailTarget.y, { duration, easing: Easing.linear })
    // Only an actual new tick should retrigger this — tickIntervalMs changing mid-glide (speed
    // ramp) should finish the current glide at its original pace, not restart it. Keyed on `tick`
    // rather than trail.length: under a laggy trailGrowthTier, a tick that both appends and trims
    // the trail leaves its length unchanged, which would otherwise silently skip the glide.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  // Every settled cell except the first and last, which are instead tracked live by
  // (tailAnimX, tailAnimY) and (animX, animY) below so both ends glide into place rather than
  // snapping.
  const settledPath = useMemo(() => trailPath(trail.slice(1, -1), cellPx), [trail, cellPx])
  const fullPath = useMemo(() => trailPath(trail, cellPx), [trail, cellPx])

  const edgeStart = useDerivedValue(() => vec(edgeStartX.value, edgeStartY.value))
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

  const dimmed = phase === 'roundOver' && !player.alive

  return (
    <>
      {player.alive ? (
        <>
          <Path path={settledPath} style='stroke' strokeWidth={trailWidth} strokeCap='round' strokeJoin='round' color={player.color} />
          <Line p1={tailEdgeStart} p2={tailEdgeEnd} strokeWidth={trailWidth} strokeCap='round' color={player.color} />
          <Line p1={edgeStart} p2={edgeEnd} strokeWidth={trailWidth} strokeCap='round' color={player.color} />
          <Circle cx={animX} cy={animY} r={headRadius} color={player.color} />
          <Circle cx={animX} cy={animY} r={headRadius} style='stroke' strokeWidth={1.5} color={getContrastColor(player.color)} />
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
        // Round already decided for this player — show the exact final path statically rather
        // than mid-glide, but keep a (static, non-animated) head marker at the crash cell so
        // exactly where they went down is still visible, not just inferable from where the line
        // happens to end.
        <>
          <Path path={fullPath} style='stroke' strokeWidth={trailWidth} strokeCap='round' strokeJoin='round' color={player.color} opacity={dimmed ? DEAD_TRAIL_OPACITY : 1} />
          <Circle cx={head.x} cy={head.y} r={headRadius} color={player.color} opacity={dimmed ? DEAD_TRAIL_OPACITY : 1} />
          <Circle cx={head.x} cy={head.y} r={headRadius} style='stroke' strokeWidth={1.5} color={DEAD_HEAD_OUTLINE_COLOR} opacity={dimmed ? DEAD_TRAIL_OPACITY : 1} />
        </>
      )}
    </>
  )
}

export function GameBoard({ players, phase, tickIntervalMs, cellPx, grid, orientationMode, p1OnRight, tick, pickups, trailGrowthRate }: GameBoardProps) {
  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Walls grid={grid} cellPx={cellPx} orientationMode={orientationMode} p1OnRight={p1OnRight} players={players} phase={phase} />
        <Powerups pickups={pickups} cellPx={cellPx} />
        <PlayerTrail player={players[1]} phase={phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} tick={tick} trailGrowthRate={trailGrowthRate} />
        <PlayerTrail player={players[2]} phase={phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} tick={tick} trailGrowthRate={trailGrowthRate} />
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 }
})
