import { loadSkiaWeb } from '@tastic/hud'
import { lazy, Suspense } from 'react'

import { HeroTitleTrailsProps } from './HeroTitleTrails'

// Same reasoning as GameBoardHost.web.tsx: HeroTitleTrails.tsx's `Skia` import binds to
// global.CanvasKit at module-evaluation time, so it can only be imported after loadSkiaWeb()
// resolves. This is the home route, so it's the first screen that ever needs canvaskit.wasm —
// the RN text/letters in AnimatedHeroTitle render and stagger in immediately regardless, and this
// trail canvas just pops in a beat later once the wasm resolves (loadSkiaWeb is idempotent, so by
// the time /game mounts its own GameBoardHost, CanvasKit is very likely already warm).
const LazyHeroTitleTrails = lazy(() => loadSkiaWeb().then(() => import('./HeroTitleTrails').then((m) => ({ default: m.HeroTitleTrails }))))

export default function HeroTitleTrailsHost(props: HeroTitleTrailsProps) {
  return (
    <Suspense fallback={null}>
      <LazyHeroTitleTrails {...props} />
    </Suspense>
  )
}
