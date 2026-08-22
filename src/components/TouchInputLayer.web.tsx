import { useVibration } from '@rific/feedback-press'
import { useEffect, useMemo } from 'react'

import { useGameSound } from '@/hooks/useGameSound'
import { Direction, KeyScheme, OrientationMode, Player } from '@/types'
import { applyControlInversion, resolveTurnIntent } from '@/utils/turnIntent'

export interface TouchInputLayerProps {
  orientationMode: OrientationMode
  // See TouchInputLayer.tsx — [1] or [2] for vs-CPU disables the other player's key mapping
  // entirely, so a stray arrow-key press can't fight the CPU's own queued turn (see cpuAi.ts).
  humanPlayers: Player[]
  enabled: boolean
  onTurn: (player: Player, direction: Direction) => void
  // Fires the player's held powerup — see handlePointerUp/handleKeyDown below for how a tap/the
  // activate key is told apart from a drag-to-steer/directional key.
  onActivate: (player: Player) => void
  controlInverted: Record<Player, boolean>
  keyScheme: Record<Player, KeyScheme>
}

// One physical-key set per scheme (see the lobby's keyboard-scheme picker) — player 1 and player 2
// can independently pick any scheme, so the actual key -> player map below is built per-mount
// rather than hardcoded to one fixed WASD/Arrows split. `activate` is a 4th, adjacency-based
// binding per scheme (thumb-reachable from wasd, centrally reachable from arrows, adjacent to
// ijkl's own cluster) — distinct across all three so two local players sharing one keyboard never
// collide, even if both happen to pick the same scheme.
const KEY_SCHEME_KEYS: Record<KeyScheme, { up: string; down: string; left: string; right: string; activate: string }> = {
  wasd: { up: 'w', down: 's', left: 'a', right: 'd', activate: 'q' },
  arrows: { up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', activate: ' ' },
  ijkl: { up: 'i', down: 'k', left: 'j', right: 'l', activate: 'u' }
}

interface TrackedPointer {
  player: Player
  // Origin of the *current* segment (reset after each recognized swipe — see handlePointerMove)
  // so a player can chain several turns within one continuous pointer-down, mirroring the native
  // file's onUpdate-driven baseline reset.
  baseX: number
  baseY: number
  lastDirection: Direction | null
}

export default function TouchInputLayer({ orientationMode, humanPlayers, enabled, onTurn, onActivate, controlInverted, keyScheme }: TouchInputLayerProps) {
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

  // A separate, single-purpose map (rather than folding into keyMap above) since an activate key
  // has no translation vector of its own — it maps straight to a player, not a direction.
  const activateKeyMap = useMemo(() => {
    const map: Record<string, Player> = {}
    for (const player of [1, 2] as Player[]) map[KEY_SCHEME_KEYS[keyScheme[player]].activate] = player
    return map
  }, [keyScheme])

  const playTurn = useGameSound(require('../../assets/sounds/turn.wav'), { poolSize: 8 })
  const playActivate = useGameSound(require('../../assets/sounds/select.wav'), { poolSize: 4 })
  const { selection } = useVibration()

  useEffect(() => {
    if (!enabled) return

    const handleKeyDown = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase()
      const activatePlayer = activateKeyMap[key]
      if (activatePlayer !== undefined && humanPlayers.includes(activatePlayer)) {
        e.preventDefault()
        onActivate(activatePlayer)
        playActivate()
        selection()
        return
      }

      const mapped = keyMap[key]
      if (!mapped || !humanPlayers.includes(mapped.player)) return
      e.preventDefault()
      const direction = resolveTurnIntent({ player: mapped.player, translationX: mapped.translationX, translationY: mapped.translationY, orientationMode })
      if (direction) {
        onTurn(mapped.player, applyControlInversion(direction, controlInverted[mapped.player]))
        playTurn()
        selection()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [enabled, humanPlayers, onTurn, onActivate, controlInverted, keyMap, activateKeyMap, orientationMode, playTurn, playActivate, selection])

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
      pointers.set(e.pointerId, { player, baseX: e.clientX, baseY: e.clientY, lastDirection: null })
    }

    // Resolves a turn continuously as the pointer moves (mirrors the native file's onUpdate)
    // instead of only at pointerup, so a player can chain several turns within one continuous
    // pointer-down without lifting. Firing is gated on the direction actually changing from the
    // last one recognized for this pointer, so holding a straight line doesn't repeat the same
    // turn every MIN_SWIPE_DISTANCE px of movement.
    const handlePointerMove = (e: PointerEvent) => {
      const tracked = pointers.get(e.pointerId)
      if (!tracked) return
      const direction = resolveTurnIntent({ player: tracked.player, translationX: e.clientX - tracked.baseX, translationY: e.clientY - tracked.baseY, orientationMode })
      if (!direction) return
      tracked.baseX = e.clientX
      tracked.baseY = e.clientY
      if (direction !== tracked.lastDirection) {
        tracked.lastDirection = direction
        onTurn(tracked.player, applyControlInversion(direction, controlInverted[tracked.player]))
        playTurn()
        selection()
      }
    }

    // A pointer that never resolved a direction (see handlePointerMove) never moved past
    // MIN_SWIPE_DISTANCE from where it went down — today, that's a complete no-op; here, it's the
    // free gesture space a tap-to-activate uses. Mirrors the native file's identical onEnd check.
    const handlePointerUp = (e: PointerEvent) => {
      const tracked = pointers.get(e.pointerId)
      if (tracked && tracked.lastDirection === null) {
        onActivate(tracked.player)
        playActivate()
        selection()
      }
      pointers.delete(e.pointerId)
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
    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', handlePointerCancel)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', handlePointerCancel)
      document.body.style.touchAction = previousTouchAction
      document.body.style.overscrollBehaviorX = previousOverscrollBehaviorX
    }
  }, [enabled, humanPlayers, onTurn, onActivate, controlInverted, orientationMode, playTurn, playActivate, selection])

  return null
}
