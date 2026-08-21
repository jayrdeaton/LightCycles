import { lazy, Suspense } from 'react'

import { loadSkiaWeb } from '@/utils/loadSkiaWeb'

import { GameBoardProps } from './GameBoard'

// Skia's web target renders through CanvasKit, a WASM build of Skia — and GameBoard.tsx's own
// `Skia` import binds to `global.CanvasKit` once, synchronously, at MODULE-EVALUATION time (see
// @shopify/react-native-skia's Skia.web.ts: `export const Skia = JsiSkApi(global.CanvasKit)`) — not
// lazily, and not reactively. A plain `import GameBoard from './GameBoard'` here would already have
// evaluated that binding (against a not-yet-loaded, undefined CanvasKit) before ANY component in the
// app renders at all, since Metro evaluates the whole static import graph up front. A dynamic import
// is the one thing that actually defers module evaluation to runtime, so this only imports
// GameBoard.tsx (and therefore @shopify/react-native-skia) AFTER loadSkiaWeb() has resolved and set
// global.CanvasKit for real.
const LazyGameBoard = lazy(() => loadSkiaWeb().then(() => import('./GameBoard').then((m) => ({ default: m.GameBoard }))))

export default function GameBoardHost(props: GameBoardProps) {
  return (
    <Suspense fallback={null}>
      <LazyGameBoard {...props} />
    </Suspense>
  )
}
