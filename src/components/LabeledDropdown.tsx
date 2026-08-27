import { getContrastColor } from '@rific/auto-paper'
import { TouchableRipple } from '@rific/feedback-press'
import { PopoverBody, PopoverHost } from '@tastic/hud'
import { ScrollView, StyleSheet, View } from 'react-native'
import { Icon, Text } from 'react-native-paper'

import { useZoneClampedAlign } from '@/hooks/useZoneClampedAlign'

const TRIGGER_HEIGHT = 28
const POPOVER_WIDTH = 180
const ROW_HEIGHT = 36
const LIST_PADDING = 8

export interface LabeledDropdownOption<T extends string> {
  value: T
  label: string
  icon?: string
}

interface Props<T extends string> {
  id: string
  host: PopoverHost
  options: LabeledDropdownOption<T>[]
  value: T
  onChange: (value: T) => void
  color: string
  dark: boolean
  align?: 'left' | 'right' | 'center'
}

// A name-trigger + selection popover in the same visual style as ProfilePicker's own trigger — an
// uppercase text label + chevron, opening a list whose selected row fills entirely with the seat's
// own accent color — rather than @tastic/hud's SectionedDropdown, whose trigger is a fixed icon
// with a gauge ring around it. For a choice that reads more like "who/what you're playing" than "a
// game setting" (the CPU's own difficulty picker, sitting right above its panel the same way a
// human seat's name trigger sits above its own pickerRow — see LobbyPlayerPanel), the always-
// visible text label carries more of the meaning than an icon would on its own.
export function LabeledDropdown<T extends string>({ id, host, options, value, onChange, color, dark, align: alignOverride }: Props<T>) {
  const menuBg = dark ? '#000000' : '#FFFFFF'
  const fg = dark ? '#FFFFFF' : '#000000'

  const open = host.openId === id
  const selected = options.find((o) => o.value === value) ?? null
  const contentHeight = LIST_PADDING * 2 + options.length * ROW_HEIGHT
  // See ProfilePicker's identical usage — useAutoAlign plus an extra clamp for wherever this
  // popover actually opens toward the shared row (a no-op outside a DualZoneLayout zone).
  const { align: autoAlign, maxHeight, measured, triggerRef, verticalAlign } = useZoneClampedAlign(open, POPOVER_WIDTH, contentHeight)
  const align = alignOverride ?? autoAlign

  const handleSelect = (option: LabeledDropdownOption<T>) => {
    onChange(option.value)
    host.close()
  }

  return (
    <View style={[styles.anchor, open && styles.anchorOpen]}>
      <TouchableRipple onPress={() => host.toggle(id)} style={styles.trigger}>
        <View ref={triggerRef} collapsable={false} style={styles.triggerInner}>
          <Text style={[styles.triggerLabel, { color }]} numberOfLines={1}>
            {(selected?.label ?? '').toUpperCase()}
          </Text>
          <Icon source='menu-down' size={16} color={color} />
        </View>
      </TouchableRipple>

      {/* Gated on `measured`, not just `open` — see InlineColorPicker's identical fix. */}
      <PopoverBody visible={open && measured} align={align} verticalAlign={verticalAlign} caretColor={menuBg} caretBorderColor={color} caretBorderWidth={2} triggerSize={TRIGGER_HEIGHT}>
        <ScrollView style={[styles.menu, { backgroundColor: menuBg, borderColor: color, width: POPOVER_WIDTH, maxHeight }]} contentContainerStyle={styles.menuContent} showsVerticalScrollIndicator={false}>
          {options.map((option) => {
            const isSelected = option.value === value
            const onColor = getContrastColor(color)
            return (
              <TouchableRipple key={option.value} onPress={() => handleSelect(option)} style={[styles.row, isSelected && { backgroundColor: color }]}>
                <View style={styles.rowInner}>
                  {option.icon && <Icon source={option.icon} size={18} color={isSelected ? onColor : fg} />}
                  <Text style={[styles.rowLabel, { color: isSelected ? onColor : fg }]} numberOfLines={1}>
                    {option.label}
                  </Text>
                </View>
              </TouchableRipple>
            )
          })}
        </ScrollView>
      </PopoverBody>
    </View>
  )
}

const styles = StyleSheet.create({
  anchor: {
    position: 'relative'
  },
  // See ProfilePicker's identical comment — React Native Web gives every position:'relative' view
  // its own stacking context, so the elevation has to live on the anchor itself.
  anchorOpen: {
    zIndex: 100
  },
  menu: {
    borderRadius: 12,
    borderWidth: 2,
    elevation: 8,
    shadowColor: '#000000',
    shadowOffset: { height: 2, width: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 8
  },
  menuContent: {
    padding: LIST_PADDING
  },
  row: {
    borderRadius: 8,
    height: ROW_HEIGHT
  },
  rowInner: {
    alignItems: 'center',
    flexDirection: 'row',
    flex: 1,
    gap: 8,
    paddingHorizontal: 12
  },
  rowLabel: {
    flex: 1,
    fontSize: 14
  },
  trigger: {
    alignSelf: 'flex-start'
  },
  triggerInner: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 2,
    height: TRIGGER_HEIGHT
  },
  triggerLabel: {
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 1
  }
})
