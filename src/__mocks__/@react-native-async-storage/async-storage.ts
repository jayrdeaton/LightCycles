// Delegates to the package's own official jest mock (a real in-memory store, not just jest.fn()
// stubs) — needed so tests can prove an actual write-then-reload round trip, e.g.
// useProfiles.test.tsx's persisted-selection coverage. Nothing in this repo's test suite exercised
// an AsyncStorage-backed code path before that (every existing hook that reads/writes it —
// useGameSettings, useProfiles — only ever had its pure validation helpers tested), so this was a
// dormant gap the same way @rific/feedback-press/audio was (see jest.setup.cjs). (useSeatColors,
// also on this list originally, was later converged onto Redux — see redux/seatColorsSlice.ts —
// and no longer touches AsyncStorage at all.)
module.exports = require('@react-native-async-storage/async-storage/jest/async-storage-mock')
