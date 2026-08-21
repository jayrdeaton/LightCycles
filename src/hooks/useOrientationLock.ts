import * as ScreenOrientation from 'expo-screen-orientation'
import { useEffect } from 'react'

// Locks orientation based on the settings choice, per PLAN.md — never reads live device rotation.
// On web this rejects (NotSupportedError) whenever the page isn't in fullscreen — e.g. a normal
// browser tab, or embedded in an iframe like a preview pane — so the browser's own window shape
// decides layout there instead; the catch just keeps that expected, unsupported-environment
// rejection from surfacing as an unhandled promise rejection.
export function useOrientationLock(lock: ScreenOrientation.OrientationLock) {
  useEffect(() => {
    ScreenOrientation.lockAsync(lock).catch(() => {})
  }, [lock])
}
