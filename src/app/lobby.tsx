import { defaultColors, getThirdColor, useAutoPaperTheme, useThemeSettings } from '@rific/auto-paper'
import { IconButton } from '@rific/feedback-press'
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { StyleSheet, View } from 'react-native'
import Animated, { runOnJS, useAnimatedReaction, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { LobbyPlayerPanel } from '@/components/LobbyPlayerPanel'
import { LobbySharedControls } from '@/components/LobbySharedControls'
import { PowerupPickerOption } from '@/components/PowerupPicker'
import { ReadyButton } from '@/components/ReadyButton'
import { SettingsDialog } from '@/components/SettingsDialog'
import { LOBBY_PANEL_SWAP_FADE_MS, POWERUP_ICONS } from '@/constants/game'
import { useDeviceOrientation } from '@/hooks/useDeviceOrientation'
import { useGameSettings } from '@/hooks/useGameSettings'
import { useOrientationLock } from '@/hooks/useOrientationLock'
import { useP1OnRight } from '@/hooks/useP1OnRight'
import { usePopoverHost } from '@/hooks/usePopoverHost'
import { CpuDifficulty, GridSizeTier, KeyScheme, Player, PowerupType, SpeedTier, TrailGrowthTier } from '@/types'
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

// Small -> full growth stages, echoing the same playful-tier convention as the other rows. Named
// for how fast the tail follows the head, not the outcome — a "Short"/"Full"-style outcome label
// implied a fixed length the trail settles at, but it never actually does under any tier (still
// grows without bound, just slower than 1:1 when the tail follows — see gameEngine.ts's
// shouldTrimTrailAt). No description text on fast/slow (same as grid size/speed/CPU difficulty
// above) — players learn what each does by trying it. 'static' gets one anyway: it's the game's
// original behavior, and "this is the one you already know" is useful context a blind try can't
// give you, unlike fast/slow which are self-explanatory enough to just test.
const TRAIL_GROWTH_OPTIONS: { value: TrailGrowthTier; label: string; description?: string; icon: string }[] = [
  { value: 'fast', label: 'Fast', icon: 'seed-outline' },
  { value: 'slow', label: 'Slow', icon: 'sprout-outline' },
  { value: 'static', label: 'Static', description: 'Classic', icon: 'tree-outline' }
]

// Icons match POWERUP_ICONS exactly — the same glyph a held item shows in PowerupHud.tsx once
// revealed, so a player who's already seen one in a HUD badge recognizes it here too.
const POWERUP_OPTIONS: PowerupPickerOption[] = [
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
  // behind the live orientationMode/p1OnRight above — see panelOpacity below. Everything else on
  // this screen (the back/settings buttons, shared controls, Ready button) reads the live values
  // directly and never re-positions, so nothing about it needs masking.
  const [panelLayout, setPanelLayout] = useState({ orientationMode, p1OnRight })
  const panelOpacity = useSharedValue(1)
  // Both directions live in this one reaction (panelOpacity's only writer — see HeroTitleTrails.tsx's
  // identical one-writer-per-value note) rather than a useEffect for the fade-out plus a second
  // reaction for the fade-in. That split would let the fade-in start climbing back to 1 the instant
  // setPanelLayout is *called*, racing ahead of the JS-thread commit that actually mounts the new
  // branch/order — the exact bug this whole feature exists to avoid. Comparing live values against
  // the already-committed panelLayout instead means the fade-in only fires once they've caught up,
  // i.e. once the new layout is actually the one on screen.
  //
  // The 'unresolved' phase exists so a fresh navigation to this screen doesn't itself fade: p1OnRight
  // starts as a guess (see useP1OnRight) and corrects itself moments later once its own initial
  // orientation check resolves — that correction isn't a real rotation, so it snaps straight to the
  // right layout instead of fading like an actual mid-lobby rotation would.
  useAnimatedReaction(
    () => {
      if (!p1OnRightResolved) return 'unresolved'
      return `${orientationMode}:${p1OnRight}` === `${panelLayout.orientationMode}:${panelLayout.p1OnRight}` ? 'match' : 'mismatch'
    },
    (phase, previousPhase) => {
      if (previousPhase === null || phase === previousPhase) return
      if (phase === 'match') {
        if (previousPhase === 'mismatch') panelOpacity.value = withTiming(1, { duration: LOBBY_PANEL_SWAP_FADE_MS })
        return
      }
      if (previousPhase === 'unresolved') {
        runOnJS(setPanelLayout)({ orientationMode, p1OnRight })
        return
      }
      panelOpacity.value = withTiming(0, { duration: LOBBY_PANEL_SWAP_FADE_MS }, (finished) => {
        if (finished) runOnJS(setPanelLayout)({ orientationMode, p1OnRight })
      })
    }
  )
  const panelFadeStyle = useAnimatedStyle(() => ({ opacity: panelOpacity.value }))
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
  const sharedHost = gameMode === 'vsCpu' ? controlsHost : undefined
  const p1Panel = <LobbyPlayerPanel idPrefix='p1' host={controlsHost} color={p1Color} onColorChange={handleP1ColorChange} swatches={defaultColors} takenColor={p2Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman keyScheme={settings.keyScheme[1]} onKeySchemeChange={(scheme: KeyScheme) => setSettings({ keyScheme: { ...settings.keyScheme, 1: scheme } })} otherKeyScheme={p2IsHuman ? settings.keyScheme[2] : undefined} ready={ready[1]} onToggleReady={() => setReady((r) => ({ ...r, 1: !r[1] }))} dark={dark} showReadyButton={showReadyButton} />
  // P2/CPU centers its own popovers just like P1 — playersRowSpaced's gap already keeps it clear of
  // the screen's right edge (see that style's own comment), so there's no overflow to guard against.
  const p2Panel = <LobbyPlayerPanel idPrefix='p2' host={sharedHost} color={p2Color} onColorChange={handleP2ColorChange} swatches={defaultColors} takenColor={p1Color} allowSwapTaken={gameMode === 'vsCpu'} isHuman={p2IsHuman} keyScheme={p2IsHuman ? settings.keyScheme[2] : undefined} onKeySchemeChange={p2IsHuman ? (scheme: KeyScheme) => setSettings({ keyScheme: { ...settings.keyScheme, 2: scheme } }) : undefined} otherKeyScheme={p2IsHuman ? settings.keyScheme[1] : undefined} ready={p2IsHuman ? ready[2] : undefined} onToggleReady={p2IsHuman ? () => setReady((r) => ({ ...r, 2: !r[2] })) : undefined} dark={dark} showReadyButton={showReadyButton} />

  // Orientation is an app-wide preference now (see SettingsDialog), not a per-round choice here —
  // this row no longer takes orientationMode/orientationOptions/onOrientationChange at all.
  const sharedControls = <LobbySharedControls host={controlsHost} gridSizeTier={settings.gridSizeTier} gridSizeOptions={GRID_SIZE_OPTIONS} onGridSizeChange={(value) => setSettings({ gridSizeTier: value })} speedTier={settings.speedTier} speedOptions={SPEED_OPTIONS} onSpeedChange={(value) => setSettings({ speedTier: value })} trailGrowthTier={settings.trailGrowthTier} trailGrowthOptions={TRAIL_GROWTH_OPTIONS} onTrailGrowthChange={(value) => setSettings({ trailGrowthTier: value })} enabledPowerups={settings.enabledPowerups} powerupOptions={POWERUP_OPTIONS} onPowerupsChange={(value: PowerupType[]) => setSettings({ enabledPowerups: value })} cpuDifficulty={gameMode === 'vsCpu' ? settings.cpuDifficulty : undefined} cpuDifficultyOptions={gameMode === 'vsCpu' ? CPU_DIFFICULTY_OPTIONS : undefined} onCpuDifficultyChange={gameMode === 'vsCpu' ? (value: CpuDifficulty) => setSettings({ cpuDifficulty: value }) : undefined} accentColor={themeColors.tertiary} mutedColor={fgMuted} dark={dark} />

  return (
    <View style={[styles.container, { backgroundColor: bg }]}>
      <IconButton icon='arrow-left' iconColor={fg} size={24} style={[styles.back, { top: 8 + insets.top, left: 8 + insets.left }]} onPress={safeBack} />
      {/* Same top-right slot as the title screen's own cog (index.tsx) — settings stays reachable
      from the same place whether a player opens it before or after picking a mode. */}
      <IconButton icon='cog' iconColor={fg} size={24} style={[styles.topRight, { top: 8 + insets.top, right: 8 + insets.right }]} onPress={() => setSettingsOpen(true)} accessibilityLabel='Settings' />

      {gameMode === 'twoPlayer' ? (
        isFaceToFace ? (
          // Player 1 is assumed to be the device's owner, so the near/bottom zone (unrotated)
          // faces them; player 2 is the "far" player (see turnIntent.ts's own flip convention), so
          // their zone is rotated 180° to face them from the opposite side of the device — a
          // shared title above both would only ever read right-side-up for one of them, so there
          // isn't one here.
          <View style={styles.dualZone}>
            <Animated.View style={[styles.rotated180, panelFadeStyle]}>{p2Panel}</Animated.View>
            {sharedControls}
            <Animated.View style={panelFadeStyle}>{p1Panel}</Animated.View>
          </View>
        ) : (
          // Side-by-side: both players sit shoulder-to-shoulder, so the shared controls sit in
          // their own row above, rather than squeezed into the narrow column between them. Only
          // reached once the phone is actually held in landscape (orientationMode tracks that
          // live), so playersRow's plain left/right split lands as a roomy pair of full-height
          // zones — spaced well apart (playersRowSpaced) since there's real width to spend now,
          // rather than the cramped, barely-gapped columns a portrait split would force.
          <View style={styles.stackedZone}>
            {sharedControls}
            <Animated.View style={[styles.playersRow, styles.playersRowSpaced, panelFadeStyle]}>
              {panelLayout.p1OnRight ? p2Panel : p1Panel}
              {panelLayout.p1OnRight ? p1Panel : p2Panel}
            </Animated.View>
          </View>
        )
      ) : (
        <View style={styles.stackedZone}>
          {sharedControls}
          {/* See IconDropdown's anchorOpen comment — the standalone Ready button below is a later
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
  dualZone: {
    alignItems: 'center',
    gap: 28
  },
  playersRow: {
    flexDirection: 'row',
    gap: 40
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
  rotated180: {
    transform: [{ rotate: '180deg' }]
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
