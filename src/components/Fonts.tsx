import { MaterialCommunityIcons } from '@expo/vector-icons'
import { Orbitron_700Bold, useFonts } from '@expo-google-fonts/orbitron'
import { ReactNode } from 'react'

import { useSplashReady } from '@/utils/splashGate'

interface Props {
  children: ReactNode
}

// Holds the splash screen up (see utils/splashGate.ts's 'fonts' gate) until both DISPLAY_FONT and
// the MaterialCommunityIcons glyph font have actually loaded — otherwise the hero title would
// render in its fallback font, and every react-native-paper Icon/IconButton would render blank,
// for one visible frame before snapping in once each async load resolves.
export function Fonts({ children }: Props) {
  const [loaded] = useFonts({ Orbitron_700Bold, ...MaterialCommunityIcons.font })
  useSplashReady('fonts', loaded)
  return <>{children}</>
}
