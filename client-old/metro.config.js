const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname)

// onnxruntime-react-native loads model files via require() — Metro must
// treat them as assets, not source. 'wasm' was already here for the web EP;
// 'onnx' is for the bundled YOLO detector under assets/models/.
config.resolver.assetExts.push('wasm', 'onnx');

// Keep native build artifacts out of Metro's file map.
//
// Gradle/CMake write per-ABI object trees into `<pkg>/android/.cxx/` and
// `<pkg>/android/build/` inside node_modules — react-native-reanimated alone
// is ~730 MB of them after a debug build. They contain no JS, so Metro never
// needs to resolve or watch them, but its crawler walks them anyway and
// registers an inotify watch per directory. On Linux that blows past
// `fs.inotify.max_user_watches` and the dev server dies at startup with
// `ENOSPC: System limit for number of file watchers reached`.
//
// Appending (rather than assigning) preserves whatever Expo's default config
// already blocks.
const nativeBuildArtifacts = /(^|[/\\])android[/\\](\.cxx|build)[/\\].*/;
config.resolver.blockList = config.resolver.blockList
  ? [].concat(config.resolver.blockList, nativeBuildArtifacts)
  : nativeBuildArtifacts;

module.exports = withNativeWind(config, { input: './global.css' })