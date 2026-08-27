import { PopoverVerticalAlign, useAutoAlign } from '@tastic/hud'
import { useZoneBounds } from '@tastic/split-screen'
import { useEffect, useState } from 'react'
import { useWindowDimensions } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

// Matches @tastic/hud's useAutoAlign own EDGE_MARGIN convention.
const EDGE_MARGIN = 12

interface OwnBounds {
  verticalAlign: PopoverVerticalAlign
  maxHeight: number
}

// Wraps @tastic/hud's useAutoAlign with a zone-aware vertical decision for popovers that live
// inside a @tastic/split-screen zone (see useZoneBounds' own doc) — a no-op outside one (e.g.
// vsCPU's solo screen), where useAutoAlign's own decision is returned untouched.
//
// useAutoAlign picks above-vs-below and its own maxHeight by comparing room against the *full
// device window* — for a trigger inside a zone, that's wrong in a way a simple clamp on top can't
// fix: capping its chosen direction after the fact still leaves it capable of *choosing* the
// direction that points into the shared row (or the opposite player's own zone), which, once
// correctly capped at that boundary, often has hardly any room at all — nearly useless rather than
// merely mis-sized. The fix has to re-derive the whole vertical decision using the zone's real
// boundary instead of the window edge, preferring whichever real-world direction is actually safe
// (away from the shared row — that direction's room really is bounded by the screen edge, same as
// useAutoAlign already assumes) and only reaching toward the shared row when the content doesn't
// fit the safe side and the shared side genuinely has more room — the same "only flips when
// genuinely better" bias useAutoAlign itself uses, just comparing against the zone's own boundary
// instead of the opposite screen edge.
//
// One more twist specific to p2's 180°-rotated zone: @tastic/hud's PopoverBody positions itself
// with plain relative CSS (`top:'100%'`/`bottom:'100%'`) against its trigger, resolved in *local*
// (pre-rotation) space and then rotated along with everything else in the zone — which inverts it,
// local 'below' the trigger paints as real-world *above* it once the whole zone flips 180°, and
// vice versa. This hook's own direction math above is all real-world (from measureInWindow, which
// — unlike onLayout — already resolves post-transform), so its result has to be flipped back to
// the *local* label PopoverBody expects whenever the zone itself is rotated (zone.rotated), or it
// ends up choosing the real-world direction it meant to avoid — which is exactly the bug an
// earlier version of this hook had for p2 specifically (it worked correctly for p1, which isn't
// rotated, and that's what made the bug easy to miss during testing).
//
// The "away" direction's own room also has to stop at the physical safe area, not the raw window
// edge — useAutoAlign's own windowHeight is the full device height, notch/status bar and home
// indicator included, so left alone this hook's fix for the shared-row boundary would just trade
// one overflow (into the other zone) for another (under the status bar, or behind the home
// indicator). The toward-shared direction doesn't need this: sharedEdgeY already sits well inside
// the safe content area on its own.
export function useZoneClampedAlign(open: boolean, contentWidth: number, contentHeight: number): ReturnType<typeof useAutoAlign> {
  const auto = useAutoAlign(open, contentWidth, contentHeight)
  const zone = useZoneBounds()
  const { height: windowHeight } = useWindowDimensions()
  const insets = useSafeAreaInsets()
  const shouldMeasure = open && auto.measured && zone !== null

  // null until this popover's own zone-aware measurement lands (see the effect below) — separate
  // from auto.measured, which only covers useAutoAlign's own (zone-blind) measurement.
  const [ownBounds, setOwnBounds] = useState<OwnBounds | null>(null)
  // Resets synchronously during render, not in the effect below, the instant shouldMeasure flips
  // either direction — same "adjust state during render" pattern useAutoAlign itself uses for its
  // own measured reset (see that hook's own comment), so a stale ownBounds from a previous
  // open/zone never survives into a render it doesn't apply to, not even for the one frame before
  // an effect would otherwise catch up.
  const [prevShouldMeasure, setPrevShouldMeasure] = useState(shouldMeasure)
  if (shouldMeasure !== prevShouldMeasure) {
    setPrevShouldMeasure(shouldMeasure)
    setOwnBounds(null)
  }

  // Re-measures the same trigger node useAutoAlign itself measures, once *its* measurement has
  // landed (auto.measured, folded into shouldMeasure) so the ref is guaranteed mounted and settled.
  // A second measureInWindow call on the same node, not a shared one with useAutoAlign — that
  // hook's own measurement is fully internal to it, with nothing exposed to piggyback on beyond the
  // ref itself.
  useEffect(() => {
    if (!shouldMeasure) return
    auto.triggerRef.current?.measureInWindow((_x, y, _width, height) => {
      const belowShared = zone!.zoneSide === 'belowShared'
      // Same shape as useAutoAlign's own roomBelow/roomAbove — this is the direction with nothing
      // else between the popover and the real screen edge — but stopping at the safe area inset
      // instead of the raw window edge (insets.top/insets.bottom are always real physical-device
      // edges, unaffected by any rotation applied further down the tree, so this is correct as-is
      // for p2's rotated zone too, not just p1's).
      const awayRoom = belowShared ? windowHeight - insets.bottom - (y + height) - EDGE_MARGIN : y - insets.top - EDGE_MARGIN
      // The other direction runs into the shared row instead of the screen edge.
      const towardRoom = belowShared ? y - zone!.sharedEdgeY - EDGE_MARGIN : zone!.sharedEdgeY - (y + height) - EDGE_MARGIN
      const useToward = contentHeight > awayRoom && towardRoom > awayRoom
      // Real-world direction, before any rotation compensation.
      let awaySide: PopoverVerticalAlign = belowShared ? 'below' : 'above'
      let towardSide: PopoverVerticalAlign = belowShared ? 'above' : 'below'
      // See this hook's own doc — PopoverBody's local-then-rotate positioning inverts 'above'/
      // 'below' for a rotated zone, so the real-world label chosen above has to flip back to the
      // local one that actually produces it once painted.
      if (zone!.rotated) {
        awaySide = awaySide === 'above' ? 'below' : 'above'
        towardSide = towardSide === 'above' ? 'below' : 'above'
      }
      setOwnBounds({ maxHeight: Math.max(useToward ? towardRoom : awayRoom, 0), verticalAlign: useToward ? towardSide : awaySide })
    })
  }, [shouldMeasure, zone, auto.triggerRef, contentHeight, windowHeight, insets.top, insets.bottom])

  if (!zone) return auto
  if (!ownBounds) return { ...auto, measured: false }
  return { ...auto, maxHeight: ownBounds.maxHeight, measured: auto.measured, verticalAlign: ownBounds.verticalAlign }
}
