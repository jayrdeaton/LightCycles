import { useVibration } from '@rific/feedback-press'
import { useEffect, useMemo } from 'react'

import { useGameSound } from '@/hooks/useGameSound'
import { Direction, KeyScheme, OrientationMode, Player } from '@/types'
import { resolveTurnIntent } from '@/utils/turnIntent'

export interface TouchInputLayerProps {
  orientationMode: OrientationMode
  // See TouchInputLayer.tsx — [1] or [2] for vs-CPU disables the other player's key mapping
  // entirely, so a stray arrow-key press can't fight the CPU's own queued turn (see cpuAi.ts).
  humanPlayers: Player[]
  enabled: boolean
  onTurn: (player: Player, direction: Direction) => void
  keyScheme: Record<Player, KeyScheme>
}

// One physical-key set per scheme (see the lobby's keyboard-scheme picker) — player 1 and player 2
// can independently pick any scheme, so the actual key -> player map below is built per-mount
// rather than hardcoded to one fixed WASD/Arrows split.
const KEY_SCHEME_KEYS: Record<KeyScheme, { up: string; down: string; left: string; right: string }> = {
  wasd: { up: 'w', down: 's', left: 'a', right: 'd' },
  arrows: { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright' },
  ijkl: { up: 'i', down: 'k', left: 'j', right: 'l' }
}

interface TrackedPointer {
  player: Player
  startX: number
  startY: number
}

export default function TouchInputLayer({ orientationMode, humanPlayers, enabled, onTurn, keyScheme }: TouchInputLayerProps) {
  // Synthetic translation vectors, one per key, fed through the same resolveTurnIntent() every
  // other input source uses (see TouchInputLayer.tsx) rather than a separate key -> Direction
  // table — one axis/direction mapping to get right and keep tested, not two.
  const keyMap = useMemo(() => {
    const map: Record<string, { player: Player; translationX: number; translationY: number }> = {}
    for (const player of [1, 2] as Player[]) {
      const keys = KEY_SCHEME_KEYS[keyScheme[player]]
      map[keys.up] = { player, translationX: 0, translationY: -100 }
      map[keys.down] = { player, translationX: 0, translationY: 100 }
      map[keys.left] = { player, translationX: -100, translationY: 0 }
      map[keys.right] = { player, translationX: 100, translationY: 0 }
    }
    return map
  }, [keyScheme])

  const playTurn = useGameSound(require('../../assets/sounds/turn.wav'), { poolSize: 8 })
  const { selection } = useVibration()

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const mapped = keyMap[e.key.toLowerCase()]
      if (!mapped || !humanPlayers.includes(mapped.player)) return
      e.preventDefault()
      const direction = resolveTurnIntent({ player: mapped.player, translationX: mapped.translationX, translationY: mapped.translationY, orientationMode })
      if (direction) {
        onTurn(mapped.player, direction)
        playTurn()
        selection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, humanPlayers, onTurn, keyMap, orientationMode, playTurn, selection])

  // Swipe input, mirroring TouchInputLayer.tsx's Pan gestures but via raw window pointer events —
  // react-native-gesture-handler has no bearing here (RNGH ships no web target this app pulls in),
  // and this component has no view tree of its own to hang a GestureDetector off (same reason the
  // keyboard listener above binds to the window object rather than an element). Each pointer is
  // tracked independently by id from down to up so two simultaneous touches — one per half of the
  // screen — resolve to two independent turns, the same "classify by start coordinate, not
  // continuous tracking" rule the native file applies via hitSlop zones. Solo (vs-CPU) skips the
  // split entirely, same as the native file's solo branch. humanPlayers.length !== 1 only ever
  // means both players are human (see gameParams.ts's humanPlayersFor), so the split never needs
  // to check which of 1/2 is actually present. The split axis follows orientationMode, same as the
  // native file and OnboardingOverlay's own zone visualization (top/bottom for face-to-face,
  // left/right for side-by-side) — unlike the keyboard listener above, this one tracks real
  // on-screen touch position, so it needs to agree with what the onboarding overlay showed the
  // player. Splits on window.innerWidth/innerHeight rather than the board's own measured size —
  // safe only because this app's web build has no `viewport-fit=cover` meta tag, so
  // `env(safe-area-inset-*)` (and therefore game.tsx's boardArea insets) is always 0 here; if that
  // ever changes, the window midpoint and the board's real midpoint could drift apart.
  useEffect(() => {
    if (!enabled) return

    const pointers = new Map<number, TrackedPointer>()
    const isFaceToFace = orientationMode === 'faceToFace'

    const resolvePlayer = (x: number, y: number): Player => {
      if (humanPlayers.length === 1) return humanPlayers[0]
      // Face-to-face: top/bottom split, player 1 = near/bottom, player 2 = far/top — matches
      // TouchInputLayer.tsx's hitSlop halves. Side-by-side: left/right, player 1 = left.
      if (isFaceToFace) return y < window.innerHeight / 2 ? 2 : 1
      return x < window.innerWidth / 2 ? 1 : 2
    }

    const handlePointerDown = (e: PointerEvent) => {
      const player = resolvePlayer(e.clientX, e.clientY)
      // One active touch per player at a time, same as the native file's Pan.maxPointers(1) — a
      // second finger landing in a player's own zone while their first is still down is ignored
      // rather than tracked as an independent gesture.
      for (const existing of pointers.values()) {
        if (existing.player === player) return
      }
      pointers.set(e.pointerId, { player, startX: e.clientX, startY: e.clientY })
    }

    const handlePointerUp = (e: PointerEvent) => {
      const tracked = pointers.get(e.pointerId)
      pointers.delete(e.pointerId)
      if (!tracked) return
      const direction = resolveTurnIntent({ player: tracked.player, translationX: e.clientX - tracked.startX, translationY: e.clientY - tracked.startY, orientationMode })
      if (direction) {
        onTurn(tracked.player, direction)
        playTurn()
        selection()
      }
    }

    const handlePointerCancel = (e: PointerEvent) => {
      pointers.delete(e.pointerId)
    }

    // Suppresses the browser's own touch gestures (scroll, pull-to-refresh, Chrome's overscroll
    // swipe-to-navigate) for as long as this layer is live, so a vertical or edge-adjacent swipe
    // reaches us as a turn instead of being eaten by the page. Best-effort only: iOS Safari's and
    // Android's own OS-level edge-swipe-back gestures sit above the DOM event pipeline and aren't
    // guaranteed to be suppressed by either property, which matters here since side-by-side mode
    // puts player 1's zone against the left screen edge and player 2's against the right.
    const previousTouchAction = document.body.style.touchAction
    const previousOverscrollBehaviorX = document.body.style.overscrollBehaviorX
    document.body.style.touchAction = 'none'
    document.body.style.overscrollBehaviorX = 'none'

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      document.body.style.touchAction = previousTouchAction
      document.body.style.overscrollBehaviorX = previousOverscrollBehaviorX
    }
  }, [enabled, humanPlayers, onTurn, orientationMode, playTurn, selection])

  return null
}
