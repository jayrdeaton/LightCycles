import { defaultColors, getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { IconButton } from '@rific/feedback-press'
import { MenuOption, PressAwayOverlay, ReadyButton, usePopoverHost } from '@tastic/hud'
import { DualZoneLayout, useDeviceOrientation, useDualZoneLayout, useOrientationLock, useP1OnRight } from '@tastic/split-screen'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { LobbyPlayerPanel } from '@/components/LobbyPlayerPanel'
import { LobbySharedControls } from '@/components/LobbySharedControls'
import { SettingsDialog } from '@/components/SettingsDialog'
import { LOBBY_PANEL_SWAP_FADE_MS, POWERUP_ICONS } from '@/constants/game'
import { useGameSettings } from '@/hooks/useGameSettings'
import { CpuDifficulty, GridSizeTier, KeyScheme, Player, PowerupType, SpeedTier, TrailSpeedTier } from '@/types'
import { humanPlayersFor, parseGameMode } from '@/utils/gameParams'
import { safeBack } from '@/utils/navigation'

// Small -> large vehicles, echoing the game's own light-cycle theme rather than a generic S/M/L
// badge. MDI's name for the first is 'motorbike', not 'motorcycle'.
const GRID_SIZE_OPTIONS: { value: GridSizeTier; label: string; icon: string }[] = [
  { value: 'small', label: 'Small', icon: 'motorbike' },
  { value: 'medium', label: 'Medium', icon: 'car' },
  { value: 'large', label: 'Large', icon: 'train' }
]

const SPEED_OPTIONS: { value: SpeedTier; label: string; icon: string }[] = [
  { value: 'slow', label: 'Slow', icon: 'snail' },
  { value: 'normal', label: 'Normal', icon: 'tortoise' },
  { value: 'fast', label: 'Fast', icon: 'rabbit' }
]

// Escalating expression, echoing the same playful-tier convention as grid size's vehicles and
// speed's animals rather than a plain skill-level label.
const CPU_DIFFICULTY_OPTIONS: { value: CpuDifficulty; label: string; icon: string }[] = [
  { value: 'easy', label: 'Easy', icon: 'emoticon-happy-outline' },
  { value: 'normal', label: 'Normal', icon: 'emoticon-neutral-outline' },
  { value: 'hard', label: 'Hard', icon: 'emoticon-devil-outline' }
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

export default function LobbyScreen() {
  // Read only from this screen's own route param, never from useGameSettings().gameMode — the
  // settings hook's AsyncStorage read is async, and racing it here could momentarily show the
  // wrong number of player panels.
  const params = useLocalSearchParams<{ gameMode: string }>()
  const gameMode = useMemo(() => parseGameMode(params.gameMode), [params.gameMode])
  const humanPlayers = useMemo(() => humanPlayersFor({ gameMode }), [gameMode])

  const { settings, setSettings, commitRoundSettings } = useGameSettings()
  // orientationMode just follows the device's current physical shape (see useDeviceOrientation),
  // CPU games included — how you're holding the phone right now decides the layout, not a stored
  // per-round choice. This is what actually lets two players sit shoulder-to-shoulder and pick a
  // color/control scheme at the same time once the phone is turned sideways, instead of squeezing
  // two panels into a portrait-narrow row — and for vs-CPU, it's simply whichever way the solo
  // player is holding it. Lock Orientation (see SettingsDialog) is the opt-in for pinning it.
  const orientationMode = useDeviceOrientation()
  useOrientationLock(settings.lockOrientation, orientationMode)
  const { p1OnRight, resolved: p1OnRightResolved } = useP1OnRight()

  // The panel area's own layout (which branch renders, which side each panel is on) lags one fade
  // behind the live orientationMode/p1OnRight above — see useDualZoneLayout's own comment. Everything
  // else on this screen (the back/settings buttons, shared controls, Ready button) reads the live
  // values directly and never re-positions, so nothing about it needs masking. Also drives the solo
  // (vs-CPU) branch's own row below — that one doesn't rotate anything, but still reorders/fades
  // across a portrait<->landscape change the same way.
  const { panelLayout, panelFadeStyle } = useDualZoneLayout(orientationMode, p1OnRight, p1OnRightResolved, LOBBY_PANEL_SWAP_FADE_MS)
  const isSideBySide = panelLayout.orientationMode === 'sideBySide'

  const [settingsOpen, setSettingsOpen] = useState(false)
  const insets = useSafeAreaInsets()
  const { colors: themeColors, dark } = useAutoPaperTheme()
  const { set: setThemeColor } = useThemeSettings()
  const p1Color = themeColors.primary
  const p2Color = themeColors.secondary

  // Picking the other slot's exact current color swaps the two instead of no-op'ing — only
  // reachable at all when that slot's own picker allowed it (InlineColorPicker's allowSwapTaken:
  // vs-CPU only, where the "other" color is just the CPU's, not a second real person's choice).
  const handleP1ColorChange = useCallback(
    (hex: string) => {
      const nextP2 = hex.toLowerCase() === p2Color.toLowerCase() ? p1Color : p2Color
      setThemeColor({ color: { primary: hex, secondary: nextP2, tertiary: getThirdColor(hex, nextP2) } })
    },
    [setThemeColor, p1Color, p2Color]
  )
  const handleP2ColorChange = useCallback(
    (hex: string) => {
      const nextP1 = hex.toLowerCase() === p1Color.toLowerCase() ? p2Color : p1Color
      setThemeColor({ color: { primary: nextP1, secondary: hex, tertiary: getThirdColor(nextP1, hex) } })
    },
    [setThemeColor, p1Color, p2Color]
  )

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

  const p2IsHuman = humanPlayers.includes(2)
  const isFaceToFace = panelLayout.orientationMode === 'faceToFace'

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
  // than LobbyPlayerPanel's own internal fallback) owns it explicitly so the press-away zones below
  // can close it without a P1-side tap ever reaching into P2's own popover, or vice versa.
  const p2Host = gameMode === 'vsCpu' ? controlsHost : p2PanelHost
  const p1Panel = <LobbyPlayerPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman keyScheme={settings.keyScheme[1]} onKeySchemeChange={(scheme: KeyScheme) => setSettings({ keyScheme: { ...settings.keyScheme, 1: scheme } })} otherKeyScheme={p2IsHuman ? settings.keyScheme[2] : undefined} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} />
  // P2/CPU centers its own popovers just like P1 — playersRowSpaced's gap already keeps it clear of
  // the screen's right edge (see that style's own comment), so there's no overflow to guard against.
  const p2Panel = <LobbyPlayerPanel idPrefix='p2' host={p2Host} color={p2Color} onColorChange={handleP2ColorChange} swatches={defaultColors} takenColor={p1Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman={p2IsHuman} keyScheme={p2IsHuman ? settings.keyScheme[2] : undefined} onKeySchemeChange={p2IsHuman ? (scheme: KeyScheme) => setSettings({ keyScheme: { ...settings.keyScheme, 2: scheme } }) : undefined} otherKeyScheme={p2IsHuman ? settings.keyScheme[1] : undefined} ready={p2IsHuman ? ready[2] : undefined} onToggleReady={p2IsHuman ? () => setReady((r) => ({ ...r, 2: !r[2] })) : undefined} dark={dark} showReadyButton={showReadyButton} />

  // Orientation is an app-wide preference now (see SettingsDialog), not a per-round choice here —
  // this row no longer takes orientationMode/orientationOptions/onOrientationChange at all.
  const sharedControls = (
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
      enabledPowerups={settings.enabledPowerups}
      powerupOptions={POWERUP_OPTIONS}
      onPowerupsChange={(value: PowerupType[]) => setSettings({ enabledPowerups: value })}
      cpuDifficulty={gameMode === 'vsCpu' ? settings.cpuDifficulty : undefined}
      cpuDifficultyOptions={gameMode === 'vsCpu' ? CPU_DIFFICULTY_OPTIONS : undefined}
      onCpuDifficultyChange={gameMode === 'vsCpu' ? (value: CpuDifficulty) => setSettings({ cpuDifficulty: value }) : undefined}
      accentColor={themeColors.tertiary}
      mutedColor={fgMuted}
      onAccentColor={themeColors.onTertiary}
      dark={dark}
    />
  )

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
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

      <IconButton icon='arrow-left' iconColor={fg} size={24} style={[styles.back, { top: 8 + insets.top, left: 8 + insets.left }]} onPress={safeBack} />
      {/* Same top-right slot as the title screen's own cog (index.tsx) — settings stays reachable
      from the same place whether a player opens it before or after picking a mode. */}
      <IconButton icon='cog' iconColor={fg} size={24} style={[styles.topRight, { top: 8 + insets.top, right: 8 + insets.right }]} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />

      {gameMode === 'twoPlayer' ? (
        // See @tastic/split-screen's DualZoneLayout for the face-to-face-vs-side-by-side switch
        // and its own note on why P1's zone stays unrotated while P2's rotates 180° in face-to-face.
        <DualZoneLayout panelLayout={panelLayout} panelFadeStyle={panelFadeStyle} p1={p1Panel} p2={p2Panel} shared={sharedControls} />
      ) : (
        <View style={styles.stackedZone}>
          {sharedControls}
          {/* See SectionedDropdown's anchorOpen comment — the standalone Ready button below is a later
          sibling of this row, so a popover escaping it (from either panel, since both share
          controlsHost) needs the row itself elevated to paint above that Ready button. Checking
          for a "p1-"/"p2-" id specifically, not just "is anything open on the host" — sharedControls
          also shares this host, and elevating this row for *its* popovers too would tie the two,
          letting DOM order wrongly decide which one paints on top (see LobbyPlayerPanel and
          LobbySharedControls' matching ownPopoverOpen checks). */}
          <Animated.View style={[styles.playersRow, isSideBySide && styles.playersRowSpaced, (controlsHost.openId?.startsWith('p1-') || controlsHost.openId?.startsWith('p2-')) && styles.playersRowOpen, panelFadeStyle]}>
            {isSideBySide && panelLayout.p1OnRight ? p2Panel : p1Panel}
            {isSideBySide && panelLayout.p1OnRight ? p1Panel : p2Panel}
          </Animated.View>
          <ReadyButton color={p1Color} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} />
        </View>
      )}

      <SettingsDialog visible={settingsOpen} onDismiss={() => setSettingsOpen(false)} settings={settings} setSettings={setSettings} />
    </View>
  )
}

const styles = StyleSheet.create({
  back: {
    left: 8,
    position: 'absolute',
    top: 8
  },
  container: {
    alignItems: 'center',
    flex: 1,
    gap: 32,
    justifyContent: 'center',
    paddingHorizontal: 16
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
  // Matches LobbyPlayerPanel's own pickerRow gap (12), not some wider "these are two separate
  // panels" gap — vsCpu's human slot (color + key scheme, web-only) and CPU slot (color only) read
  // as one evenly spaced row of triggers this way, rather than two independently-centered blocks
  // whose different widths throw off screen-edge symmetry. See BoxHockey's identical fix (loadout.tsx's
  // own playersRow) for the sibling issue this mirrors. Portrait-only — see playersRowSpaced below
  // for why landscape needs a much wider gap instead.
  playersRow: {
    flexDirection: 'row',
    gap: 12
  },
  playersRowOpen: {
    zIndex: 100
  },
  // Side-by-side only applies once the phone is actually held in landscape, which is genuinely
  // wide, so the two zones get real breathing room between them instead of playersRow's own
  // tight, portrait-tuned gap. Wide enough that each player's popovers (color swatch grid,
  // control-scheme dropdown) stay clear of the other's reach even when both are open at once.
  playersRowSpaced: {
    gap: 180
  },
  stackedZone: {
    alignItems: 'center',
    gap: 28
  },
  topRight: {
    position: 'absolute',
    right: 8,
    top: 8
  }
})
