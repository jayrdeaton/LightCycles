import { SeedColor } from '@rific/auto-paper'
import { useIsTouchPrimaryDevice } from '@tastic/core'
import { getLabeledDropdownContentHeight, InlineColorPicker, LABELED_DROPDOWN_POPOVER_WIDTH, LabeledDropdown, LabeledDropdownOption, PopoverHost, ReadyButton, SectionedDropdown, usePopoverHost } from '@tastic/hud'
import { ProfilePicker } from '@tastic/profile'
import { useCallback } from 'react'
import { Platform, StyleSheet, View } from 'react-native'

import { useZoneClampedAlign } from '@/hooks/useZoneClampedAlign'
import { CpuDifficulty, KeyScheme, Profile } from '@/types'

export const KEY_SCHEME_OPTIONS: { value: KeyScheme; label: string }[] = [
  { value: 'wasd', label: 'WASD' },
  { value: 'arrows', label: 'Arrows' },
  { value: 'ijkl', label: 'IJKL' }
]

export interface LobbyPlayerPanelProps {
  // Namespaces this panel's popover ids ('color', 'controls', 'profile') so two panels can safely
  // share one host (see `host` below) without their ids colliding.
  idPrefix: string
  // Shared popover host, when this panel's popovers should be mutually exclusive with another
  // panel's (e.g. vs-CPU: only one human is ever driving both slots, so having both YOU's and
  // CPU's color pickers open at once is just visual clutter, not a useful simultaneous-edit case).
  // Omit to fall back to this panel's own independent host — the two-player case, where two real
  // people editing at once is the point.
  host?: PopoverHost
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
  // The other player's current key scheme, if any — passed straight through as SectionedDropdown's
  // takenValue so it stays in the options list (rather than filtered out) but renders disabled.
  // Keeping it in the list is what lets the trigger gauge show each seat's true position among all
  // three schemes, instead of both seats' gauges landing on whichever index their own filtered-down
  // list happened to produce (see takenColor above for the identical "shown, not removed" reasoning
  // applied to color).
  otherKeyScheme?: KeyScheme
  ready?: boolean
  onToggleReady?: () => void
  dark: boolean
  // vs-CPU only has one human player, so the lobby renders its Ready toggle standalone, centered
  // below both slots, instead of embedded in this panel — see lobby.tsx's solo layout.
  showReadyButton?: boolean
  profiles?: Profile[]
  selectedProfileId?: string | null
  takenProfileId?: string | null
  // What the name trigger shows before any profile's selected — this seat's own 'P1'/'P2' (see
  // ProfilePicker's own doc for why it's never "Player", the menu's own row for that state).
  // Required whenever profiles is provided, since the trigger always needs some idle text.
  guestLabel?: string
  onProfileSelect?: (profile: Profile | null) => void
  // Navigates to the profile-management screen — only ever provided for P1 (see ProfilePicker's
  // own doc for why: P2's rotated zone can't host a working text keyboard).
  onManageProfiles?: () => void
  // CPU slots only (see isHuman) — the same "trigger sits above pickerRow" slot ProfilePicker uses
  // for a human seat's name, just for picking who's actually driving the CPU instead of who you are.
  cpuDifficulty?: CpuDifficulty
  cpuDifficultyOptions?: LabeledDropdownOption<CpuDifficulty>[]
  onCpuDifficultyChange?: (value: CpuDifficulty) => void
}

// One panel per player slot in the lobby ("picking your fighter"): a name label (tap to switch
// profiles or create one), a color picker (interactive for both human and CPU slots) and a web-only
// keyboard-scheme picker, and a Ready toggle for human slots only. Color/key scheme are each
// always-visible, directly-editable pickers — selecting a saved profile pre-fills them and keeps
// key scheme synced back to that profile for as long as it stays selected (see lobby.tsx's
// handleP1KeySchemeChange); color deliberately does *not* sync back (see lobby.tsx's
// handleP1ColorChange own doc) — it's a per-match override on top of the profile's own saved color,
// not an edit to it. The color button itself shows the selected profile's own tag (see
// InlineColorPicker) in place of the plain face/robot icon, since that's the one place on this
// screen a profile's identity is actually visible without opening the name dropdown.
//
// Owns its own popover host shared by its color/profile/control pickers (so opening one closes the
// other) unless a `host` is passed in to share with another panel instead. Neither popover needs an
// explicit screen-edge alignment hint — all auto-align against their own measured position (see
// useAutoAlign, used inside InlineColorPicker/ProfilePicker/SectionedDropdown), which is what
// actually lets this panel render unmodified whether it lands on the left, right, or center of the
// screen.
export function LobbyPlayerPanel({ idPrefix, host, color, onColorChange, swatches, takenColor, allowSwapTaken, isHuman, keyScheme, onKeySchemeChange, otherKeyScheme, ready, onToggleReady, dark, showReadyButton = true, profiles, selectedProfileId, takenProfileId, guestLabel, onProfileSelect, onManageProfiles, cpuDifficulty, cpuDifficultyOptions, onCpuDifficultyChange }: LobbyPlayerPanelProps) {
  const ownHost = usePopoverHost()
  const popover = host ?? ownHost
  // Zone-aware placement for the CPU-difficulty popover specifically (see useZoneClampedAlign's own
  // doc for why a popover living inside a @tastic/split-screen zone needs this instead of
  // LabeledDropdown's own plain default) — called unconditionally, with a safe closed/empty state
  // when this panel isn't actually showing a CPU seat right now (isHuman, or cpuDifficultyOptions
  // not yet provided), same as every other conditionally-relevant value in this component.
  // LABELED_DROPDOWN_POPOVER_WIDTH/getLabeledDropdownContentHeight mirror LabeledDropdown's own
  // internal sizing exactly, so this hook measures against the same dimensions that component will
  // actually render at.
  const cpuDifficultyId = `${idPrefix}-difficulty`
  const cpuDifficultyOpen = popover.openId === cpuDifficultyId
  const cpuDifficultyAlign = useZoneClampedAlign(cpuDifficultyOpen, LABELED_DROPDOWN_POPOVER_WIDTH, getLabeledDropdownContentHeight(cpuDifficultyOptions?.length ?? 0))
  const isTouchPrimary = useIsTouchPrimaryDevice()
  // Key scheme has no meaning on a swipe-controlled touch device.
  const showKeyScheme = Platform.OS === 'web' && !isTouchPrimary
  // The color button's own tag display (see InlineColorPicker) — read live from the selected
  // profile rather than snapshotted at selection time, since there's no other editing surface for
  // it on this screen at all (see ProfilesManager for the only place a tag is actually typed).
  const selectedProfile = profiles?.find((p) => p.id === selectedProfileId) ?? null
  // Pre-fills the seat's own key scheme from the selected profile, once, at selection time — stays
  // fully editable afterward (see lobby.tsx's sync-back-while-selected key-scheme handler). Color
  // does NOT get pre-filled here: lobby.tsx's own mount/reapply effect already re-derives a seat's
  // color from whichever profile (or guest/CPU slot) ends up selected — including a fresh tap-select
  // right here — the moment lastSelected itself actually updates, so doing it here too would just
  // read this callback's own stale pre-selection closure and risk misfiling the outgoing color as a
  // guest/CPU one (see lobby.tsx's handleP1ColorChange/handleP2ColorChange's own doc).
  const handleProfileSelect = useCallback(
    (profile: Profile | null) => {
      onProfileSelect?.(profile)
      if (profile) onKeySchemeChange?.(profile.keyScheme)
    },
    [onProfileSelect, onKeySchemeChange]
  )
  const mutedColor = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'
  // Checking *this panel's own* ids, not just "is anything open on the host" — when `host` is
  // shared (vs-CPU), the other panel's or LobbySharedControls' popovers also live on it, and
  // elevating this panel for those too would tie it with whichever of them actually has the open
  // popover, letting DOM order (wrongly) decide which one paints on top.
  const ownPopoverOpen = popover.openId?.startsWith(`${idPrefix}-`) ?? false
  // Narrower than ownPopoverOpen on purpose — only true for a popover actually inside pickerRow
  // itself (color/controls). ProfilePicker sits above pickerRow as its own sibling and already
  // self-elevates when its own popover opens (see its anchorOpen) — if pickerRowOpen used the broad
  // ownPopoverOpen check instead, both it and ProfilePicker would hit zIndex:100 at the same time
  // whenever the *profile* popover opens, and the tie would resolve by DOM order, which favors
  // pickerRow (the later sibling) and lets it paint over the profile switcher's own list.
  const pickerRowPopoverOpen = popover.openId === `${idPrefix}-color` || popover.openId === `${idPrefix}-controls`

  return (
    <View style={[styles.panel, ownPopoverOpen && styles.panelOpen]}>
      {/* Name label + profile switcher, human slots only — fully opt-in, so nothing renders unless
      the caller actually wired the CRUD callbacks in (see lobby.tsx). Its own popover already
      self-elevates when open (see ProfilePicker's anchorOpen) — it's a direct sibling of pickerRow/
      ReadyButton below within this same panel, so no extra wrapper elevation is needed here. The
      CPU's own difficulty picker takes this exact same slot for the opposite (non-human) case —
      "who's actually playing" either way, just a saved identity for a human seat versus which
      opponent you're facing for the CPU's. LabeledDropdown self-elevates the same way ProfilePicker
      does, for the same reason. */}
      {isHuman ? profiles !== undefined && onProfileSelect && <ProfilePicker idPrefix={idPrefix} host={popover} profiles={profiles} selectedId={selectedProfileId ?? null} takenId={takenProfileId} color={color} dark={dark} guestLabel={guestLabel ?? 'GUEST'} onSelect={handleProfileSelect} onManage={onManageProfiles} /> : cpuDifficulty !== undefined && cpuDifficultyOptions && onCpuDifficultyChange && <LabeledDropdown id={cpuDifficultyId} host={popover} options={cpuDifficultyOptions} value={cpuDifficulty} onChange={onCpuDifficultyChange} color={color} dark={dark} alignOverride={cpuDifficultyAlign} />}

      <View style={[styles.pickerRow, pickerRowPopoverOpen && styles.pickerRowOpen]}>
        {/* Human slots (which, in two-player mode, is both of them) show the selected profile's own
        tag when it has one, falling back to a face; vs-CPU's CPU slot always falls back to a robot
        (no profile concept there at all) — this is what actually distinguishes "you" from "the CPU"
        now, not a fixed icon. */}
        <InlineColorPicker id={`${idPrefix}-color`} host={popover} value={color} onChange={onColorChange} swatches={swatches} takenValue={takenColor} allowSwapTaken={allowSwapTaken} dark={dark} tag={isHuman ? selectedProfile?.tag : undefined} icon={isHuman ? 'face-man' : 'robot'} />

        {/* Side by side with the color picker rather than stacked — see PlayerSetupPanel (BoxHockey)
        for the sibling component this mirrors. Web-only (keyboard has no touch-gesture equivalent
        to pick a "feel" for), so on native/touch this row still only ever shows the color picker. */}
        {isHuman && showKeyScheme && keyScheme && onKeySchemeChange && <SectionedDropdown id={`${idPrefix}-controls`} host={popover} icon='keyboard-outline' accessibilityLabel='Control scheme' sections={[{ kind: 'single', id: 'controls', options: KEY_SCHEME_OPTIONS, value: keyScheme, onChange: onKeySchemeChange, takenValue: otherKeyScheme }]} accentColor={color} mutedColor={mutedColor} dark={dark} />}
      </View>

      {isHuman && showReadyButton && onToggleReady && <ReadyButton color={color} ready={ready ?? false} onToggleReady={onToggleReady} />}
    </View>
  )
}

const styles = StyleSheet.create({
  panel: {
    alignItems: 'center',
    gap: 12
  },
  // See SectionedDropdown's anchorOpen comment — this panel is a sibling of the other player's panel
  // (and the shared-controls band) in lobby.tsx, so a popover escaping this panel's bounds needs
  // the panel itself elevated, not just the popover content, to paint above a later sibling.
  panelOpen: {
    zIndex: 100
  },
  // Same gap as `panel`'s own vertical rhythm, reused horizontally — the pickers sit side by side
  // within this row instead of stacked in the panel's own column.
  pickerRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12
  },
  // A popover is an absolutely-positioned sibling of its own trigger, not participating in normal
  // layout flow — so a tall one (e.g. the profile switcher's list, once it has a couple of saved
  // profiles) can extend down far enough to overlap the ReadyButton below, which paints on top of
  // it by default DOM order since it's a later sibling within `panel`. `panel`'s own panelOpen
  // elevation only helps this panel paint above OTHER panels/shared-controls (see its own comment)
  // — it does nothing for stacking *within* this panel. This is what actually fixes that: elevate
  // pickerRow itself above its own later sibling whenever one of its popovers is open.
  pickerRowOpen: {
    zIndex: 100
  }
})
