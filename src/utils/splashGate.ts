import { createSplashGate } from '@rific/splash-gate'

export const { markReady: markSplashReady, useReady: useSplashReady, pendingGates: pendingSplashGates } = createSplashGate(['theme', 'haptics', 'sound', 'fonts'] as const)
