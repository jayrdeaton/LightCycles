import AsyncStorage from '@react-native-async-storage/async-storage'
import { FeedbackPressProvider, HapticSettings, SoundSettings } from '@rific/feedback-press'
import { useAudioPool } from '@rific/feedback-press/audio'
import { ReactNode, useCallback, useEffect, useState } from 'react'
import * as RNPaper from 'react-native-paper'

import { useSplashReady } from '@/utils/splashGate'

const HAPTIC_STORAGE_KEY = 'lightcycles.vibrate'
const SOUND_STORAGE_KEY = 'lightcycles.sound'

interface Props {
  children: ReactNode
}

export function Feedback({ children }: Props) {
  const [hapticSettings, setHapticSettings] = useState<Partial<HapticSettings>>({ vibrate: true })
  const [soundSettings, setSoundSettings] = useState<Partial<SoundSettings>>({ enabled: true })
  const [hapticsLoaded, setHapticsLoaded] = useState(false)
  const [soundLoaded, setSoundLoaded] = useState(false)

  useEffect(() => {
    AsyncStorage.getItem(HAPTIC_STORAGE_KEY)
      .then((stored) => {
        if (stored !== null) setHapticSettings({ vibrate: stored === 'true' })
      })
      .catch(() => {
        // Corrupt/unavailable storage — keep the default { vibrate: true } already in state.
      })
      .finally(() => {
        // Always resolves the splash gate below, even on a rejected read — otherwise a storage
        // failure holds the splash screen up forever with no way to recover short of reinstalling.
        setHapticsLoaded(true)
      })
  }, [])

  useEffect(() => {
    AsyncStorage.getItem(SOUND_STORAGE_KEY)
      .then((stored) => {
        if (stored !== null) setSoundSettings({ enabled: stored === 'true' })
      })
      .catch(() => {
        // Corrupt/unavailable storage — keep the default { enabled: true } already in state.
      })
      .finally(() => {
        setSoundLoaded(true)
      })
  }, [])

  useSplashReady('haptics', hapticsLoaded)
  useSplashReady('sound', soundLoaded)

  // Generic UI feedback sounds, wired into every Button/IconButton/etc. in the package (see
  // useFeedbackHandlers' `fire`, which already gates these on the sound-enabled setting itself —
  // no need to re-check it here).
  const playSelection = useAudioPool(require('../../assets/sounds/select.wav'))
  const playNotification = useAudioPool(require('../../assets/sounds/notification.wav'))

  // Only persists — FeedbackPressProvider owns the live settings after mount, and it calls
  // onChange/onSoundChange synchronously during its own render, so mirroring `next` back into this
  // component's state here would update a parent while a child renders (React setState-in-render
  // warning).
  const onChange = useCallback((next: HapticSettings) => {
    AsyncStorage.setItem(HAPTIC_STORAGE_KEY, String(next.vibrate)).catch(() => {})
  }, [])

  const onSoundChange = useCallback((next: SoundSettings) => {
    AsyncStorage.setItem(SOUND_STORAGE_KEY, String(next.enabled)).catch(() => {})
  }, [])

  return (
    <FeedbackPressProvider initialValue={hapticSettings} onChange={onChange} soundInitialValue={soundSettings} onSoundChange={onSoundChange} paper={RNPaper} sound={{ selection: playSelection, notification: playNotification }}>
      {children}
    </FeedbackPressProvider>
  )
}
