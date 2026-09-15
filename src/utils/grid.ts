import { Direction, GridCell, GridSize, OrientationMode, Player } from '@/types'

// Starting head + heading for each player, given the grid and the current orientation mode. Face-
// to-face (portrait, tall grid) starts players top/bottom moving toward each other along the y
// axis; side-by-side (landscape, wide grid — and web, which shares this layout) starts them
// left/right moving toward each other along the x axis. Player 1 is assumed to be the device's
// owner, so in face-to-face they get the "near" bottom zone (the natural portrait orientation
// faces them) while player 2 is the "far" player (top zone, needs the input flip — see
// utils/turnIntent.ts). In side-by-side, `p1OnRight` decides which zone is player 1's — see
// useOrientationState — so a player's actual starting cycle always lands in the same zone
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
