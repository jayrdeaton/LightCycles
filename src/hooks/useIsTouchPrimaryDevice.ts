// Native never has a keyboard-scheme concept at all (see LobbyPlayerPanel's Platform.OS gate), so
// this default is never actually evaluated there — it only matters for the .web.ts variant.
export function useIsTouchPrimaryDevice(): boolean {
  return false
}
