import { createGate } from '@rific/splash-gate'

export const { markReady: markSplashReady, useReady: useSplashReady, pendingGates: pendingSplashGates } = createGate(['theme', 'haptics', 'sound', 'fonts'] as const)
