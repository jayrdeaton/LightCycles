import { Direction, GridCell, GridSize, OrientationMode, Player } from '@/types'

export const ALL_DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

export function computeGridSize(width: number, height: number, cellPx: number): GridSize {
  return {
    cols: Math.max(1, Math.floor(width / cellPx)),
    rows: Math.max(1, Math.floor(height / cellPx))
  }
}

export function cellToPixel(cell: GridCell, cellPx: number) {
  return { x: cell.x * cellPx, y: cell.y * cellPx }
}

export function cellKey(cell: GridCell): string {
  return `${cell.x},${cell.y}`
}

export function isInBounds(cell: GridCell, grid: GridSize): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < grid.cols && cell.y < grid.rows
}

// Re-enters an off-grid cell from the opposite edge — wrap-mode's counterpart to isInBounds above
// (see gameEngine.ts's tickGame, which checks isInBounds first and only wraps a cell that's
// already failed it). The double-mod handles a negative coordinate (stepping off the top/left)
// correctly, since JS's % can return a negative result that a single mod wouldn't clean up.
export function wrapCell(cell: GridCell, grid: GridSize): GridCell {
  return { x: ((cell.x % grid.cols) + grid.cols) % grid.cols, y: ((cell.y % grid.rows) + grid.rows) % grid.rows }
}

export function stepCell(cell: GridCell, direction: Direction): GridCell {
  switch (direction) {
    case 'up':
      return { x: cell.x, y: cell.y - 1 }
    case 'down':
      return { x: cell.x, y: cell.y + 1 }
    case 'left':
      return { x: cell.x - 1, y: cell.y }
    case 'right':
      return { x: cell.x + 1, y: cell.y }
  }
}

export function isOppositeDirection(a: Direction, b: Direction): boolean {
  return (a === 'up' && b === 'down') || (a === 'down' && b === 'up') || (a === 'left' && b === 'right') || (a === 'right' && b === 'left')
}

// True when `b` is exactly one step from `a` — the only distance stepCell itself can ever produce.
// The sole source of truth GameBoard.tsx's trail rendering uses to tell an ordinary step apart from
// a portal jump (see gameEngine.ts's tickGame, which is the only place a trail's newest cell can
// ever land non-adjacent to the one before it): every consecutive trail pair is adjacent except
// exactly the cell immediately after a portal crossing. Relies on the portal placement generator
// (see arenas.ts's PORTAL_MIN_PAIR_DISTANCE_CELLS) keeping a pair's two cells well past distance 1,
// so this check can never mistake a portal's own entrance/exit for a normal step.
export function isAdjacent(a: GridCell, b: GridCell): boolean {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y) === 1
}

// Starting head + heading for each player, given the grid and the current orientation mode. Face-
// to-face (portrait, tall grid) starts players top/bottom moving toward each other along the y
// axis; side-by-side (landscape, wide grid — and web, which shares this layout) starts them
// left/right moving toward each other along the x axis. Player 1 is assumed to be the device's
// owner, so in face-to-face they get the "near" bottom zone (the natural portrait orientation
// faces them) while player 2 is the "far" player (top zone, needs the input flip — see
// utils/turnIntent.ts). In side-by-side, `p1OnRight` decides which zone is player 1's — see
// useAccelerometerOrientation — so a player's actual starting cycle always lands in the same zone
// GameBoard.tsx's wallPath and TouchInputLayer.tsx's hit zone are drawn for, rather than a side
// that's fixed regardless of which way the device was rotated.
//
// Each player starts at the dead center of their own half of the board (their "zone" — see
// GameBoard.tsx/TouchInputLayer.tsx's identical split) rather than hugging the outer wall. That
// keeps the two players closer together at the start and leaves a full quarter-board of room
// behind each of them to maneuver into.
export function startingStateFor(player: Player, grid: GridSize, mode: OrientationMode, p1OnRight: boolean): { head: GridCell; direction: Direction } {
  const axisLength = mode === 'faceToFace' ? grid.rows : grid.cols
  const firstHalfLength = Math.floor(axisLength / 2)
  // Center of the [0, firstHalfLength) zone and center of the [firstHalfLength, axisLength) zone.
  const firstZoneCenter = Math.floor(firstHalfLength / 2)
  const secondZoneCenter = firstHalfLength + Math.floor((axisLength - firstHalfLength) / 2)

  if (mode === 'faceToFace') {
    const x = Math.floor(grid.cols / 2)
    return player === 2 ? { head: { x, y: firstZoneCenter }, direction: 'down' } : { head: { x, y: secondZoneCenter }, direction: 'up' }
  }

  const y = Math.floor(grid.rows / 2)
  const onRight = player === 1 ? p1OnRight : !p1OnRight
  return onRight ? { head: { x: secondZoneCenter, y }, direction: 'left' } : { head: { x: firstZoneCenter, y }, direction: 'right' }
}
