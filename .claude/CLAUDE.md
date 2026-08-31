# CLAUDE.md

This file provides guidance to Claude Code when working in this repository.

# LightCycles

A local multiplayer Tron/lightcycles pass-and-play game (Expo/React Native, Skia-rendered). Part of the `@rific`/`@tastic`/InfiniteToken app ecosystem — depends on `@rific/auto-paper`, `@rific/feedback-press`, `@rific/focus-chain`, `@rific/splash-gate`, `@rific/toaster`, `@rific/updater`, `@tastic/core`, `@tastic/edge-guard`, `@tastic/hud`, `@tastic/input`, `@tastic/profile`, `@tastic/split-screen`.

**Expo has changed.** Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code — don't rely on general Expo knowledge, this app is on SDK 57 specifically.

## Commands

```bash
npm run lint          # expo lint .
npm run fix            # expo lint . --fix
npm test               # Jest (14 suites, 438 tests)
npm run test:watch     # Jest --watchAll
npm run typecheck      # tsc
npm run verify         # lint + test + typecheck
npm run doctor         # expo install --fix && expo-doctor
npm start              # Expo dev server
npm run client          # Expo dev server (dev client build)
npm run build:web       # expo export -p web
```

Always run `npm run lint` before finishing any task. This is an app (`"private": true`, no publish scripts) — `verify` doesn't include a build step.

`build:development`/`build:preview`/`build:production`/`build:web` and `update` (which `update:development`/`update:preview`/`update:production` delegate to) are each gated behind `verify` by prefixing `npm run verify && ` directly onto the script's own definition, same as every other migrated app — see Swirlio's CLAUDE.md for the full reasoning (not redundant with CI, since EAS builds/OTA updates have no GitHub Action step to catch this the way `publish.yml` does; inline chaining rather than a separate `pre<script>` hook, since these are scripts we author ourselves, not builtin npm commands).

## Tooling

Onboarded onto the shared `@infinitetoken` config packages (`eslint-config`, `jest-config`, `tsconfig`) — previously hand-rolled its own `eslint-config-expo`-based config, `jest-expo`-preset-direct config, and `expo/tsconfig.base`-extending tsconfig (the same pattern documented in [Swirlio](../Swirlio/.claude/CLAUDE.md)'s CLAUDE.md, which this migration followed).

`npx expo install --fix` + `npm update` were run as part of this pass too — confirmed clean: `npx expo install --check` reports up to date, `npm outdated` shows `Current === Wanted` for every dependency (remaining `Latest` values are all major bumps outside declared ranges, a deliberate-upgrade decision, not routine maintenance).

- `eslint.config.cjs` — `@infinitetoken/eslint-config/expo`, no local override
- `tsconfig.json` — `extends: "@infinitetoken/tsconfig/expo"`, keeps only the path-valued local bits (`paths`, `include`)
- `jest.config.cjs` — `@infinitetoken/jest-config/expo`, no options at all — `jest.setup.cjs` and `roots` are both auto-detected/defaulted (see below)

**`jest.config.ts` became `jest.config.cjs`, matching every non-Expo project in the fleet — no more `ts-node` gotchas.** This app (like every other Expo app) originally had `jest.config.ts` while every library/kit package used `.cjs` — a real divergence, not a justified one. `.ts` needed `import type {Config} from 'jest'` + a typed `const config: Config = ...` (a bare `export default createExpoJestConfig(...)` fails `tsc`'s declaration-emit check), plus a separate non-extending `tsconfig.jest.json` wired in via `TS_NODE_PROJECT=./tsconfig.jest.json` on `test`/`test:watch` (`ts-node`, Jest's `.ts`-config loader, can't resolve a tsconfig `extends` through a package's `exports` map at all). None of that exists for `.cjs` — plain `require()`, no transpilation, nothing to typecheck. Converting removed `tsconfig.jest.json`, the `TS_NODE_PROJECT` prefix on both scripts, and the `ts-node` devDependency entirely — see `@infinitetoken/jest-config`'s own README ("Why `.cjs`, not `.ts`") for the full history.

**`prettier.config.js` was deleted — `package.json` now has `"prettier": "@infinitetoken/eslint-config/prettier"` instead**, same as every library/kit package. The local file was a byte-for-byte duplicate of the shared package's own `prettier.cjs`; every Expo app had independently copy-pasted it rather than referencing the shared one.

**`metro.config.js` was deleted — it was unmodified `getDefaultConfig(__dirname)` boilerplate doing nothing.** Confirmed by removing it and running `npx expo export -p web`: builds cleanly, `canvaskit.wasm` still lands in `dist/` (copied into `public/` by the `setup-skia-web` postinstall script and served as a static file, fetched at runtime by `canvaskit-wasm`'s own init code — never `require()`d through Metro's bundler, so `resolver.assetExts` is irrelevant to it regardless). Swirlio never had this file at all and works the same way — this file's presence elsewhere in the fleet is boilerplate carried over from `expo customize`, not a requirement.

**Native/Expo module mocks moved from inline `jest.mock()` calls in `jest.setup.cjs` into individual `src/__mocks__/*.ts` files** — `react-native-reanimated`, `react-native-worklets`, `@expo/vector-icons` (+ its `createIconSet` deep import), `expo-splash-screen`, `expo-sensors`, `react-native-gesture-handler`, `react-native-safe-area-context`, `expo-router`. This is a fleet-wide convention change, not LightCycles-specific — see `@infinitetoken/jest-config`'s own CLAUDE.md for the full reasoning. `jest.setup.cjs` now holds only genuine setup-file content (the `IS_REACT_ACT_ENVIRONMENT` flag, `unhandledRejection`/`uncaughtException` handlers, the RAF/cancelAnimationFrame polyfills, and the no-factory `NativeAnimatedHelper` automock) and is auto-detected by `@infinitetoken/jest-config/expo` — no `setupFilesAfterEnv` option needed at all. Also renamed from `.ts` to `.cjs` — a later, separate cleanup: auto-detection genuinely supports either (a `.ts` setup file goes through Jest's own test transform same as any other `setupFilesAfterEnv` entry, unlike `jest.config.cjs` itself, which Jest loads directly before any transform exists), but once its content shrank to thin boilerplate with the mock factories gone, there was no remaining reason for this one hand-authored config file to use a different extension than every other one in the app — see `@infinitetoken/jest-config`'s README, "Why `.cjs`, not `.ts`." With the mock factories' `any` usage gone, `jest.setup.cjs` no longer needs its own `no-explicit-any` eslint override — `eslint.config.cjs` is back to the plain one-liner. The one remaining `any` in `jest.setup.cjs` (bridging `requestAnimationFrame`'s polyfilled `NodeJS.Timeout` return type into `cancelAnimationFrame`'s DOM-lib `number` signature) is a single targeted `eslint-disable-next-line`, not a file-wide exemption.

**The `modulePathIgnorePatterns: ['<rootDir>/.claude/worktrees/']` `overrides` entry this app previously needed is gone too, and not because it was removed by hand.** `@infinitetoken/jest-config/expo` now defaults `roots: ['<rootDir>/src']` (see its own CLAUDE.md — added specifically to make `src/__mocks__/` the manual-mock pickup location instead of the repo root). Since `.claude/worktrees/` lives outside `src/`, Jest's haste map scan never reaches it anymore either — confirmed directly: removing the override entirely and running the full suite produces no `jest-haste-map: Haste module naming collision` warning, with an active worktree still checked out in this repo. The `roots` default fixed this as a side effect, not the motivation for adding it.

**RESOLVED.** Migrating onto `@infinitetoken/tsconfig/expo` originally surfaced a pre-existing, unrelated typecheck failure: `src/hooks/useProfiles.tsx` imports `isSharedProfileStoreAvailable`, `loadSharedProfiles`, and `saveSharedProfiles` from `@tastic/profile`, but the then-installed `@tastic/profile@0.1.3` exported none of them — confirmed by reverting to the pre-migration `tsconfig.json` and re-running `tsc`, which failed identically, so not caused by this migration. It was in-progress work on a shared cross-app profile roster (the file's own comments reference a `group.com.infinitetoken.tastic` App Group shared with BoxHockey), blocked on an unpublished `@tastic/profile` version. Fixed by bumping `@tastic/profile` to `^0.3.4` (confirmed to actually export the needed members) — `npm run typecheck`/`npm run verify` now pass clean.

`@infinitetoken/jest-config` (`^0.2.3`) and `@infinitetoken/tsconfig` (`^0.4.1`) are both on real published versions now — neither is yalc-linked (that was a temporary state during development for both, resolved once each package was actually published).

**`tsconfig.json`'s `types` array was removed — `@infinitetoken/tsconfig/expo` now defaults `types: ["jest", "node", "react-native"]` itself.** Every real Expo app had been restating an identical `types` array locally; that used to look unavoidable (TypeScript's `types` option is fully replaced, not merged, by whatever the most-derived config sets), until checking the actual devDependencies across the first three migrated apps showed the "different arrays" were mostly drift, not real differing need. See `@infinitetoken/tsconfig`'s own CLAUDE.md for the full correction.

## Testing

- Framework: Jest (`@infinitetoken/jest-config/expo`, `jest-expo` preset)
- Tests live in `src/__tests__/`
- Native/Expo module mocks live in `src/__mocks__/`, one file per module, picked up automatically (no `jest.mock()` call needed) — see Tooling above
- `jest.setup.cjs` holds only genuine setup-file concerns: process-level error handlers, RAF polyfills, the `IS_REACT_ACT_ENVIRONMENT` flag

## Architecture

```
src/
  app/          - expo-router routes
  components/   - UI components (game board rendering, controls, overlays)
  constants/    - static config, arenas, game params
  hooks/        - custom hooks (game state, profiles, achievements, stats)
  types/        - shared TypeScript types
  utils/        - validation and helper logic
  __tests__/    - test suites
  __mocks__/    - manual Jest mocks for native/Expo modules
```

## CI

`.github/workflows/ci.yml` uses the shared reusable workflow (`infinitetoken/Workflows/.github/workflows/npm-ci.yml@v1`, defaults to `npm run verify`) — previously a hand-rolled workflow running `npm ci && npm run ci`. The `ci` npm script was renamed to `verify` to match.
