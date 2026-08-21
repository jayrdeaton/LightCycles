import { START_MARGIN_CELLS } from '@/constants/game'
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

// Starting head + heading for each player, given the grid and the current orientation mode. Face-
// to-face (portrait, tall grid) starts players top/bottom moving toward each other along the y
// axis; side-by-side (landscape, wide grid — and web, which shares this layout) starts them
// left/right moving toward each other along the x axis. Player 1 is assumed to be the device's
// owner, so in face-to-face they get the "near" bottom zone (the natural portrait orientation
// faces them) while player 2 is the "far" player (top zone, needs the input flip — see
// utils/turnIntent.ts); in side-by-side/web, player 1 is the "left" player.
export function startingStateFor(player: Player, grid: GridSize, mode: OrientationMode): { head: GridCell; direction: Direction } {
  // Clamped at 0 — on a degenerate ≤2-cell-wide/tall board (an extreme layout state; not a normal
  // device size) the unclamped math goes negative, placing a head off-grid before the round even
  // starts.
  const margin = Math.max(0, Math.min(START_MARGIN_CELLS, Math.floor((mode === 'faceToFace' ? grid.rows : grid.cols) / 2) - 1))

  if (mode === 'faceToFace') {
    const x = Math.floor(grid.cols / 2)
    return player === 2 ? { head: { x, y: margin }, direction: 'down' } : { head: { x, y: grid.rows - 1 - margin }, direction: 'up' }
  }

  const y = Math.floor(grid.rows / 2)
  return player === 1 ? { head: { x: margin, y }, direction: 'right' } : { head: { x: grid.cols - 1 - margin, y }, direction: 'left' }
}
