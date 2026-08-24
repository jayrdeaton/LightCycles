import { MenuOption, PopoverHost, SectionedDropdown, usePopoverHost } from '@tastic/hud'
import { StyleSheet, View } from 'react-native'

import { CpuDifficulty, GridSizeTier, PowerupType, SpeedTier, TrailSpeedTier } from '@/types'

interface Props {
  // Shared popover host — see LobbyPlayerPanel's identical `host` prop. Passed in vs-CPU mode so
  // grid size/speed/CPU difficulty are mutually exclusive with the player panels' own color/control
  // pickers too (there's only one human driving the whole screen there, so simultaneity across
  // every picker just adds clutter). Omit to fall back to this component's own independent host.
  host?: PopoverHost
  gridSizeTier: GridSizeTier
  gridSizeOptions: MenuOption<GridSizeTier>[]
  onGridSizeChange: (value: GridSizeTier) => void
  speedTier: SpeedTier
  speedOptions: MenuOption<SpeedTier>[]
  onSpeedChange: (value: SpeedTier) => void
  trailSpeedTier: TrailSpeedTier
  trailSpeedOptions: MenuOption<TrailSpeedTier>[]
  onTrailSpeedChange: (value: TrailSpeedTier) => void
  // Which powerup types can spawn this round — "off" is simply an empty array (see GameSettings'
  // own comment), so this one multi-select control covers both at once rather than needing a
  // separate on/off toggle alongside it.
  enabledPowerups: PowerupType[]
  powerupOptions: MenuOption<PowerupType>[]
  onPowerupsChange: (value: PowerupType[]) => void
  // Omitted entirely for two-player — there's no CPU to tune the difficulty of.
  cpuDifficulty?: CpuDifficulty
  cpuDifficultyOptions?: MenuOption<CpuDifficulty>[]
  onCpuDifficultyChange?: (value: CpuDifficulty) => void
  accentColor: string
  mutedColor: string
  // Foreground for a selected row's icon/text — see SectionedDropdown's identical prop. This layer
  // always has a real theme onTertiary to hand over (accentColor is themeColors.tertiary), so it's
  // required here rather than left to SectionedDropdown's own per-player-color fallback.
  onAccentColor: string
  dark: boolean
}

// Always-upright band of shared (not per-player) settings, sitting between the two rotated/split
// player zones in the two-player lobby. Owns its own popover host, independent from either
// player's own panel (so it never blocks and is never blocked by a player's own pickers), unless a
// `host` is passed in to share with the player panels instead (vs-CPU mode).
// This component's own popover ids — used to check membership below, not just "is anything open on
// the host", since a shared host (vs-CPU) also carries the player panels' own popover ids.
const OWN_IDS = ['gridSize', 'speed', 'trailSpeed', 'powerups', 'cpuDifficulty']

export function LobbySharedControls({ host: sharedHost, gridSizeTier, gridSizeOptions, onGridSizeChange, speedTier, speedOptions, onSpeedChange, trailSpeedTier, trailSpeedOptions, onTrailSpeedChange, enabledPowerups, powerupOptions, onPowerupsChange, cpuDifficulty, cpuDifficultyOptions, onCpuDifficultyChange, accentColor, mutedColor, onAccentColor, dark }: Props) {
  const ownHost = usePopoverHost()
  const host = sharedHost ?? ownHost
  // See LobbyPlayerPanel's identical ownPopoverOpen comment — elevating this row for *any* open
  // popover on a shared host (rather than only its own) would tie it with whichever sibling panel
  // actually has the open popover, letting DOM order wrongly decide which one paints on top.
  const ownPopoverOpen = host.openId !== null && OWN_IDS.includes(host.openId)

  return (
    <View style={[styles.row, ownPopoverOpen && styles.rowOpen]}>
      <SectionedDropdown id='gridSize' host={host} icon='grid' accessibilityLabel='Grid size' sections={[{ kind: 'single', id: 'gridSize', options: gridSizeOptions, value: gridSizeTier, onChange: onGridSizeChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

      <SectionedDropdown id='speed' host={host} icon='speedometer' accessibilityLabel='Speed' sections={[{ kind: 'single', id: 'speed', options: speedOptions, value: speedTier, onChange: onSpeedChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

      {/* Speed ramp toggle hidden for now — settings.speedRampEnabled stays wired through
      gameEngine/validation/useGameState and defaults to false, so this is a pure UI hide, not a
      feature removal. Re-add the toggle here (and its props above) to bring it back. */}

      <SectionedDropdown id='trailSpeed' host={host} icon='chart-line' accessibilityLabel='Trail speed' sections={[{ kind: 'single', id: 'trailSpeed', options: trailSpeedOptions, value: trailSpeedTier, onChange: onTrailSpeedChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

      <SectionedDropdown id='powerups' host={host} icon='flash' accessibilityLabel={`Powerups ${enabledPowerups.length > 0 ? 'on' : 'off'}`} sections={[{ kind: 'multi', id: 'powerups', options: powerupOptions, value: enabledPowerups, onChange: onPowerupsChange, allClear: true }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />

      {cpuDifficulty && cpuDifficultyOptions && onCpuDifficultyChange && <SectionedDropdown id='cpuDifficulty' host={host} icon='chip' accessibilityLabel='CPU difficulty' sections={[{ kind: 'single', id: 'cpuDifficulty', options: cpuDifficultyOptions, value: cpuDifficulty, onChange: onCpuDifficultyChange }]} accentColor={accentColor} mutedColor={mutedColor} onAccentColor={onAccentColor} dark={dark} />}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    // Safety net against a narrow device: a row of fixed-size triggers with no wrap just runs off
    // the screen edge with nothing to catch it, taking the last trigger or two with it —
    // untappable, not just clipped. Wrap turns that into "drops to a second centered line" instead.
    // See BoxHockey's LoadoutSharedControls (its own row style) for the sibling fix and the actual
    // measurement that prompted it.
    flexWrap: 'wrap',
    // Wider than a plain icon row would need, to give each trigger's TriggerGauge arc — pulled in
    // close around the icon itself (see TriggerGauge's own ARC_GAP) — room to breathe against its
    // neighbors instead of the two arcs crowding each other.
    gap: 20,
    justifyContent: 'center'
  },
  // See SectionedDropdown's anchorOpen comment — this row is itself a sibling of the player panels in
  // lobby.tsx, and React Native Web's per-view stacking contexts mean a popover escaping this row's
  // bounds needs the row itself elevated, not just the popover content, to paint above a later
  // sibling panel.
  rowOpen: {
    zIndex: 100
  }
})
