// Shared between AnimatedHeroTitle.tsx and HeroTitleTrails.tsx. Deliberately has zero
// @shopify/react-native-skia import — AnimatedHeroTitle.tsx is loaded eagerly (it's the home
// route), and any *value* import reaching into HeroTitleTrails.tsx from there would drag Skia's
// `Skia` binding (which attaches to global.CanvasKit at module-evaluation time) into that eager
// bundle too, defeating HeroTitleTrailsHost.web.tsx's whole reason for existing. Type-only imports
// of WordBox are fine (erased at compile time); this file exists for the *value*, TRAIL_CANVAS_PAD.

export interface WordBox {
  x: number
  y: number
  width: number
  height: number
}

// Extra canvas margin around the measured word boxes so each trail's glow can bloom past its own
// tight text box without getting clipped by the Skia surface's own edge.
export const TRAIL_CANVAS_PAD = 12

// Breathing room between the letters and their own trail loop, on every side EXCEPT the seam-
// facing one — Light's right edge, Cycles' left edge (see HeroTitleTrails' wordPath). Expanding the
// seam side too would push the two loops toward each other and shrink (or reverse) the near-miss
// gap AnimatedHeroTitle's CYCLES_VERTICAL_OFFSET is tuned for. Lives here (not in HeroTitleTrails.tsx
// itself) so AnimatedHeroTitle.tsx can reference it for that offset's own derivation without an
// eager value-import into the Skia-importing file — see this file's own header comment.
//
// Top is negative, unlike the other three sides: DISPLAY_FONT's glyphs are all-caps-height (no
// ascenders/descenders to speak of), so the line-height box already carries real empty space above
// them even at zero margin — negative pulls the loop's top edge down INTO that inherent gap, since
// even flush-with-the-box (0) still read as too much room above the letters themselves.
export const TRAIL_TEXT_MARGIN_TOP = -2
export const TRAIL_TEXT_MARGIN_BOTTOM = 4
export const TRAIL_TEXT_MARGIN_OUTER = 4
