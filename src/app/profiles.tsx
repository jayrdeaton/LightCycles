import { ProfilesScreen } from '@tastic/profile'

import { DEFAULT_P1_COLOR } from '@/constants/game'
import { useGameStats } from '@/hooks/useGameStats'
import { useProfiles } from '@/hooks/useProfiles'
import { KeyScheme } from '@/types'
import { safeBack } from '@/utils/navigation'

// Neutral default (matching DEFAULT_SETTINGS.keyScheme's own default) rather than either seat's own
// current key scheme — a new profile isn't necessarily *for* whichever seat opened this screen (the
// whole point of a dedicated screen is P1 handing the phone to P2 to create theirs), and whoever
// it's for can always change their own profile's key scheme later regardless.
const NEW_PROFILE_KEY_SCHEME: KeyScheme = 'wasd'

// A real routed screen — same back-button shape and native push/pop transition as
// achievements.tsx — rather than a Portal-rendered overlay on top of the lobby. Reachable only
// from P1's dropdown (see ProfilePicker's own doc for why P2 can't host this: its zone is
// 180°-rotated in face-to-face mode, and the OS keyboard doesn't rotate with it). Reads
// useProfiles()/useGameStats() directly rather than taking them as props from lobby.tsx — there's
// nothing left for that screen to thread through once this is its own destination instead of
// conditionally-rendered state living on the lobby itself.
export default function Profiles() {
  const { profiles, createProfile, updateProfile, deleteProfile } = useProfiles()
  // Only for wiring onDelete below — nothing else on this screen touches stats directly.
  const { removeProfileStats } = useGameStats()

  return (
    <ProfilesScreen
      profiles={profiles}
      defaultColor={DEFAULT_P1_COLOR}
      onCreate={(patch) => createProfile({ ...patch, keyScheme: NEW_PROFILE_KEY_SCHEME })}
      onSave={(id, patch) => updateProfile(id, patch)}
      onDelete={(id) => {
        deleteProfile(id)
        removeProfileStats(id)
      }}
      onBack={safeBack}
    />
  )
}
