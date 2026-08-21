import { GameBoard, GameBoardProps } from './GameBoard'

// Trivial passthrough on native — Skia's native bindings are ready via JSI before any JS even runs,
// so there's nothing to defer. See GameBoardHost.web.tsx for why web needs an actual wrapper here:
// it's not a symmetry-for-its-own-sake thing, native genuinely doesn't need this.
export default function GameBoardHost(props: GameBoardProps) {
  return <GameBoard {...props} />
}
