import { defaultColors, getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { FakeLandscapeView, getViewRotation, rotateInsets, useIsTouchPrimaryDevice, useOrientationState } from '@tastic/core'
import { CornerActionButtons, getColorPopoverId, getCpuDifficultyPopoverId, getInlineColorPickerContentSize, getLabeledDropdownContentHeight, LABELED_DROPDOWN_POPOVER_WIDTH, MenuOption, PlayerSetupPanel, PressAwayOverlay, ReadyButton, SectionedDropdown, SharedActionBand, usePopoverHost, useZoneClampedAlign } from '@tastic/hud'
import type { Profile as BaseProfile } from '@tastic/profile'
import { DualZoneLayout, needsSharedNeutralZone, useDualZoneLayout } from '@tastic/split-screen'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Platform, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useDispatch, useSelector } from 'react-redux'

import { LOBBY_SHARED_CONTROLS_IDS, LobbySharedControls } from '@/components/LobbySharedControls'
import { SettingsDialog } from '@/components/SettingsDialog'
import { DEFAULT_P1_COLOR, DEFAULT_P2_COLOR, LOBBY_PANEL_SWAP_FADE_MS, POWERUP_ALL_TYPES, POWERUP_ICONS } from '@/constants/game'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useProfiles } from '@/hooks/useProfiles'
import { seatColorsActions } from '@/redux/seatColorsSlice'
import { type AppDispatch, type RootState } from '@/redux/store'
import { ArenaVariant, CpuDifficulty, GridSizeTier, KeyScheme, Player, PowerupType, SpeedTier, TrailSpeedTier } from '@/types'
import { humanPlayersFor, parseGameMode } from '@/utils/gameParams'
import { DEFAULT_SETTINGS } from '@/utils/gameSettingsValidation'
import { safeBack } from '@/utils/navigation'

// Small -> large vehicles, echoing the game's own light-cycle theme rather than a generic S/M/L
// badge. MDI's name for the first is 'motorbike', not 'motorcycle'.
const GRID_SIZE_OPTIONS: { value: GridSizeTier; label: string; icon: string }[] = [
  { value: 'small', label: 'Small', icon: 'motorbike' },
  { value: 'medium', label: 'Medium', icon: 'car' },
  { value: 'large', label: 'Large', icon: 'train' }
]

// The board's static obstacle layout (see utils/arenas.ts's buildArenaObstacles) — a "board shape"
// concept like grid size above, not a gameplay-tuning tier, so no escalating icon convention here:
// each icon just depicts the layout itself. 'open' is the original fully-open rectangle (no
// obstacles at all), matching this type's own default (see ArenaVariant's comment).
const ARENA_OPTIONS: MenuOption<ArenaVariant>[] = [
  { value: 'open', label: 'Open', icon: 'crop-square' },
  { value: 'pillars', label: 'Pillars', icon: 'dots-grid' },
  { value: 'gauntlet', label: 'Gauntlet', icon: 'view-column' },
  { value: 'portals', label: 'Portals', icon: 'orbit-variant' },
  { value: 'underpass', label: 'Underpass', icon: 'tunnel' }
]

// Two rows of one shared multi-select section (not two separate one-item sections) — see
// LobbySharedControls' arena dropdown, which bundles this pair alongside ARENA_OPTIONS in the same
// popover, right after it with no divider between them: they're both simple board-shape toggles,
// not distinct settings that need visually separating from each other the way they're separated
// from the layout picker above them. Each option's own presence in the section's value array is
// that toggle's on/off state, converted to/from a plain boolean at the prop boundary
// (onExtendIntoSafeAreaChange/onWrapEdgesChange) rather than exposed as an array anywhere else.
// Pac-Man's own glyph for wrap edges — nothing reads "screen wrap" as clearly as the source it's
// borrowed from.
const EXTEND_SAFE_AREA_OPTION: MenuOption<'extendIntoSafeArea'> = { value: 'extendIntoSafeArea', label: 'Full Screen', icon: 'arrow-expand-all' }
const WRAP_EDGES_OPTION: MenuOption<'wrapEdges'> = { value: 'wrapEdges', label: 'Wrap Edges', icon: 'pac-man' }

const SPEED_OPTIONS: { value: SpeedTier; label: string; icon: string }[] = [
  { value: 'slow', label: 'Slow', icon: 'snail' },
  { value: 'normal', label: 'Normal', icon: 'tortoise' },
  { value: 'fast', label: 'Fast', icon: 'rabbit' }
]

// Tron-flavored escalation instead of a plain skill-level label, matching the same playful-tier
// convention grid size's vehicles and speed's animals already use — "Drone" (a simple, disposable
// program), "Bot" (a real opponent), "MCP" (Tron's own Master Control Program, the final-boss
// antagonist) — rather than "AI" for the hardest tier, which reads oddly once every tier is already
// an AI opponent by definition; MCP names *which* one, not just how hard.
const CPU_DIFFICULTY_OPTIONS: { value: CpuDifficulty; label: string; icon: string }[] = [
  { value: 'easy', label: 'Drone', icon: 'emoticon-happy-outline' },
  { value: 'normal', label: 'Bot', icon: 'emoticon-neutral-outline' },
  { value: 'hard', label: 'MCP', icon: 'emoticon-devil-outline' }
]

// Off -> fast tail-chase, echoing the same playful-tier convention as the other rows (and, unlike
// the old fast/slow/static ordering, now actually ascending — see TrailSpeedTier's own comment).
// Same seed/sprout/tree growth-stage icons as before, just re-paired: 'off' never trims so the
// trail grows to a full tree; 'fast' trims most aggressively, keeping it seed-small. No description
// text on medium/fast (same as grid size/speed/CPU difficulty above) — players learn what each does
// by trying it. 'off' gets one anyway: it's the game's original behavior, and "this is the one you
// already know" is useful context a blind try can't give you.
const TRAIL_SPEED_OPTIONS: { value: TrailSpeedTier; label: string; description?: string; icon: string }[] = [
  { value: 'off', label: 'Slow (Off)', description: 'Classic', icon: 'tree-outline' },
  { value: 'medium', label: 'Medium', icon: 'sprout-outline' },
  { value: 'fast', label: 'Fast', icon: 'seed-outline' }
]

// Icons match POWERUP_ICONS exactly — the same glyph a held item shows in PowerupHud.tsx once
// revealed, so a player who's already seen one in a HUD badge recognizes it here too.
const POWERUP_OPTIONS: MenuOption<PowerupType>[] = [
  { value: 'overdrive', label: 'Overdrive', icon: POWERUP_ICONS.overdrive },
  { value: 'stasis', label: 'Stasis', icon: POWERUP_ICONS.stasis },
  { value: 'shield', label: 'Shield', icon: POWERUP_ICONS.shield },
  { value: 'prune', label: 'Prune', icon: POWERUP_ICONS.prune },
  { value: 'hack', label: 'Hack', icon: POWERUP_ICONS.hack },
  { value: 'overclock', label: 'Overclock', icon: POWERUP_ICONS.overclock }
]

// Was previously declared in the now-removed local LobbyPlayerPanel.tsx (moved to @tastic/hud's
// shared PlayerSetupPanel) — lives here now since this is its only remaining call site.
const KEY_SCHEME_OPTIONS: { value: KeyScheme; label: string }[] = [
  { value: 'wasd', label: 'WASD' },
  { value: 'arrows', label: 'Arrows' },
  { value: 'ijkl', label: 'IJKL' }
]

function pickRandom<T>(options: readonly { value: T }[]): T {
  return options[Math.floor(Math.random() * options.length)].value
}

export default function LobbyScreen() {
  // Read only from this screen's own route param, never from useGameSettings().gameMode — the
  // settings hook's AsyncStorage read is async, and racing it here could momentarily show the
  // wrong number of player panels.
  const params = useLocalSearchParams<{ gameMode: string }>()
  const gameMode = useMemo(() => parseGameMode(params.gameMode), [params.gameMode])
  const humanPlayers = useMemo(() => humanPlayersFor({ gameMode }), [gameMode])
  // Hoisted up from where this used to sit (just above isFaceToFace below) — the seat-color logic
  // further down needs to know whether seat 2 is even capable of having a profile before it can
  // decide that seat's own persistence rule.
  const p2IsHuman = humanPlayers.includes(2)

  const { settings, setSettings, commitRoundSettings } = useGameSettings()
  const { profiles, lastSelected, updateProfile, selectProfile } = useProfiles()
  // Create/rename/delete all live on their own routed screen now (see app/profiles.tsx, reachable
  // only from P1's dropdown since P2's rotated zone can't host a working text keyboard), which
  // reads useProfiles()/useGameStats() directly rather than through this screen at all.
  // updateProfile is only ever called from here now — see handleP1KeySchemeChange etc. for the one
  // field (key scheme) still synced back while a profile stays selected, and
  // handleP1ColorChange's own doc for why color deliberately isn't.
  // orientationMode just follows the device's own physical tilt (see useOrientationState),
  // CPU games included — how you're holding the phone right now decides the layout, not a stored
  // per-round choice. This is what actually lets two players sit shoulder-to-shoulder and pick a
  // color/control scheme at the same time once the phone is turned sideways, instead of squeezing
  // two panels into a portrait-narrow row — and for vs-CPU, it's simply whichever way the solo
  // player is holding it. Lock Orientation (see SettingsDialog) is the opt-in for pinning it.
  const { orientationMode, p1OnRight, upsideDown, resolved: p1OnRightResolved } = useOrientationState(settings.lockOrientation)

  // The panel area's own layout (which branch renders, which side each panel is on) lags one fade
  // behind the live orientationMode/p1OnRight/upsideDown above — see useDualZoneLayout's own
  // comment. Everything else on this screen (the back/settings buttons, shared controls, Ready
  // button) reads the live values directly and never re-positions, so nothing about it needs
  // masking. Also drives the solo (vs-CPU) branch's own row below — that one doesn't rotate anyone
  // 180°, but still reorders/fades across a portrait<->landscape change the same way.
  const { panelLayout, panelFadeStyle } = useDualZoneLayout(orientationMode, p1OnRight, p1OnRightResolved, upsideDown, LOBBY_PANEL_SWAP_FADE_MS)
  const isSideBySide = panelLayout.orientationMode === 'sideBySide'

  const [settingsOpen, setSettingsOpen] = useState(false)
  // react-native-safe-area-context always reports insets relative to the device's own fixed
  // physical frame (the OS thinks the interface is still portrait-locked and never rotates, so it
  // has no idea FakeLandscapeView below is rotating the content) — rotateInsets remaps them onto
  // whichever edge they actually correspond to once visually rotated, using the same committed
  // rotation FakeLandscapeView itself renders with, so `top`/`left`/`right` below always mean the
  // screen's real, visual edges regardless of how the phone is being held. See that function's own
  // doc — verified against a real device for the 90°/-90° cases.
  const rotation = getViewRotation(panelLayout.orientationMode, panelLayout.p1OnRight, panelLayout.upsideDown)
  const rotatedInsets = rotateInsets(useSafeAreaInsets(), rotation)
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const { set: setThemeColor } = useThemeSettings()
  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary

  const dispatch = useDispatch<AppDispatch>()
  const lastGuestColor = useSelector((state: RootState) => state.seatColors.lastGuestColor)
  const lastCpuColor = useSelector((state: RootState) => state.seatColors.lastCpuColor)
  // A manual recolor/clash-swap landing on a seat that currently has a profile selected — see
  // redux/seatColorsSlice.ts's own doc comment. Persisted (survives navigation and relaunch), only
  // cleared when that seat's own selection genuinely changes (handleP1ProfileSelect/
  // handleP2ProfileSelect below), never by merely leaving and returning to this screen.
  const profileOverride = useSelector((state: RootState) => state.seatColors.profileOverride)
  // Resolved fresh every render (used inside the color-change handlers and the mount/reapply
  // effect below) but deliberately never listed in either's own dependency array — only the
  // *id* driving a seat's identity is watched there (see that effect's own doc for why).
  const p1Profile = profiles.find((p) => p.id === lastSelected[1]) ?? null
  const p2Profile = p2IsHuman ? (profiles.find((p) => p.id === lastSelected[2]) ?? null) : null

  // Where a seat's color actually gets persisted once it changes live, split by who's occupying it
  // right now — shared by handleSeatColorChange below for both seats rather than each direction
  // re-deriving the same profile/guest/CPU branch as a mirror image of the other. A seat currently
  // tethered to a profile persists into its own profileOverride slot instead (redux/
  // seatColorsSlice.ts) — see handleSeatColorChange's own doc for why that's still not the same
  // thing as editing the profile's saved color; otherwise it's guest storage for a human seat, the
  // CPU's own slot for seat 2 when it isn't human.
  const persistSeatColor = useCallback(
    (seat: Player, hex: string) => {
      if (seat === 1 ? p1Profile : p2Profile) {
        dispatch(seatColorsActions.setProfileOverride({ seat, color: hex }))
        return
      }
      if (seat === 2 && !p2IsHuman) dispatch(seatColorsActions.setLastCpuColor(hex))
      else dispatch(seatColorsActions.setLastGuestColor({ seat, color: hex }))
    },
    [p1Profile, p2Profile, p2IsHuman, dispatch]
  )

  // Picking the other slot's exact current color swaps the two instead of no-op'ing — only
  // reachable at all when that slot's own picker allowed it (InlineColorPicker's allowSwapTaken:
  // vs-CPU only, where the "other" color is just the CPU's, not a second real person's choice).
  //
  // Deliberately does *not* sync back to a currently-selected profile's own saved color, unlike key
  // scheme below — a profile's color is its "favorite," a default to pre-fill the seat with at
  // selection time; freely repainting your own cycle for one match shouldn't silently redefine what
  // that profile is remembered as. Editing the saved color itself is Manage's own job now (see
  // app/profiles.tsx's own ProfilesManager). What DOES get persisted here is each touched seat's own
  // guest/CPU/profileOverride slot (redux/seatColorsSlice.ts, via persistSeatColor above) — a seat
  // currently holding a profile lands in its own profileOverride instead of the profile's saved
  // color, so it survives navigation and relaunch (see the mount/reapply effect below, which now
  // honors it) until that profile's own selection genuinely changes (handleP1ProfileSelect/
  // handleP2ProfileSelect below), which is the only thing that clears it.
  const handleSeatColorChange = useCallback(
    (seat: Player, hex: string) => {
      const otherSeat: Player = seat === 1 ? 2 : 1
      const selfColor = seat === 1 ? p1Color : p2Color
      const otherColor = seat === 1 ? p2Color : p1Color
      const nextOther = hex.toLowerCase() === otherColor.toLowerCase() ? selfColor : otherColor
      const primary = seat === 1 ? hex : nextOther
      const secondary = seat === 1 ? nextOther : hex
      setThemeColor({ color: { primary, secondary, tertiary: getThirdColor(primary, secondary) } })
      persistSeatColor(seat, hex)
      if (nextOther !== otherColor) persistSeatColor(otherSeat, nextOther)
    },
    [setThemeColor, p1Color, p2Color, persistSeatColor]
  )
  const handleP1ColorChange = useCallback((hex: string) => handleSeatColorChange(1, hex), [handleSeatColorChange])
  const handleP2ColorChange = useCallback((hex: string) => handleSeatColorChange(2, hex), [handleSeatColorChange])

  // Forces both seats' live colors back to their real source of truth on mount (this is also what
  // makes a fresh navigation to this screen re-derive correctly — see below), whenever either seat's
  // own selected-profile id changes (a fresh tap-select, or a guest/CPU<->profile switch either
  // way), and now also whenever a *currently-selected* profile's own saved color changes — e.g.
  // edited via Manage Profiles (app/profiles.tsx), which routes through the same useProfiles()
  // context and stays mounted underneath this screen (expo-router keeps prior screens mounted), so
  // p1Profile/p2Profile below pick up the edit immediately, but previously nothing re-ran this effect
  // to actually repaint with it until the profile was deselected/reselected. Without this, a seat
  // left mid-match with a clash-swapped or manually recolored live theme would also keep painting
  // that drifted color indefinitely instead of the profile's/guest's/CPU's own remembered one. One
  // combined effect covering both seats, not one per seat: resolving them independently would each
  // read the *other* seat's pre-update color out of this same render's closure
  // (handleP1ColorChange/handleP2ColorChange each always re-assert both primary and secondary) and
  // could clobber whatever the other seat's own effect had just set moments earlier in the same
  // commit — going straight to setThemeColor with both seats' final targets already resolved
  // sidesteps that entirely.
  //
  // A profile-selected seat now resolves through profileOverride[seat] ?? profile.color instead of
  // the profile's saved color outright — an active override (persistSeatColor above, via a manual
  // swatch pick or clash-swap) wins over the profile's own color unconditionally, including across a
  // fresh mount of this screen (this effect runs on mount same as any effect) and across a profile
  // color edit made elsewhere while the override stays active. This is the actual fix for the
  // override having previously been nothing more than whatever `theme` happened to already be
  // showing: with no persisted state of its own, a fresh mount here (e.g. navigating away from this
  // screen and back) had nothing to fall back on except this effect's own unconditional
  // `profile.color`, silently discarding it — see redux/seatColorsSlice.ts's own profileOverride doc.
  // The ONLY thing that clears an override now is that seat's own selection genuinely changing (see
  // handleP1ProfileSelect/handleP2ProfileSelect below) — this effect must never do so itself, merely
  // by running again.
  //
  // p1Profile.color/p2Profile.color are tracked directly rather than the whole p1Profile/p2Profile
  // objects: useProfiles.tsx's own `profiles` getter maps a fresh array (and fresh profile objects)
  // on every render regardless of whether anything actually changed, so depending on the object
  // itself would re-fire this effect every render instead of only on a real color change.
  // lastGuestColor/lastCpuColor/profileOverride aren't tracked the same way since nothing outside
  // this screen's own pickers ever dispatches into them — reading them fresh (rather than listing
  // them as deps) is safe precisely because their one and only writer here is either
  // handleSeatColorChange (which already calls setThemeColor itself, in the same breath as
  // persistSeatColor's dispatch, so this effect re-running off that same dispatch would just
  // recompute an already-showing value) or handleP1ProfileSelect/handleP2ProfileSelect's own
  // override-clear (whose accompanying selectProfile call changes lastSelected[seat], already listed
  // below, so this effect re-runs anyway and picks the clear up that way). No load-gate needed here
  // anymore either (unlike the old AsyncStorage-backed hooks/useSeatColors.ts, which had to wait for
  // its own read to resolve):
  // redux-persist's PersistGate (see components/Providers.tsx) already blocks the whole app from
  // rendering until rehydration completes, so lastGuestColor/lastCpuColor/profileOverride are already
  // real values by this component's very first render.
  useEffect(() => {
    const p1Target = p1Profile ? (profileOverride[1] ?? p1Profile.color) : lastGuestColor[1]
    let p2Target = !p2IsHuman ? lastCpuColor : p2Profile ? (profileOverride[2] ?? p2Profile.color) : lastGuestColor[2]
    // Same collision guard Theme.tsx's own cold-boot read used to run — an independently-sourced
    // pair (say, a profile's saved favorite landing on the other seat's own remembered guest/CPU
    // color) has no swap gesture behind it the way a manual recolor does, so this just nudges P2 off
    // P1 rather than leaving both seats' round-end pips/labels ambiguous.
    if (p2Target.toLowerCase() === p1Target.toLowerCase()) p2Target = p2Target.toLowerCase() === DEFAULT_P1_COLOR.toLowerCase() ? DEFAULT_P2_COLOR : DEFAULT_P1_COLOR
    setThemeColor({ color: { primary: p1Target, secondary: p2Target, tertiary: getThirdColor(p1Target, p2Target) } })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSelected[1], lastSelected[2], p1Profile?.color, p2Profile?.color, p2IsHuman])

  // Same swap-on-conflict shape as the color handlers above — but unlike color, this one *does*
  // keep syncing back to a currently-selected profile's own saved key scheme for as long as it
  // stays selected: key scheme has no "freely repaint it for one match" use case the way a cycle's
  // color does, so there's no override/favorite distinction worth drawing here. The live
  // SectionedDropdown never actually reaches the swap case on its own — the other seat's current
  // scheme stays in its own option list (so the gauge shows the right position) but renders
  // disabled via takenValue (see this file's own p2KeySchemePicker below), so tapping it is a
  // no-op — but a profile's
  // saved key scheme (see handleP1ProfileSelect/handleP2ProfileSelect below) pre-fills by calling
  // this directly, bypassing that disabled state entirely, so a real collision is reachable there
  // and needs the swap treatment too. Declared above handleP1ProfileSelect/handleP2ProfileSelect
  // (rather than after, next to the other seat-color handlers) purely so those can close over these
  // without a temporal-dead-zone reference.
  const handleP1KeySchemeChange = useCallback(
    (scheme: KeyScheme) => {
      const nextP2 = scheme === settings.keyScheme[2] ? settings.keyScheme[1] : settings.keyScheme[2]
      setSettings({ keyScheme: { 1: scheme, 2: nextP2 } })
      if (lastSelected[1]) updateProfile(lastSelected[1], { keyScheme: scheme })
      if (nextP2 !== settings.keyScheme[2] && lastSelected[2]) updateProfile(lastSelected[2], { keyScheme: nextP2 })
    },
    [setSettings, settings.keyScheme, lastSelected, updateProfile]
  )
  const handleP2KeySchemeChange = useCallback(
    (scheme: KeyScheme) => {
      const nextP1 = scheme === settings.keyScheme[1] ? settings.keyScheme[2] : settings.keyScheme[1]
      setSettings({ keyScheme: { 1: nextP1, 2: scheme } })
      if (lastSelected[2]) updateProfile(lastSelected[2], { keyScheme: scheme })
      if (nextP1 !== settings.keyScheme[1] && lastSelected[1]) updateProfile(lastSelected[1], { keyScheme: nextP1 })
    },
    [setSettings, settings.keyScheme, lastSelected, updateProfile]
  )

  // The ONE legitimate place a seat's profileOverride actually clears — a fresh profile pick (a
  // real tap-select, guest<->profile switch either way, or the same profile re-picked) means
  // whatever override was riding on the *previous* selection shouldn't leak into the new one. The
  // mount/reapply effect above then re-derives that seat's color from the freshly-selected profile's
  // own saved color (or lastGuestColor/lastCpuColor for a guest/CPU pick), since lastSelected
  // changing is already in that effect's own dependency array.
  //
  // Also pre-fills the seat's own key scheme from the selected profile, once, at selection time —
  // stays fully editable afterward (see handleP1KeySchemeChange/handleP2KeySchemeChange's own
  // sync-back above). Color does NOT get pre-filled here: the mount/reapply effect above already
  // re-derives a seat's color from whichever profile ends up selected the moment lastSelected
  // itself changes, so doing it here too would just read this callback's own stale pre-selection
  // closure. This used to live inside this app's own now-removed LobbyPlayerPanel.tsx (folded into
  // its internal handleProfileSelect wrapper around the onProfileSelect/onKeySchemeChange props);
  // now that @tastic/hud's shared PlayerSetupPanel owns that wiring internally and only exposes a
  // plain onProfileSelect, the pre-fill has to happen here instead. Takes @tastic/profile's own
  // base Profile (matching PlayerSetupPanel's onProfileSelect signature exactly, which has no
  // opinion on this app's own keyScheme field) and re-looks the full, app-typed Profile up out of
  // this app's own `profiles` by id rather than casting the callback's own argument.
  const handleP1ProfileSelect = useCallback(
    (profile: BaseProfile | null) => {
      dispatch(seatColorsActions.setProfileOverride({ seat: 1, color: null }))
      selectProfile(1, profile?.id ?? null)
      const full = profile && profiles.find((p) => p.id === profile.id)
      if (full) handleP1KeySchemeChange(full.keyScheme)
    },
    [dispatch, selectProfile, profiles, handleP1KeySchemeChange]
  )
  const handleP2ProfileSelect = useCallback(
    (profile: BaseProfile | null) => {
      dispatch(seatColorsActions.setProfileOverride({ seat: 2, color: null }))
      selectProfile(2, profile?.id ?? null)
      const full = profile && profiles.find((p) => p.id === profile.id)
      if (full) handleP2KeySchemeChange(full.keyScheme)
    },
    [dispatch, selectProfile, profiles, handleP2KeySchemeChange]
  )

  // Covers exactly the fields LobbySharedControls itself exposes — board shape/size, pace, and
  // powerups — not the full GameSettings blob. Per-player stuff (colors, key scheme, CPU
  // difficulty) and app-wide prefs (lock orientation) live outside this row and aren't "match
  // settings" in the sense a player means when they ask to shuffle or reset the current round.
  // extendIntoSafeArea is the one exception left inside the row: still a toggle in the same bundled
  // multi-select as wrapEdges (see EXTEND_SAFE_AREA_OPTION above), but deliberately not shuffled
  // here. It now also sets the board's @tastic/core gutter inset (see game.tsx), which makes it a
  // stable "how does the board fit my screen" preference rather than a gameplay variant — a player
  // who's set it to match their device wouldn't want it flipping back on every reshuffle.
  const handleRandomizeMatchSettings = useCallback(() => {
    setSettings({
      gridSizeTier: pickRandom(GRID_SIZE_OPTIONS),
      arenaVariant: pickRandom(ARENA_OPTIONS),
      wrapEdges: Math.random() < 0.5,
      speedTier: pickRandom(SPEED_OPTIONS),
      trailSpeedTier: pickRandom(TRAIL_SPEED_OPTIONS),
      enabledPowerups: POWERUP_ALL_TYPES.filter(() => Math.random() < 0.5)
    })
  }, [setSettings])

  const handleResetMatchSettings = useCallback(() => {
    setSettings({
      gridSizeTier: DEFAULT_SETTINGS.gridSizeTier,
      arenaVariant: DEFAULT_SETTINGS.arenaVariant,
      extendIntoSafeArea: DEFAULT_SETTINGS.extendIntoSafeArea,
      wrapEdges: DEFAULT_SETTINGS.wrapEdges,
      speedTier: DEFAULT_SETTINGS.speedTier,
      trailSpeedTier: DEFAULT_SETTINGS.trailSpeedTier,
      enabledPowerups: DEFAULT_SETTINGS.enabledPowerups
    })
  }, [setSettings])

  const [ready, setReady] = useState<Record<Player, boolean>>({ 1: false, 2: false })

  // Every time this screen (re)gains focus — first arrival from the title screen, or coming back
  // here via the post-game "Lobby" button — Ready starts false again. Without this, popping back to
  // an already-mounted lobby whose players both left it Ready would immediately re-trigger the
  // all-ready effect below and bounce straight back into /game.
  useFocusEffect(
    useCallback(() => {
      setReady({ 1: false, 2: false })
    }, [])
  )

  useEffect(() => {
    if (!humanPlayers.every((p) => ready[p])) return
    // `gameMode` here, not `settings.gameMode` — same race the comment above guards against:
    // this screen's own route param is the trustworthy value, not the settings hook's own
    // (possibly still-loading) copy.
    commitRoundSettings({ ...settings, gameMode })
    router.push('/game')
  }, [ready, humanPlayers, settings, gameMode, commitRoundSettings])

  const bg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'
  const fgMuted = dark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)'

  const isFaceToFace = panelLayout.orientationMode === 'faceToFace'
  // See @tastic/split-screen's needsSharedNeutralZone for the full reasoning (face-to-face two-
  // player is the one arrangement where the top corners sit inside P2's own rotated zone rather
  // than neutral ground) — extracted there once BoxHockey/AirHockey/Snake turned out to have
  // independently hand-duplicated this exact boolean.
  const showMetaInSharedBand = needsSharedNeutralZone(panelLayout.orientationMode, humanPlayers.length)

  // Where P2's own press-away zone lives on screen — matches panelLayout (the already-committed,
  // currently-painted layout), not the live orientationMode/p1OnRight, since it needs to agree with
  // whichever arrangement is actually on screen right now, mid-fade included. Face-to-face always
  // renders P2's panel in the top half (see DualZoneLayout below); side-by-side puts it on whichever
  // side panelLayout.p1OnRight says isn't P1's. Only meaningful in two-player mode — vsCpu's P2/CPU
  // slot shares controlsHost instead (see p2Host below), so it never needs a zone of its own.
  const p2ZoneStyle = gameMode === 'twoPlayer' ? (isFaceToFace ? styles.p2ZoneTop : panelLayout.p1OnRight ? styles.p2ZoneLeft : styles.p2ZoneRight) : null

  // Vs-CPU only has one human slot, so its Ready toggle renders standalone below both panels
  // instead of embedded in P1's own panel — see the solo layout below.
  const showReadyButton = gameMode === 'twoPlayer'
  // P1's own panel and the shared (not player-specific) controls row always share one host —
  // mutually exclusive regardless of game mode, since both sit in the same near/bottom zone and
  // visually collide if left independent (a second popover can open right on top of the first).
  // Vs-CPU additionally folds P2/CPU's panel into this same host: only one human is ever driving
  // both slots there, so having both YOU's and CPU's popovers open at once is just visual clutter,
  // not a useful simultaneous-edit case. Two-player mode keeps P2 on its own independent host,
  // since two real people editing at once is the whole point there.
  const controlsHost = usePopoverHost()
  const p2PanelHost = usePopoverHost()
  // vsCpu folds P2/CPU's panel into the same host as P1 + shared controls (see LobbySharedControls'
  // own comment) — two-player instead keeps p2PanelHost fully independent, and lobby.tsx (rather
  // than PlayerSetupPanel's own internal fallback) owns it explicitly so the press-away zones below
  // can close it without a P1-side tap ever reaching into P2's own popover, or vice versa.
  const p2Host = gameMode === 'vsCpu' ? controlsHost : p2PanelHost
  // Vs-CPU's own standalone Ready button (below, not per-panel — see showReadyButton) is centered
  // under the whole row, not under either player's own trigger, so it doesn't share a center with
  // an open popover the way a two-player panel's *embedded* Ready button does. A side player's
  // popover is centered on that player's own (off-center) trigger instead, so it can't fully cover
  // the wider gap between its edge and the standalone button's — leaving a sliver of the button's
  // own border peeking out from beside/behind the popover. Faded out instead while any player's
  // popover is open, rather than trying to reconcile the two different centers. Same fix and same
  // "p1-"/"p2-" prefix check as BoxHockey/AirHockey/Pong/Snake's own anyPlayerPickerOpen — this was
  // the one sibling that had grown its own inline duplicate of this same host-openId check (see
  // playersRowOpen below) without ever wiring it into the Ready button itself.
  const anyPlayerPickerOpen = !!(controlsHost.openId?.startsWith('p1-') || controlsHost.openId?.startsWith('p2-'))
  // Always 'P1', regardless of game mode — deliberately NOT MatchOverDialog's own 'YOU' fallback:
  // that dialog is a second-person message about the match's own outcome ("YOU WIN!"), where "YOU"
  // reads correctly regardless of profile labeling, but this trigger just needs to match its own
  // sibling seat's "P2" (see p2Panel's guestLabel below) rather than switching words by game mode —
  // see ProfilePicker's own doc for why the trigger uses this instead of "Player" (Player stays as
  // the menu's own row, just not the idle label — using the same word for both would make it
  // impossible to tell "nothing selected yet" from "Player deliberately selected" at a glance).
  const p1GuestLabel = 'P1'

  // Key scheme has no meaning on a swipe-controlled touch device — matches the now-removed local
  // LobbyPlayerPanel's own showKeyScheme gate (computed there per-instance; hoisted here since both
  // seats' pickers need the same answer).
  const isTouchPrimary = useIsTouchPrimaryDevice()
  const showKeyScheme = Platform.OS === 'web' && !isTouchPrimary

  // @tastic/hud's PlayerSetupPanel has no opinion on what (if anything) sits beside the color
  // picker — see its own secondPicker doc — so this app constructs the same SectionedDropdown it
  // always has and hands it in directly, sharing whichever host that seat's own color picker uses
  // so a popover from either one still elevates the shared pickerRow correctly. secondPickerId
  // names the popover id it opens under, so PlayerSetupPanel's own "elevate while one of my own
  // popovers is open" logic still reacts to it exactly as it did when this lived inside
  // LobbyPlayerPanel itself.
  const p1KeySchemePicker = showKeyScheme ? <SectionedDropdown id='p1-controls' host={controlsHost} icon='keyboard-outline' accessibilityLabel='Control scheme' sections={[{ kind: 'single', id: 'controls', options: KEY_SCHEME_OPTIONS, value: settings.keyScheme[1], onChange: handleP1KeySchemeChange, takenValue: p2IsHuman ? settings.keyScheme[2] : undefined }]} accentColor={p1Color} mutedColor={fgMuted} dark={dark} /> : undefined
  // CPU slot (vsCpu, !p2IsHuman) gets no key-scheme picker at all, same as the touch/non-web case —
  // matches the old isHuman-gated check that used to live inside LobbyPlayerPanel itself.
  const p2KeySchemePicker = p2IsHuman && showKeyScheme ? <SectionedDropdown id='p2-controls' host={p2Host} icon='keyboard-outline' accessibilityLabel='Control scheme' sections={[{ kind: 'single', id: 'controls', options: KEY_SCHEME_OPTIONS, value: settings.keyScheme[2], onChange: handleP2KeySchemeChange, takenValue: settings.keyScheme[1] }]} accentColor={p2Color} mutedColor={fgMuted} dark={dark} /> : undefined

  // Unlike cpuDifficultyAlignOverride below (a confirmed no-op — the CPU-difficulty picker only
  // ever renders outside a split-screen zone), every seat's color picker can render inside a live
  // DualZoneLayout zone in twoPlayer mode, so both p1Panel and p2Panel need their own
  // colorAlignOverride, computed unconditionally rather than gated on isHuman/p2IsHuman the way
  // the CPU-difficulty one is. Both panels pass the same swatches (defaultColors), so their
  // pickers share one content size, computed once here rather than twice.
  const { width: windowWidth } = useWindowDimensions()
  const colorContentSize = getInlineColorPickerContentSize(defaultColors.length, windowWidth)
  const p1ColorOpen = controlsHost.openId === getColorPopoverId('p1')
  const p1ColorAlign = useZoneClampedAlign(p1ColorOpen, colorContentSize.width, colorContentSize.height)
  const p2ColorOpen = p2Host.openId === getColorPopoverId('p2')
  const p2ColorAlign = useZoneClampedAlign(p2ColorOpen, colorContentSize.width, colorContentSize.height)

  const p1Panel = <PlayerSetupPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Color} allowSwapTaken={gameMode === 'vsCpu'} colorAlignOverride={p1ColorAlign} isHuman secondPicker={p1KeySchemePicker} secondPickerId={showKeyScheme ? 'p1-controls' : undefined} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} profiles={profiles} selectedProfileId={lastSelected[1]} takenProfileId={p2IsHuman ? lastSelected[2] : null} guestLabel={p1GuestLabel} onProfileSelect={handleP1ProfileSelect} onManageProfiles={() => router.push('/profiles')} />
  // P2/CPU centers its own popovers just like P1 — playersRowSpaced's gap already keeps it clear of
  // the screen's right edge (see that style's own comment), so there's no overflow to guard against.
  //
  // cpuDifficulty below renders through PlayerSetupPanel's own internal LabeledDropdown.
  // PlayerSetupPanel now accepts cpuDifficultyAlignOverride (added to @tastic/hud specifically to
  // close this gap — this app originated useZoneClampedAlign, and 4 sibling apps' own migration
  // agents independently found they couldn't wire it into this exact picker for lack of this prop),
  // so it's wired in below for consistency with every other popover in this app. It's a confirmed
  // no-op here, though, same conclusion as before this prop existed: the CPU-difficulty picker only
  // ever renders for a non-human seat 2, which only exists in vsCpu mode, and vsCpu always renders
  // in the plain stacked (non-DualZoneLayout) branch below, never inside a split-screen zone — so
  // useZoneBounds() is null there regardless, and useZoneClampedAlign's own doc says it returns
  // useAutoAlign's plain result unchanged whenever that's the case.
  const p2CpuDifficultyOpen = p2Host.openId === getCpuDifficultyPopoverId('p2')
  const p2CpuDifficultyAlign = useZoneClampedAlign(p2CpuDifficultyOpen, LABELED_DROPDOWN_POPOVER_WIDTH, getLabeledDropdownContentHeight(CPU_DIFFICULTY_OPTIONS.length))
  const p2Panel = (
    <PlayerSetupPanel
      idPrefix='p2'
      host={p2Host}
      color={p2Color}
      onColorChange={handleP2ColorChange}
      swatches={defaultColors}
      takenColor={p1Color}
      allowSwapTaken={gameMode === 'vsCpu'}
      colorAlignOverride={p2ColorAlign}
      isHuman={p2IsHuman}
      secondPicker={p2KeySchemePicker}
      secondPickerId={p2IsHuman && showKeyScheme ? 'p2-controls' : undefined}
      ready={p2IsHuman ? ready[2] : undefined}
      onToggleReady={p2IsHuman ? () => setReady((r) => ({ ...r, 2: !r[2] })) : undefined}
      dark={dark}
      showReadyButton={showReadyButton}
      profiles={p2IsHuman ? profiles : undefined}
      selectedProfileId={lastSelected[2]}
      takenProfileId={lastSelected[1]}
      guestLabel='P2'
      onProfileSelect={p2IsHuman ? handleP2ProfileSelect : undefined}
      cpuDifficulty={p2IsHuman ? undefined : settings.cpuDifficulty}
      cpuDifficultyOptions={p2IsHuman ? undefined : CPU_DIFFICULTY_OPTIONS}
      cpuDifficultyAlignOverride={p2IsHuman ? undefined : p2CpuDifficultyAlign}
      onCpuDifficultyChange={p2IsHuman ? undefined : (value: CpuDifficulty) => setSettings({ cpuDifficulty: value })}
    />
  )

  // Orientation is an app-wide preference now (see SettingsDialog), not a per-round choice here —
  // this row no longer takes orientationMode/orientationOptions/onOrientationChange at all.
  const sharedControlsRow = (
    <LobbySharedControls
      host={controlsHost}
      gridSizeTier={settings.gridSizeTier}
      gridSizeOptions={GRID_SIZE_OPTIONS}
      onGridSizeChange={(value) => setSettings({ gridSizeTier: value })}
      speedTier={settings.speedTier}
      speedOptions={SPEED_OPTIONS}
      onSpeedChange={(value) => setSettings({ speedTier: value })}
      trailSpeedTier={settings.trailSpeedTier}
      trailSpeedOptions={TRAIL_SPEED_OPTIONS}
      onTrailSpeedChange={(value) => setSettings({ trailSpeedTier: value })}
      arenaVariant={settings.arenaVariant}
      arenaOptions={ARENA_OPTIONS}
      onArenaChange={(value) => setSettings({ arenaVariant: value })}
      extendIntoSafeArea={settings.extendIntoSafeArea}
      extendIntoSafeAreaOption={EXTEND_SAFE_AREA_OPTION}
      onExtendIntoSafeAreaChange={(value: boolean) => setSettings({ extendIntoSafeArea: value })}
      wrapEdges={settings.wrapEdges}
      wrapEdgesOption={WRAP_EDGES_OPTION}
      onWrapEdgesChange={(value: boolean) => setSettings({ wrapEdges: value })}
      enabledPowerups={settings.enabledPowerups}
      powerupOptions={POWERUP_OPTIONS}
      onPowerupsChange={(value: PowerupType[]) => setSettings({ enabledPowerups: value })}
      // Omitted (leaving LobbySharedControls' own actionsRow unrendered) whenever
      // showMetaInSharedBand is about to fold randomize/reset into its own merged header row below
      // instead — otherwise both would render at once.
      onRandomize={showMetaInSharedBand ? undefined : handleRandomizeMatchSettings}
      onReset={showMetaInSharedBand ? undefined : handleResetMatchSettings}
      accentColor={themeColors.tertiary}
      mutedColor={fgMuted}
      onAccentColor={themeColors.onTertiary}
      dark={dark}
    />
  )

  // Only wrapped for showMetaInSharedBand (see its own comment above) — everywhere else back/
  // settings stay in their usual top corners (CornerActionButtons below) and randomize/reset stay
  // in LobbySharedControls' own row below the trigger gauges. SharedActionBand itself owns the
  // "is the open popover actually one of mine" self-elevation check internally, given just the
  // resolved boolean below — see that component's own doc for why it needs to run that check on
  // itself rather than relying on LobbySharedControls' own internal elevation.
  const sharedControlsPopoverOpen = controlsHost.openId !== null && LOBBY_SHARED_CONTROLS_IDS.includes(controlsHost.openId)
  const sharedControls = showMetaInSharedBand ? (
    <SharedActionBand onBack={safeBack} onSettings={() => setSettingsOpen(true)} onRandomize={handleRandomizeMatchSettings} onReset={handleResetMatchSettings} fg={fg} popoverOpen={sharedControlsPopoverOpen}>
      {sharedControlsRow}
    </SharedActionBand>
  ) : (
    sharedControlsRow
  )

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      {/* Everything below reads correctly no matter which way the phone is actually being held —
      see @tastic/split-screen's FakeLandscapeView for why this is needed at all now that the app
      is portrait-locked at the OS level (no more real OS rotation to rely on). Driven by panelLayout
      (the same committed, already-fade-masked state DualZoneLayout itself renders from), not the
      live orientationMode/p1OnRight/upsideDown above, so the visual rotation change and the panel
      swap/reorder always land in the same fade-covered moment instead of one snapping ahead of the
      other. SettingsDialog is deliberately left outside this wrapper — it renders as a centered
      modal overlay via Portal, unaffected by (and not needing) this transform — and so is the
      dev-only debug overlay below, which needs to stay legible regardless of whatever orientation
      it's currently reporting. Manage Profiles has moved off this screen entirely now (see
      app/profiles.tsx), so there's nothing of its own left to consider here. */}
      <FakeLandscapeView orientationMode={panelLayout.orientationMode} p1OnRight={panelLayout.p1OnRight} upsideDown={panelLayout.upsideDown} style={styles.rotatable}>
        {/* Press-away overlays for the lobby's own popovers (color pickers, control dropdowns) — see
        PressAwayOverlay's own comment for the paint-order trick that keeps real controls directly
        tappable. P1's covers the whole screen (their own panel plus every shared setting reads as
        "theirs" — see LobbySharedControls), while P2's is scoped to just their own half (p2ZoneStyle)
        and, being a later sibling, takes priority over P1's within that rect.

        P2's overlay has to mount whenever *either* host has something open, not just p2Host — P1's
        popover being open is exactly when P1's full-screen overlay is sitting underneath P2's zone
        too, and if P2's own overlay were absent then (p2Host closed), a tap anywhere on P2's side
        would fall straight through to P1's and close P1's dialog. Mounting it any time controlsHost
        is open too — even though its own onPress (p2Host.close) is then a no-op — makes it "shield"
        P2's zone from P1's overlay unconditionally, which is what actually keeps P2's side exempt
        from P1's press-away regardless of whether P2 has anything open. */}
        <PressAwayOverlay active={controlsHost.openId !== null} onPress={controlsHost.close} />
        {p2ZoneStyle && <PressAwayOverlay active={controlsHost.openId !== null || p2Host.openId !== null} onPress={p2Host.close} style={p2ZoneStyle} />}

        {/* Same top-right slot as the title screen's own cog (index.tsx) — settings stays reachable
        from the same place whether a player opens it before or after picking a mode. */}
        {!showMetaInSharedBand && <CornerActionButtons onBack={safeBack} onSettings={() => setSettingsOpen(true)} fg={fg} insets={rotatedInsets} />}

        {gameMode === 'twoPlayer' ? (
          // See @tastic/split-screen's DualZoneLayout for the face-to-face-vs-side-by-side switch
          // and its own note on why P1's zone stays unrotated while P2's rotates 180° in face-to-face.
          <DualZoneLayout
            panelLayout={panelLayout}
            panelFadeStyle={panelFadeStyle}
            p1={p1Panel}
            p2={p2Panel}
            shared={sharedControls}
            // Without these, a popover escaping its own zone (e.g. the shared arena dropdown
            // growing down into P1/P2's row below it) paints underneath whichever zone happens to
            // be the later DOM sibling, regardless of which one actually has something open — see
            // DualZoneLayout's own p1Elevated/p2Elevated/sharedElevated doc for the stacking-context
            // reason a zone can't just self-elevate the way PlayerSetupPanel/LobbySharedControls
            // already do internally. Same openId checks those two components use for their own
            // internal elevation, just re-run here for the outer zone wrapper neither of them can
            // reach on its own.
            p1Elevated={controlsHost.openId?.startsWith('p1-') ?? false}
            p2Elevated={p2Host.openId !== null}
            sharedElevated={sharedControlsPopoverOpen}
          />
        ) : (
          <View style={styles.stackedZone}>
            {sharedControls}
            {/* See SectionedDropdown's anchorOpen comment — the standalone Ready button below is a later
            sibling of this row, so a popover escaping it (from either panel, since both share
            controlsHost) needs the row itself elevated to paint above that Ready button. Checking
            for a "p1-"/"p2-" id specifically, not just "is anything open on the host" — sharedControls
            also shares this host, and elevating this row for *its* popovers too would tie the two,
            letting DOM order wrongly decide which one paints on top (see PlayerSetupPanel and
            LobbySharedControls' matching ownPopoverOpen checks). */}
            <Animated.View style={[styles.playersRow, anyPlayerPickerOpen && styles.playersRowOpen, panelFadeStyle]}>
              {isSideBySide && panelLayout.p1OnRight ? p2Panel : p1Panel}
              {isSideBySide && panelLayout.p1OnRight ? p1Panel : p2Panel}
            </Animated.View>
            <ReadyButton color={p1Color} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} style={anyPlayerPickerOpen && styles.readyButtonHidden} />
          </View>
        )}
      </FakeLandscapeView>

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings} rotation={rotation} showHowToPlay />
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1
  },
  p2ZoneLeft: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    top: 0,
    width: '50%'
  },
  p2ZoneRight: {
    bottom: 0,
    position: 'absolute',
    right: 0,
    top: 0,
    width: '50%'
  },
  p2ZoneTop: {
    height: '50%',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0
  },
  // Matches PlayerSetupPanel's own pickerRow gap (12), not a wider "these are two separate
  // panels" gap — matches BoxHockey/AirHockey/Pong/Snake's identical playersRow: the human and
  // CPU panels read as one evenly spaced row of triggers this way, rather than two
  // independently-centered blocks whose different widths throw off screen-edge symmetry. Applies
  // in both portrait and landscape/side-by-side — no separate wider gap for landscape.
  playersRow: {
    flexDirection: 'row',
    gap: 12
  },
  playersRowOpen: {
    zIndex: 100
  },
  // See anyPlayerPickerOpen above — opacity 0 (not display:'none') so the button keeps its layout
  // space and doesn't shift the row above it when it disappears/reappears. pointerEvents:'none' too
  // — otherwise the sliver an open popover doesn't cover would still be a live, just-invisible tap
  // target underneath it.
  readyButtonHidden: {
    opacity: 0,
    pointerEvents: 'none'
  },
  // Owns the flex-centering layout `container` used to apply directly — now one level deeper,
  // since everything visible sits inside FakeLandscapeView, which needs a real (not shrink-wrapped)
  // full-bleed box to size its own absolutely-positioned children (PressAwayOverlay, back/settings
  // buttons) against correctly.
  rotatable: {
    alignItems: 'center',
    flex: 1,
    gap: 32,
    justifyContent: 'center',
    paddingHorizontal: 16
  },
  stackedZone: {
    alignItems: 'center',
    gap: 28
  }
})
