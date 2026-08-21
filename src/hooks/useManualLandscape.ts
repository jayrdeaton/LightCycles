import { useWindowDimensions } from 'react-native'
import { EdgeInsets, useSafeAreaInsets } from 'react-native-safe-area-context'

export interface ManualLandscape {
  // Swapped window dimensions — the size the rotated content should actually lay out at, matching
  // what the OS would have reported had it genuinely rotated to landscape.
  width: number
  height: number
  // Safe-area insets remapped into the rotated frame — see rotatedContainerStyle below for why a
  // straight top/bottom/left/right copy from useSafeAreaInsets() would be wrong here.
  insets: EdgeInsets
  // Wraps portrait-shaped content into a landscape-shaped, screen-filling box: sized to the
  // swapped dimensions, centered over the real (portrait) window, then rotated 90° so it exactly
  // covers the physical screen again — same trick as rotating a photo to fit a frame it doesn't
  // match. Centering (rather than rotating in place) is what keeps the box's own center pinned to
  // the screen's center through the rotation, which is what makes the post-rotation footprint land
  // exactly on the physical screen bounds instead of off to one side.
  rotatedContainerStyle: {
    position: 'absolute'
    width: number
    height: number
    top: number
    left: number
    transform: [{ rotate: string }]
  }
}

// Fakes a landscape layout by rotating a view 90° rather than asking the OS to actually rotate the
// screen — see game.tsx's useOrientationLock call, which keeps native orientation portrait-only on
// purpose. A `rotate: '90deg'` transform is clockwise, which — walking each pre-rotation edge to
// where it physically lands — puts the portrait screen's top edge (status bar / notch) at the
// rotated frame's left, its right edge at the top, its bottom edge (home indicator) at the right,
// and its left edge at the bottom. useSafeAreaInsets() only ever reports insets for the physical
// (portrait) orientation, so those four values have to be walked through that same mapping before
// they mean anything as top/right/bottom/left within the rotated frame.
export function useManualLandscape(): ManualLandscape {
  const { width, height } = useWindowDimensions()
  const portraitInsets = useSafeAreaInsets()

  const insets: EdgeInsets = {
    top: portraitInsets.right,
    right: portraitInsets.bottom,
    bottom: portraitInsets.left,
    left: portraitInsets.top
  }

  return {
    width: height,
    height: width,
    insets,
    rotatedContainerStyle: {
      position: 'absolute',
      width: height,
      height: width,
      top: (height - width) / 2,
      left: (width - height) / 2,
      transform: [{ rotate: '90deg' }]
    }
  }
}
