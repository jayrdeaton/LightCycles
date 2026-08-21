import { SeedColor } from '@rific/auto-paper'
import { Platform, StyleSheet, View } from 'react-native'
import { Text } from 'react-native-paper'

import { IconDropdown } from '@/components/IconDropdown'
import { InlineColorPicker } from '@/components/InlineColorPicker'
import { ReadyButton } from '@/components/ReadyButton'
import { MONO_FONT } from '@/constants/fonts'
import { useIsTouchPrimaryDevice } from '@/hooks/useIsTouchPrimaryDevice'
import { PopoverHost, usePopoverHost } from '@/hooks/usePopoverHost'
import { KeyScheme } from '@/types'

const KEY_SCHEME_OPTIONS: { value: KeyScheme; label: string }[] = [
  { value: 'wasd', label: 'WASD' },
  { value: 'arrows', label: 'Arrows' },
  { value: 'ijkl', label: 'IJKL' }
]

export interface LobbyPlayerPanelProps {
  // Namespaces this panel's popover ids ('color', 'controls') so two panels can safely share one
  // host (see `host` below) without their ids colliding.
  idPrefix: string
  // Shared popover host, when this panel's popovers should be mutually exclusive with another
  // panel's (e.g. vs-CPU: only one human is ever driving both slots, so having both YOU's and
  // CPU's color pickers open at once is just visual clutter, not a useful simultaneous-edit case).
  // Omit to fall back to this panel's own independent host — the two-player case, where two real
  // people editing at once is the point.
  host?: PopoverHost
  // Optional text label — color (plus, for vs-CPU, the color picker's own face-vs-robot icon)
  // already identifies the player, so this isn't used anywhere currently.
  label?: string
  color: string
  onColorChange: (hex: string) => void
  swatches: SeedColor[]
  // The other player's current color — stays visible in the swatch grid but disabled, rather than
  // removed from it entirely. Unless allowSwapTaken is set — see InlineColorPicker's own doc.
  takenColor?: string
  allowSwapTaken?: boolean
  isHuman: boolean
  keyScheme?: KeyScheme
  onKeySchemeChange?: (scheme: KeyScheme) => void
  otherKeyScheme?: KeyScheme
  ready?: boolean
  onToggleReady?: () => void
  dark: boolean
  // vs-CPU only has one human player, so the lobby renders its Ready toggle standalone, centered
  // below both slots, instead of embedded in this panel — see lobby.tsx's solo layout.
  showReadyButton?: boolean
  // See PopoverBody's align prop — pass 'right' for a panel that sits near the screen's right
  // edge (e.g. player 2 in a side-by-side layout), so its popovers grow leftward instead of
  // overflowing off-screen.
  align?: 'left' | 'right'
}

// One panel per player slot in the lobby ("picking your fighter"): a color picker (interactive for
// both human and CPU slots, matching the pre-lobby title screen's own behavior of letting the CPU's
// color be chosen too), a web-only keyboard-scheme picker and a Ready toggle for human slots only.
// Owns its own popover host shared by its color and control pickers (so opening one closes the
// other) unless a `host` is passed in to share with another panel instead.
export function LobbyPlayerPanel({ idPrefix, host, label, color, onColorChange, swatches, takenColor, allowSwapTaken, isHuman, keyScheme, onKeySchemeChange, otherKeyScheme, ready, onToggleReady, dark, showReadyButton = true, align }: LobbyPlayerPanelProps) {
  const ownHost = usePopoverHost()
  const popover = host ?? ownHost
  const isTouchPrimary = useIsTouchPrimaryDevice()
  const keySchemeOptions = otherKeyScheme ? KEY_SCHEME_OPTIONS.filter((o) => o.value !== otherKeyScheme) : KEY_SCHEME_OPTIONS
  const mutedColor = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  // Checking *this panel's own* ids, not just "is anything open on the host" — when `host` is
  // shared (vs-CPU), the other panel's or LobbySharedControls' popovers also live on it, and
  // elevating this panel for those too would tie it with whichever of them actually has the open
  // popover, letting DOM order (wrongly) decide which one paints on top.
  const ownPopoverOpen = popover.openId?.startsWith(`${idPrefix}-`) ?? false

  return (
    <View style={[styles.panel, ownPopoverOpen && styles.panelOpen]}>
      {label && (
        <Text variant='labelSmall' style={{ color, fontFamily: MONO_FONT }}>
          {label}
        </Text>
      )}

      {/* Human slots (which, in two-player mode, is both of them) get a face; vs-CPU's CPU slot
      gets a robot — this is what actually distinguishes "you" from "the CPU" now, not text. */}
      <InlineColorPicker id={`${idPrefix}-color`} host={popover} value={color} onChange={onColorChange} swatches={swatches} takenValue={takenColor} allowSwapTaken={allowSwapTaken} dark={dark} align={align} icon={isHuman ? 'face-man' : 'robot'} />

      {isHuman && Platform.OS === 'web' && !isTouchPrimary && keyScheme && onKeySchemeChange && <IconDropdown id={`${idPrefix}-controls`} host={popover} icon='keyboard-outline' accessibilityLabel='Control scheme' options={keySchemeOptions} value={keyScheme} onChange={onKeySchemeChange} accentColor={color} mutedColor={mutedColor} dark={dark} align={align} />}

      {isHuman && showReadyButton && onToggleReady && <ReadyButton color={color} ready={ready ?? false} onToggleReady={onToggleReady} />}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    gap: 12
  },
  // See IconDropdown's anchorOpen comment — this panel is a sibling of the other player's panel
  // (and the shared-controls band) in lobby.tsx, so a popover escaping this panel's bounds needs
  // the panel itself elevated, not just the popover content, to paint above a later sibling.
  panelOpen: {
    zIndex: 100
  }
})
