import { useUpdateErrorToast } from '@rific/toaster'
import { UpdateDialog as SharedUpdateDialog } from '@tastic/hud'

// Thin bridge onto the fleet-shared @tastic/hud UpdateDialog, which owns the useUpdater() instance,
// the manifest/confirm bridging, and the themed ConfirmDialog rendering. Kept as its own named
// export (rather than importing SharedUpdateDialog directly in _layout.tsx) purely so this app's
// own onError -> toast wiring has one place to live. Same shape as AirHockey's/BoxHockey's/Pong's/
// Snake's own src/components/UpdateDialog.tsx.
export function UpdateDialog() {
  return <SharedUpdateDialog onError={useUpdateErrorToast()} />
}
