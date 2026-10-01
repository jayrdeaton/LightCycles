import { type DirectionKeyLabels, DirectionKeysHint, type GuideStep, SeatDevicesHint, SeatDiagram, SwipeHint } from '@tastic/hud/guide'

import { GuideTrailCrash } from '@/components/GuideArt'
import type { KeyScheme, Player } from '@/types'

// How each key scheme reads in a sentence, and on DirectionKeysHint's caps (undefined = draw the
// arrow keys as arrows). Deliberately not the lobby's own KEY_SCHEME_OPTIONS labels ('Arrows'),
// which are picker labels, not prose.
const KEY_PHRASE: Record<KeyScheme, string> = { wasd: 'WASD', arrows: 'the arrow keys', ijkl: 'IJKL' }
const KEY_CAPS: Record<KeyScheme, DirectionKeyLabels | undefined> = {
  wasd: { up: 'W', left: 'A', down: 'S', right: 'D' },
  arrows: undefined,
  ijkl: { up: 'I', left: 'J', down: 'K', right: 'L' }
}

interface GuideStepsInput {
  // A touch screen vs. a desktop browser: a phone steers by swiping, a desktop by key.
  touch: boolean
  // Each seat's live key scheme (settings.keyScheme) — only read on desktop. Seats pick their own
  // keys in the lobby, so a replayed guide has to name the real ones, not the defaults.
  keys: Record<Player, KeyScheme>
}

// The three cards of LightCycles' how-to-play flow. Pure and hook-free so it's trivially testable;
// GuideHost feeds it useIsTouchPrimaryDevice() and the live key schemes, and memoizes the result.
//
// What's here is what a first-time player cannot work out alone (none of it is printed anywhere in
// the game): steering is absolute, not relative; walls and ANY trail are lethal, your own included;
// the last cycle riding wins; and in two-player one phone is shared face to face. Copy rules (Jay,
// 2026-09-24): Title Case titles, short bodies, and only say what's true in every mode — "your half"
// is only true in two-player, so it lives on the two-player card, not the steering one. There's no
// card explaining One Player vs Two Player: those buttons are right behind the dialog.
export function getGuideSteps({ touch, keys }: GuideStepsInput): GuideStep[] {
  return [
    {
      title: 'Steer Your Cycle',
      body: touch ? 'Swipe up, down, left or right. Your cycle turns the way you swipe.' : 'Press a direction key and your cycle turns that way.',
      art: touch ? <SwipeHint direction='up' /> : <DirectionKeysHint labels={KEY_CAPS[keys[1]]} />
    },
    {
      title: 'Last One Riding Wins',
      body: 'Hit a wall or a trail, even your own, and you crash.',
      art: <GuideTrailCrash />
    },
    touch
      ? {
          title: 'Two Players, One Phone',
          body: 'Sit across from each other and swipe in your own half.',
          art: <SeatDiagram />
        }
      : {
          // The fleet's shared desktop two-player wording. Every LightCycles scheme is a key scheme (no
          // mouse seat), so it is always "One Keyboard" and never "Drag in your own half".
          title: 'Two Players, One Keyboard',
          body: `Player 1 uses ${KEY_PHRASE[keys[1]]}, player 2 uses ${KEY_PHRASE[keys[2]]}. Change them before a match.`,
          art: <SeatDevicesHint devices={['keyboard', 'keyboard']} />
        }
  ]
}
