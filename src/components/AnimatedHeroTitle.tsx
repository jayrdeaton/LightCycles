import { useEffect, useState } from 'react'
import { LayoutChangeEvent, StyleProp, StyleSheet, View, ViewStyle } from 'react-native'
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated'

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

const STAGGER_MS = 45
const LETTER_DURATION_MS = 320
// Trails start looping the instant they mount (see HeroTitleTrails) but stay hidden behind this
// shared fade until the letters are most of the way settled — one "power on" beat once the wordmark
// has mostly landed, rather than motion competing with letters still flying in.
const TOTAL_STAGGER_MS = (TOTAL_LETTERS - 1) * STAGGER_MS + LETTER_DURATION_MS
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

function AnimatedLetter({ char, index, color, reducedMotion }: { char: string; index: number; color: string; reducedMotion: boolean }) {
  const progress = useSharedValue(reducedMotion ? 1 : 0)

  useEffect(() => {
    if (reducedMotion) return
    progress.value = withDelay(index * STAGGER_MS, withTiming(1, { duration: LETTER_DURATION_MS, easing: Easing.out(Easing.back(1.5)) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reducedMotion])

  const style = useAnimatedStyle(() => ({
    opacity: progress.value,
    transform: [{ translateY: (1 - progress.value) * 12 }, { scale: 0.85 + progress.value * 0.15 }]
  }))

  return (
    <Animated.Text allowFontScaling={false} style={[styles.letter, { color }, style]}>
      {char}
    </Animated.Text>
  )
}

function Word({ text, startIndex, color, reducedMotion, style, onMeasured }: { text: string; startIndex: number; color: string; reducedMotion: boolean; style?: StyleProp<ViewStyle>; onMeasured: (box: WordBox) => void }) {
  return (
    <View style={[styles.word, style]} onLayout={(e: LayoutChangeEvent) => onMeasured(e.nativeEvent.layout)}>
      {text.split('').map((char, i) => (
        <AnimatedLetter key={i} char={char} index={startIndex + i} color={color} reducedMotion={reducedMotion} />
      ))}
    </View>
  )
}

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
        <Word text={WORD_LIGHT} startIndex={0} color={color} reducedMotion={reducedMotion} onMeasured={setLightBox} />
        <Word text={WORD_CYCLES} startIndex={WORD_LIGHT.length} color={color} reducedMotion={reducedMotion} style={styles.cyclesOffset} onMeasured={setCyclesBox} />
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
  letter: {
    fontFamily: DISPLAY_FONT,
    fontSize: 36,
    lineHeight: 44
  },
  row: {
    alignItems: 'flex-start',
    flexDirection: 'row'
  },
  word: {
    flexDirection: 'row'
  },
  wrapper: {}
})
