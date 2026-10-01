import { SeatDevicesHint } from '@tastic/hud/guide'
import { isValidElement, type ReactElement } from 'react'

import { getGuideSteps } from '@/constants/guideSteps'
import type { KeyScheme, Player } from '@/types'

const DEFAULT_KEYS: Record<Player, KeyScheme> = { 1: 'wasd', 2: 'arrows' }

// Every KeyScheme, typed as a record so adding a scheme to the union fails typecheck here until it's
// listed, which keeps the exhaustive body-length check below exhaustive.
const SCHEME_SET: Record<KeyScheme, true> = { wasd: true, arrows: true, ijkl: true }
const SCHEMES = Object.keys(SCHEME_SET) as KeyScheme[]
const EVERY_PAIR: Record<Player, KeyScheme>[] = SCHEMES.flatMap((p1) => SCHEMES.map((p2) => ({ 1: p1, 2: p2 })))

function textOf(touch: boolean, keys = DEFAULT_KEYS) {
  return getGuideSteps({ touch, keys })
    .map((step) => `${step.title} ${step.body}`)
    .join(' ')
}

describe('getGuideSteps', () => {
  it.each([
    ['touch', true],
    ['desktop', false]
  ])('gives the %s guide three complete, illustrated cards', (_name, touch) => {
    const steps = getGuideSteps({ touch, keys: DEFAULT_KEYS })

    expect(steps).toHaveLength(3)
    for (const step of steps) {
      expect(step.title.trim().length).toBeGreaterThan(0)
      // A card a casual player reads in a glance, not a wall of text.
      expect(step.body.length).toBeLessThanOrEqual(90)
      // The pager sizes every page to the tallest, so a card without art leaves a visible gap.
      expect(step.art).toBeDefined()
    }
  })

  it('states the rule the game never prints anywhere: walls and every trail, your own included, are lethal, and the last one riding wins', () => {
    for (const touch of [true, false]) {
      const [, rules] = getGuideSteps({ touch, keys: DEFAULT_KEYS })
      expect(rules.title).toBe('Last One Riding Wins')
      expect(rules.body).toMatch(/wall/i)
      expect(rules.body).toMatch(/even your own/i)
    }
  })

  it('teaches swiping on touch, and only says "your half" on the two-player card (it is not true solo)', () => {
    const [steer, , twoPlayer] = getGuideSteps({ touch: true, keys: DEFAULT_KEYS })

    expect(steer.body).toMatch(/swipe/i)
    expect(steer.body).not.toMatch(/half/i)
    expect(twoPlayer.body).toMatch(/your own half/i)
  })

  it('never tells a desktop player to swipe, and names the keys each seat actually uses', () => {
    expect(textOf(false)).not.toMatch(/swipe/i)
    expect(textOf(false)).toMatch(/Player 1 uses WASD, player 2 uses the arrow keys/)
    expect(textOf(false, { 1: 'ijkl', 2: 'wasd' })).toMatch(/Player 1 uses IJKL, player 2 uses WASD/)
  })

  it("uses the fleet's desktop two-player wording: One Keyboard, since every LightCycles scheme is a key scheme", () => {
    const [, , twoPlayer] = getGuideSteps({ touch: false, keys: DEFAULT_KEYS })

    expect(twoPlayer.title).toBe('Two Players, One Keyboard')
    expect(twoPlayer.body).toBe('Player 1 uses WASD, player 2 uses the arrow keys. Change them before a match.')
  })

  it("draws the desktop two-player card with hud's shared SeatDevicesHint, both seats on the keyboard", () => {
    const [, , twoPlayer] = getGuideSteps({ touch: false, keys: DEFAULT_KEYS })

    expect(isValidElement(twoPlayer.art)).toBe(true)
    const art = twoPlayer.art as ReactElement<{ devices: readonly string[] }>
    expect(art.type).toBe(SeatDevicesHint)
    expect(art.props.devices).toEqual(['keyboard', 'keyboard'])
  })

  it.each(EVERY_PAIR)('keeps every desktop body within 90 characters for seat keys %j', (keys) => {
    for (const step of getGuideSteps({ touch: false, keys })) {
      expect(step.body.length).toBeLessThanOrEqual(90)
    }
  })
})
