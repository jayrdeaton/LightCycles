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
//
// Each player starts at the dead center of their own half of the board (their "zone" — see
// GameBoard.tsx/TouchInputLayer.tsx's identical split) rather than hugging the outer wall. That
// keeps the two players closer together at the start and leaves a full quarter-board of room
// behind each of them to maneuver into.
export function startingStateFor(player: Player, grid: GridSize, mode: OrientationMode): { head: GridCell; direction: Direction } {
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
  return player === 1 ? { head: { x: firstZoneCenter, y }, direction: 'right' } : { head: { x: secondZoneCenter, y }, direction: 'left' }
}
