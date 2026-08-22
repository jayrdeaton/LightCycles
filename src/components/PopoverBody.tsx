import { ReactNode } from 'react'
import { StyleSheet, View, ViewStyle } from 'react-native'

const CARET_SIZE = 7
// How far the fill triangle's base sits past the border triangle's own base, producing the ring of
// caretBorderColor around it — kept fixed regardless of caretBorderWidth; tuned by eye.
const CARET_RING_OFFSET = 2
// How far both triangles dip below the box's own top edge. The caret renders after (on top of) the
// box, so this overlap lets it paint over the box's top border there instead of butting up against
// it — a seam shows if the two edges only touch, since neither is guaranteed to land on the exact
// same subpixel.
const CARET_DIP = 1

interface Props {
  visible: boolean
  children: ReactNode
  // Which edge of the trigger the popover aligns to — 'center' (default) centers the popover
  // under/over its trigger regardless of either one's width; 'left'/'right' instead align that
  // edge flush with the trigger's matching edge, growing away from it. A trigger sitting right at
  // the screen's edge (e.g. the rightmost of a row of icons, or a right-side player's panel) needs
  // an explicit 'left' or 'right' — centering alone can still overflow there — to guarantee which
  // direction it grows.
  align?: 'left' | 'right' | 'center'
  // Small triangle pointing back at the trigger, reinforcing the visual link beyond just position
  // (two triggers can sit close together). Omit both to skip it. caretBorderColor defaults to
  // caretColor (a solid, borderless caret) when only caretColor is given.
  caretColor?: string
  caretBorderColor?: string
  // Must match the popover box's own borderWidth — a fixed ring thickness would only happen to
  // match whichever box first used it, and look like a mismatched outline on any other consumer.
  caretBorderWidth?: number
  // The trigger's own width, in px — required whenever a caret is shown, so the caret can be pinned
  // to the trigger's actual center via a fixed offset rather than the (usually much wider) content
  // box's own midpoint, which only coincides with the trigger's center by coincidence, if at all.
  triggerSize?: number
}

// Rendered inline as an absolutely-positioned sibling of its own trigger (never via Portal), so it
// inherits any rotation transform the trigger's zone applies — a Portal-based popover renders at
// the app root, outside that transform, and would end up upside-down relative to its own trigger
// once the lobby's face-to-face zone gets flipped. Positioned via percentage (`top:'100%'`) against
// the trigger's own wrapper rather than a measured pixel rect, so no onLayout/measurement plumbing
// is needed and it resolves correctly regardless of how deep the trigger sits in the tree.
export function PopoverBody({ visible, children, align = 'center', caretColor, caretBorderColor, caretBorderWidth = 1, triggerSize = 0 }: Props) {
  if (!visible) return null

  const alignStyle = align === 'left' ? styles.contentLeft : align === 'right' ? styles.contentRight : styles.contentCenter
  const ringSize = CARET_SIZE + caretBorderWidth

  // The caret is a width:0 box whose rendered footprint is purely its (symmetric) borders, so
  // pinning its *center* at some offset means placing its own `left`/`right` half a footprint short
  // of that offset. Every align pins one edge of `content` flush with the matching edge of the
  // trigger-sized anchor (contentCenter stretches left:0/right:0 to do this too, rather than
  // centering via a percentage `transform` — those need the child's own auto-resolved width fed
  // back into the transform, which native has been unreliable about; plain flexbox centering
  // doesn't), so triggerSize/2 from that shared edge always lands on the trigger's true center,
  // however much wider the actual popover box grows.
  const caretOffset = (halfFootprint: number): ViewStyle => (align === 'right' ? { right: triggerSize / 2 - halfFootprint } : { left: triggerSize / 2 - halfFootprint })

  return (
    <View style={[styles.content, alignStyle]}>
      {children}
      {/* Painted after (on top of) the box above, dipping into its top edge — see CARET_DIP — so it
      reads as one continuous outline flowing from the trigger into the box, not a separate chip
      butted up against it. */}
      {caretColor && (
        <>
          <View style={[styles.caret, caretOffset(ringSize), { borderBottomColor: caretBorderColor ?? caretColor, borderBottomWidth: ringSize, borderLeftWidth: ringSize, borderRightWidth: ringSize, top: -ringSize + CARET_DIP }]} />
          <View style={[styles.caret, caretOffset(CARET_SIZE), { borderBottomColor: caretColor, borderBottomWidth: CARET_SIZE, borderLeftWidth: CARET_SIZE, borderRightWidth: CARET_SIZE, top: -CARET_SIZE + CARET_RING_OFFSET + CARET_DIP }]} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  caret: {
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    height: 0,
    position: 'absolute',
    width: 0,
    // Explicit, not left to DOM order — the box it dips into is itself a position:'relative' view,
    // which React Native Web always gives an implicit zIndex:0 (see PopoverBody's stacking-context
    // notes elsewhere in this codebase), so painting on top needs a real zIndex to beat that
    // reliably rather than relying on being the later sibling.
    zIndex: 1
  },
  content: {
    marginTop: 8,
    position: 'absolute',
    top: '100%',
    zIndex: 50
  },
  // Stretched to the anchor's own (trigger) width, with alignItems centering the actual (usually
  // much wider) popover box inside via plain flexbox — not `left:'50%'` plus a percentage
  // `transform`, which depends on native resolving the box's own auto width before applying the
  // transform and has proven unreliable there, visibly shifting the box off-center.
  contentCenter: {
    alignItems: 'center',
    left: 0,
    right: 0
  },
  contentLeft: {
    left: 0
  },
  contentRight: {
    right: 0
  }
})
