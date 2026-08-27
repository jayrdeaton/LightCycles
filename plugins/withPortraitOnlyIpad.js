const { withInfoPlist } = require('expo/config-plugins');

// app.json's top-level "orientation": "portrait" only patches
// UISupportedInterfaceOrientations (see @expo/config-plugins' own
// ios/Orientation.js) — it never touches the separate
// UISupportedInterfaceOrientations~ipad key at all, which the Expo template
// leaves listing all four orientations regardless. Since this app sets
// ios.supportsTablet, that means an iPad could still freely rotate to
// landscape at the OS level even with orientation locked to portrait —
// exactly the live window-shape signal the accelerometer-based rotation
// mechanism (see @tastic/split-screen's useAccelerometerOrientation) is
// built to no longer depend on. This plugin just mirrors the phone key onto
// the iPad one so the lock is actually total.
function withPortraitOnlyIpad(config) {
  return withInfoPlist(config, (config) => {
    config.modResults['UISupportedInterfaceOrientations~ipad'] = ['UIInterfaceOrientationPortrait', 'UIInterfaceOrientationPortraitUpsideDown'];
    return config;
  });
}

module.exports = withPortraitOnlyIpad;
