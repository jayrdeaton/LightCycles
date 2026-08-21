import { Platform } from 'react-native'

// System monospace — the app's workhorse font for body copy, labels, and buttons (achievements,
// lobby, dropdowns, ReadyButton). Deliberately left alone here: a heavy geometric display face
// reads great at hero size but hurts legibility at small UI sizes, so it's scoped to DISPLAY_FONT
// below rather than replacing this everywhere.
export const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

// Registered via Fonts.tsx (gated on the splash screen through utils/splashGate.ts's 'fonts' gate)
// — only ever reference this after that gate has resolved, i.e. from screens mounted inside
// _layout.tsx's provider tree, same as MONO_FONT's own usage sites.
export const DISPLAY_FONT = 'Orbitron_700Bold'
