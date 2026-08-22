import { getContrastColor } from '@rific/auto-paper'
import { Canvas, Circle, Line, Path, Skia, vec } from '@shopify/react-native-skia'
import { useEffect, useMemo, useRef } from 'react'
import { StyleSheet, View } from 'react-native'
import { Easing, useDerivedValue, useSharedValue, withTiming } from 'react-native-reanimated'

import { GamePhase, GridCell, GridSize, OrientationMode, Player, PlayerState } from '@/types'
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

function PlayerTrail({ player, phase, tickIntervalMs, cellPx, tick }: { player: PlayerState; phase: GamePhase; tickIntervalMs: number; cellPx: number; tick: number }) {
  // Nearly fill their own cell on purpose — combined with a small cellPx (see constants/game.ts's
  // GRID_CELL_PX), this makes the actual hit-detection boundary obvious at a glance: a trail or head
  // reads as occupying essentially the whole cell it's in, so a one-cell gap between two trails
  // looks (and is) a real, precise near-miss rather than a vague blob-to-blob distance.
  const trailWidth = cellPx * 0.85
  const headRadius = cellPx * 0.475 // 95% diameter

  const trail = player.trail
  const head = cellCenter(trail[trail.length - 1], cellPx)
  const tail = cellCenter(trail[0], cellPx)

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
      tailAnimX.value = tail.x
      tailAnimY.value = tail.y
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
    // A no-op glide (same start/end) on every tick the tail doesn't actually trim — only a trim
    // tick moves `tail` at all, so this only ever animates on the ticks where it needs to.
    tailAnimX.value = withTiming(tail.x, { duration, easing: Easing.linear })
    tailAnimY.value = withTiming(tail.y, { duration, easing: Easing.linear })
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

  const nextCell = trail.length > 1 ? trail[1] : trail[0]
  const nextCenter = cellCenter(nextCell, cellPx)
  const tailEdgeStart = useDerivedValue(() => vec(tailAnimX.value, tailAnimY.value))
  const tailEdgeEnd = vec(nextCenter.x, nextCenter.y)

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

export function GameBoard({ players, phase, tickIntervalMs, cellPx, grid, orientationMode, p1OnRight, tick }: GameBoardProps) {
  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Walls grid={grid} cellPx={cellPx} orientationMode={orientationMode} p1OnRight={p1OnRight} players={players} phase={phase} />
        <PlayerTrail player={players[1]} phase={phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} tick={tick} />
        <PlayerTrail player={players[2]} phase={phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} tick={tick} />
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 }
})
