import { OrientationMode, Player } from '@/types'

export type ZoneSide = 'top' | 'bottom' | 'left' | 'right'

// The single source of truth for the top/bottom (face-to-face) or left/right (side-by-side) split
// independently hand-rolled in GameBoard.tsx's wallPath, TouchInputLayer.tsx's p1ZoneStyle/
// p2ZoneStyle, OnboardingOverlay.tsx's p1Zone/p2Zone, and RoundOverDialog.tsx's p1Zone/p2Zone — all
// four need to agree exactly on which player is where, or the wall, the touch zones, the countdown
// tint, and the result dialog would each draw a different split. grid.ts's own startingStateFor
// computes the analogous "which zone" answer for spawn placement using the identical decision tree.
//
// Face-to-face: player 1 is assumed to be the device's owner, so they always get the near/bottom
// zone; player 2 gets the far/top zone, regardless of p1OnRight (meaningless on this axis).
// Side-by-side (and web's shared layout): whichever player p1OnRight says is currently on the
// right gets the right zone — see useOrientationState for which physical rotation
// direction puts P1 there.
export function zoneSideFor(player: Player, orientationMode: OrientationMode, p1OnRight: boolean): ZoneSide {
  if (orientationMode === 'faceToFace') return player === 2 ? 'top' : 'bottom'
  const onRight = player === 1 ? p1OnRight : !p1OnRight
  return onRight ? 'right' : 'left'
}
