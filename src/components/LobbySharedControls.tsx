import { StyleSheet, View } from 'react-native'

import { IconDropdown } from '@/components/IconDropdown'
import { PopoverHost, usePopoverHost } from '@/hooks/usePopoverHost'
import { CpuDifficulty, GridSizeTier, SpeedTier } from '@/types'

interface GridSizeOption {
  value: GridSizeTier
  label: string
  icon: string
  iconSize?: number
}

interface SpeedOption {
  value: SpeedTier
  label: string
  icon: string
}

interface CpuDifficultyOption {
  value: CpuDifficulty
  label: string
  icon: string
}

interface Props {
  // Shared popover host — see LobbyPlayerPanel's identical `host` prop. Passed in vs-CPU mode so
  // grid size/speed/CPU difficulty are mutually exclusive with the player panels' own color/control
  // pickers too (there's only one human driving the whole screen there, so simultaneity across
  // every picker just adds clutter). Omit to fall back to this component's own independent host.
  host?: PopoverHost
  gridSizeTier: GridSizeTier
  gridSizeOptions: GridSizeOption[]
  onGridSizeChange: (value: GridSizeTier) => void
  speedTier: SpeedTier
  speedOptions: SpeedOption[]
  onSpeedChange: (value: SpeedTier) => void
  // Omitted entirely for two-player — there's no CPU to tune the difficulty of.
  cpuDifficulty?: CpuDifficulty
  cpuDifficultyOptions?: CpuDifficultyOption[]
  onCpuDifficultyChange?: (value: CpuDifficulty) => void
  accentColor: string
  mutedColor: string
  dark: boolean
}

// Always-upright band of shared (not per-player) settings, sitting between the two rotated/split
// player zones in the two-player lobby. Owns its own popover host, independent from either
// player's own panel (so it never blocks and is never blocked by a player's own pickers), unless a
// `host` is passed in to share with the player panels instead (vs-CPU mode).
// This component's own popover ids — used to check membership below, not just "is anything open on
// the host", since a shared host (vs-CPU) also carries the player panels' own popover ids.
const OWN_IDS = ['gridSize', 'speed', 'cpuDifficulty']

export function LobbySharedControls({ host: sharedHost, gridSizeTier, gridSizeOptions, onGridSizeChange, speedTier, speedOptions, onSpeedChange, cpuDifficulty, cpuDifficultyOptions, onCpuDifficultyChange, accentColor, mutedColor, dark }: Props) {
  const ownHost = usePopoverHost()
  const host = sharedHost ?? ownHost
  // See LobbyPlayerPanel's identical ownPopoverOpen comment — elevating this row for *any* open
  // popover on a shared host (rather than only its own) would tie it with whichever sibling panel
  // actually has the open popover, letting DOM order wrongly decide which one paints on top.
  const ownPopoverOpen = host.openId !== null && OWN_IDS.includes(host.openId)

  return (
    <View style={[styles.row, ownPopoverOpen && styles.rowOpen]}>
      <IconDropdown id='gridSize' host={host} icon='grid' accessibilityLabel='Grid size' options={gridSizeOptions} value={gridSizeTier} onChange={onGridSizeChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} />

      <IconDropdown id='speed' host={host} icon='speedometer' accessibilityLabel='Speed' options={speedOptions} value={speedTier} onChange={onSpeedChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} />

      {cpuDifficulty && cpuDifficultyOptions && onCpuDifficultyChange && (
        <IconDropdown id='cpuDifficulty' host={host} icon='chip' accessibilityLabel='CPU difficulty' options={cpuDifficultyOptions} value={cpuDifficulty} onChange={onCpuDifficultyChange} accentColor={accentColor} mutedColor={mutedColor} dark={dark} />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'center'
  },
  // See IconDropdown's anchorOpen comment — this row is itself a sibling of the player panels in
  // lobby.tsx, and React Native Web's per-view stacking contexts mean a popover escaping this row's
  // bounds needs the row itself elevated, not just the popover content, to paint above a later
  // sibling panel.
  rowOpen: {
    zIndex: 100
  }
})
