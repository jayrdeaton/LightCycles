// Delegates to the package's own official jest mock (a real in-memory store, not just jest.fn()
// stubs) — needed so tests can prove an actual write-then-reload round trip, e.g.
// useProfiles.test.tsx's persisted-selection coverage. Nothing in this repo's test suite exercised
// an AsyncStorage-backed code path before that (every existing hook that reads/writes it —
// useGameSettings, useSeatColors, useProfiles — only ever had its pure validation helpers tested),
// so this was a dormant gap the same way @rific/feedback-press/audio was (see jest.setup.cjs).
module.exports = require('@react-native-async-storage/async-storage/jest/async-storage-mock')
