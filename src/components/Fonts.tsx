import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Orbitron_700Bold, useFonts } from '@expo-google-fonts/orbitron'
import { ReactNode } from 'react'

import { SplashGate } from '@/utils/splashGate'

interface Props {
  children: ReactNode
}

// Holds the splash screen up (see utils/splashGate.ts's 'fonts' gate) until both DISPLAY_FONT and
// the MaterialCommunityIcons glyph font have actually loaded — otherwise the hero title would
// render in its fallback font, and every react-native-paper Icon/IconButton would render blank,
// for one visible frame before snapping in once each async load resolves. Gated via the Gate
// component (SplashGate, per splashGate.ts's own alias) rather than a hand-rolled
// `if (!loaded) return null` — marking the splash gate ready and holding `children` back until then
// happen in one place this way, same as Pong's own reference Fonts.tsx and the modern approach
// _layout.tsx already uses for the 'settings'/'profiles' gates.
export function Fonts({ children }: Props) {
  const [loaded] = useFonts({ Orbitron_700Bold, ...MaterialCommunityIcons.font })
  return (
    <SplashGate gate='fonts' ready={loaded}>
      {children}
    </SplashGate>
  )
}
