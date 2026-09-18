import { getStaggeredWordDuration, StaggeredWord } from '@tastic/hud'
import { useEffect, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'

import { DISPLAY_FONT } from '@/constants/fonts'

import { TRAIL_CANVAS_PAD, TRAIL_TEXT_MARGIN_BOTTOM, TRAIL_TEXT_MARGIN_TOP, WordBox } from './heroTitleGeometry'
import HeroTitleTrailsHost from './HeroTitleTrailsHost'

export interface AnimatedHeroTitleProps {
  color: string
  // The live theme's primary/secondary — whatever the players actually picked (see Theme.tsx),
  // not a fixed pair — so "Light"'s trail always matches player 1's real color and "Cycles"'
  // always matches player 2's, the same way the two mode buttons below already do.
  p1Color: string
  p2Color: string
}

const WORD_LIGHT = 'Light'
const WORD_CYCLES = 'Cycles'
const TOTAL_LETTERS = WORD_LIGHT.length + WORD_CYCLES.length

// Trails start looping the instant they mount (see HeroTitleTrails) but stay hidden behind this
// shared fade until the letters are most of the way settled — one "power on" beat once the wordmark
// has mostly landed, rather than motion competing with letters still flying in.
const TOTAL_STAGGER_MS = getStaggeredWordDuration(TOTAL_LETTERS)
const TRAIL_FADE_DELAY_MS = Math.round(TOTAL_STAGGER_MS * 0.7)
const TRAIL_FADE_DURATION_MS = 280

// "Cycles" sits lower than "Light" and the two words touch with no horizontal gap — a real
// (layout, not transform) offset so onLayout's measured box stays truthful and the trail loops
// actually land where the letters are.
//
// Both words share the same 44px line height, and TRAIL_TEXT_MARGIN_TOP/_BOTTOM (from
// heroTitleGeometry.ts) add themselves to each word's trail loop — with HeroTitleTrails' loop
// corners sharp (no radius, matching the real game's own grid-based trails), each word's straight
// vertical trail edge spans the loop's FULL padded height (44 + TOP + BOTTOM) with nothing carved
// off the ends, so that full height sits dead center on the shared horizontal seam. An offset of
// exactly that padded height makes Light's trail edge and Cycles' trail edge touch at a single
// point (a true kiss, zero gap); px above it is real clearance, px below it is deliberate overlap.
// +1 here leaves the two loops' edges a hairline apart at that point, rather than overlapping —
// combined with HeroTitleTrails' own 3px stroke width this reads as the two strokes passing by
// each other without ever touching: a true near-miss, not the graze a negative value (or a literal
// 0 kiss) produces.
const CYCLES_VERTICAL_OFFSET = 44 + TRAIL_TEXT_MARGIN_TOP + TRAIL_TEXT_MARGIN_BOTTOM + 1

export function AnimatedHeroTitle({ color, p1Color, p2Color }: AnimatedHeroTitleProps) {
  const reducedMotion = useReducedMotion()
  const [lightBox, setLightBox] = useState<WordBox | null>(null)
  const [cyclesBox, setCyclesBox] = useState<WordBox | null>(null)

  const trailOpacity = useSharedValue(reducedMotion ? 1 : 0)
  useEffect(() => {
    if (reducedMotion) return
    trailOpacity.value = withDelay(TRAIL_FADE_DELAY_MS, withTiming(1, { duration: TRAIL_FADE_DURATION_MS }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])
  const trailStyle = useAnimatedStyle(() => ({ opacity: trailOpacity.value }))

  return (
    <View style={styles.wrapper}>
      <View style={styles.row}>
        <StaggeredWord word={WORD_LIGHT} color={color} fontFamily={DISPLAY_FONT} fontSize={36} lineHeight={44} reducedMotion={reducedMotion} startIndex={0} fontWeight='normal' onLayout={(e) => setLightBox(e.nativeEvent.layout)} />
        <StaggeredWord word={WORD_CYCLES} color={color} fontFamily={DISPLAY_FONT} fontSize={36} lineHeight={44} reducedMotion={reducedMotion} startIndex={WORD_LIGHT.length} fontWeight='normal' style={styles.cyclesOffset} onLayout={(e) => setCyclesBox(e.nativeEvent.layout)} />
      </View>

      {lightBox && cyclesBox && (
        <Animated.View pointerEvents='none' style={[styles.canvas, trailStyle]}>
          <HeroTitleTrailsHost lightBox={lightBox} cyclesBox={cyclesBox} p1Color={p1Color} p2Color={p2Color} active={!reducedMotion} startDelayMs={TRAIL_FADE_DELAY_MS} />
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  canvas: {
    bottom: -TRAIL_CANVAS_PAD,
    left: -TRAIL_CANVAS_PAD,
    position: 'absolute',
    right: -TRAIL_CANVAS_PAD,
    top: -TRAIL_CANVAS_PAD
  },
  cyclesOffset: {
    marginTop: CYCLES_VERTICAL_OFFSET
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row'
  },
  wrapper: {}
})
