/* global jest */
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Jest's manual __mocks__ convention doesn't reliably auto-apply for subpath imports (only bare
// package names) — see src/__mocks__/@expo/vector-icons/createIconSet.ts, Hangman's
// jest.setup.cjs, and Jest-Config's CLAUDE.md for the full investigation.
jest.mock('@expo/vector-icons/createIconSet')

// src/components/Feedback.tsx and src/hooks/useGameSound.ts both import this exact subpath
// directly (`@rific/feedback-press/audio`) with no bare `@rific/feedback-press` mock to fall back
// on and no adjacent src/__mocks__/ file — a fleet-wide audit flagged it as an unregistered
// specifier that would silently load the real, unmocked node_modules module (its
// `src/audio/index.ts`, via this package's `"react-native"` export condition — not `dist/`) the
// moment a future test actually rendered Feedback or exercised useGameSound. Neither is currently
// reached by this repo's test suite (confirmed: no test file imports Feedback.tsx, useGameSound.ts,
// or anything that transitively renders them — all 14 existing suites are engine/logic/validation
// tests only), so this closes a dormant gap rather than fixing a live failure. Same stub shape used
// identically for this package in Hangman/Snake/Swirlio/Pong's sibling jest.setup.cjs files — no
// per-file carve-out needed here since (unlike Hangman's useClickSound.test.ts/usePopSound.test.ts)
// nothing in this repo tests useAudioPool's real pooling behavior.
jest.mock('@rific/feedback-press/audio', () => ({
  __esModule: true,
  useAudioPool: () => () => {}
}))

const handleUnhandledRejection = (reason) => {
  // eslint-disable-next-line no-console
  console.error('UnhandledRejection in tests:', reason)
}

const handleUncaughtException = (err) => {
  // eslint-disable-next-line no-console
  console.error('UncaughtException in tests:', err)
}

if (typeof process !== 'undefined' && process && process.on) {
  process.on('unhandledRejection', handleUnhandledRejection)
  process.on('uncaughtException', handleUncaughtException)
}

try {
  jest.mock('react-native/Libraries/Animated/NativeAnimatedHelper')
} catch {
  // ignore if the path isn't present in this environment
}

if (typeof globalThis.requestAnimationFrame === 'undefined') {
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
}
if (typeof globalThis.cancelAnimationFrame === 'undefined') {
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
}
