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
function wallPath(grid: GridSize, cellPx: number, orientationMode: OrientationMode, player: Player) {
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

  // Side-by-side (and web's shared layout): player 1 is the left zone, player 2 the right zone.
  const midX = width / 2
  if (player === 1) {
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

function Walls({ grid, cellPx, orientationMode, players, phase }: { grid: GridSize; cellPx: number; orientationMode: OrientationMode; players: Record<Player, PlayerState>; phase: GamePhase }) {
  const p1Path = useMemo(() => wallPath(grid, cellPx, orientationMode, 1), [grid, cellPx, orientationMode])
  const p2Path = useMemo(() => wallPath(grid, cellPx, orientationMode, 2), [grid, cellPx, orientationMode])

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

function PlayerTrail({ player, phase, tickIntervalMs, cellPx }: { player: PlayerState; phase: GamePhase; tickIntervalMs: number; cellPx: number }) {
  // Nearly fill their own cell on purpose — combined with a small cellPx (see constants/game.ts's
  // GRID_CELL_PX), this makes the actual hit-detection boundary obvious at a glance: a trail or head
  // reads as occupying essentially the whole cell it's in, so a one-cell gap between two trails
  // looks (and is) a real, precise near-miss rather than a vague blob-to-blob distance.
  const trailWidth = cellPx * 0.85
  const headRadius = cellPx * 0.475 // 95% diameter

  const trail = player.trail
  const head = cellCenter(trail[trail.length - 1], cellPx)

  // The game state advances in discrete grid steps (see gameEngine.ts) — snapping straight to
  // each new cell every tick is what read as "choppy" at a tick rate well under the screen's own
  // refresh rate. Animating the head (and the trail's last segment, which follows it) smoothly
  // between cells over the tick's own duration decouples how it looks from how often the
  // simulation actually steps, without touching the underlying grid logic at all.
  const animX = useSharedValue(head.x)
  const animY = useSharedValue(head.y)
  const mountedRef = useRef(false)

  useEffect(() => {
    if (!mountedRef.current) {
      // First paint (or a fresh round via GameRound's key remount) — jump straight to the
      // starting cell instead of animating in from wherever the shared value defaulted to.
      mountedRef.current = true
      animX.value = head.x
      animY.value = head.y
      return
    }
    animX.value = withTiming(head.x, { duration: tickIntervalMs, easing: Easing.linear })
    animY.value = withTiming(head.y, { duration: tickIntervalMs, easing: Easing.linear })
    // Only the trail actually growing should retrigger this — tickIntervalMs changing mid-glide
    // (speed ramp) should finish the current glide at its original pace, not restart it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trail.length])

  // Every settled cell except the current head, which is instead tracked live by (animX, animY)
  // below so the last segment glides into place rather than snapping.
  const settledPath = useMemo(() => trailPath(trail.slice(0, -1), cellPx), [trail, cellPx])
  const fullPath = useMemo(() => trailPath(trail, cellPx), [trail, cellPx])

  const prevCell = trail.length > 1 ? trail[trail.length - 2] : trail[trail.length - 1]
  const prevCenter = cellCenter(prevCell, cellPx)
  const edgeStart = vec(prevCenter.x, prevCenter.y)
  const edgeEnd = useDerivedValue(() => vec(animX.value, animY.value))

  const dimmed = phase === 'roundOver' && !player.alive

  return (
    <>
      {player.alive ? (
        <>
          <Path path={settledPath} style='stroke' strokeWidth={trailWidth} strokeCap='round' strokeJoin='round' color={player.color} />
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

export function GameBoard({ players, phase, tickIntervalMs, cellPx, grid, orientationMode }: GameBoardProps) {
  return (
    <View style={styles.container}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Walls grid={grid} cellPx={cellPx} orientationMode={orientationMode} players={players} phase={phase} />
        <PlayerTrail player={players[1]} phase={phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} />
        <PlayerTrail player={players[2]} phase={phase} tickIntervalMs={tickIntervalMs} cellPx={cellPx} />
      </Canvas>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 }
})
