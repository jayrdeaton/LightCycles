// This app's own useGameSound was byte-for-byte identical to @rific/feedback-press/audio's
// useGatedAudioPool (useAudioPool gated on the shared useSoundSettings toggle) — now a thin
// re-export under this app's existing name rather than updating every call site.
export { useGatedAudioPool as useGameSound } from '@rific/feedback-press/audio'
