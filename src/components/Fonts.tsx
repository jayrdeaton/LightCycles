import { Orbitron_700Bold, useFonts } from '@expo-google-fonts/orbitron'
import { ReactNode } from 'react'

import { useSplashReady } from '@/utils/splashGate'

interface Props {
  children: ReactNode
}

// Holds the splash screen up (see utils/splashGate.ts's 'fonts' gate) until DISPLAY_FONT has
// actually loaded — otherwise the hero title would render in its fallback font for one visible
// frame before snapping to Orbitron once the async load resolves.
export function Fonts({ children }: Props) {
  const [loaded] = useFonts({ Orbitron_700Bold })
  useSplashReady('fonts', loaded)
  return <>{children}</>
}
