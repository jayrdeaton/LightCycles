const { withAppDelegate } = require('expo/config-plugins');

// Swizzles UIViewController.preferredScreenEdgesDeferringSystemGestures so the
// system defers bottom-edge gestures (Reachability, and incidentally the
// home-indicator swipe) to the app first. Doesn't disable them — the OS still
// honors a second, more deliberate swipe — but stops light accidental swipes
// near the bottom edge from firing mid-gameplay.
//
// This is done via swizzling rather than wrapping the root view controller
// since a second wrapper installed on top of whatever's already there risks
// tripping UIKit's "already a window's root view controller" check. Swizzling
// the base class getter works regardless of which concrete class ends up as
// the root view controller.
const SWIZZLE_SWIFT = `
private let lc_deferBottomEdgeSystemGesturesSwizzle: Void = {
  let cls = UIViewController.self
  guard
    let original = class_getInstanceMethod(cls, #selector(getter: UIViewController.preferredScreenEdgesDeferringSystemGestures)),
    let replacement = class_getInstanceMethod(cls, #selector(UIViewController.lc_preferredScreenEdgesDeferringSystemGestures))
  else { return }
  method_exchangeImplementations(original, replacement)
}()

extension UIViewController {
  @objc func lc_preferredScreenEdgesDeferringSystemGestures() -> UIRectEdge {
    .bottom
  }
}
`;

const IMPORT_ANCHOR = 'import ReactAppDependencyProvider';

const START_REACT_NATIVE_ANCHOR = `    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)`;

const MARKER = 'lc_deferBottomEdgeSystemGesturesSwizzle';

function withDeferBottomEdgeGestures(config) {
  return withAppDelegate(config, (config) => {
    if (config.modResults.language !== 'swift') {
      throw new Error(
        `withDeferBottomEdgeGestures expects AppDelegate.swift, got language "${config.modResults.language}". ` +
          'The Expo template likely changed — update this plugin to match.'
      );
    }

    let contents = config.modResults.contents;

    if (contents.includes(MARKER)) {
      return config;
    }

    if (!contents.includes(IMPORT_ANCHOR) || !contents.includes(START_REACT_NATIVE_ANCHOR)) {
      throw new Error(
        'withDeferBottomEdgeGestures could not find the expected imports or factory.startReactNative(...) ' +
          'call in AppDelegate.swift. The Expo template likely changed — update this plugin to match.'
      );
    }

    contents = contents.replace(IMPORT_ANCHOR, `${IMPORT_ANCHOR}\nimport ObjectiveC`);
    contents = contents.replace(
      START_REACT_NATIVE_ANCHOR,
      `${START_REACT_NATIVE_ANCHOR}\n    _ = lc_deferBottomEdgeSystemGesturesSwizzle`
    );
    contents += SWIZZLE_SWIFT;

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = withDeferBottomEdgeGestures;
