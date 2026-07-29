const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname)

// The bundled on-device models under assets/models/ are loaded as assets, not
// source. Without this, Metro tries to parse the ONNX binaries as JS.
config.resolver.assetExts.push('onnx');

// Drizzle emits migrations as .sql files that are imported as modules and
// inlined by babel-plugin-inline-import — so they are source, not assets.
config.resolver.sourceExts.push('sql');

// Keep native build artifacts out of Metro's file map.
//
// Gradle/CMake write per-ABI object trees into `<pkg>/android/.cxx/` and
// `<pkg>/android/build/` (both inside node_modules and in the app's own
// android/ folder) — react-native-reanimated alone is ~730 MB of them after a
// debug build. They contain no JS, so Metro never needs to resolve or watch
// them, but its crawler walks them anyway and registers an inotify watch per
// directory. On Linux that blows past `fs.inotify.max_user_watches` and the
// dev server dies at startup with `ENOSPC: System limit for number of file
// watchers reached`.
//
// Appending (rather than assigning) preserves whatever Expo's default config
// already blocks.
const nativeBuildArtifacts = /(^|[/\\])android[/\\](\.cxx|build)[/\\].*/;
config.resolver.blockList = config.resolver.blockList
  ? [].concat(config.resolver.blockList, nativeBuildArtifacts)
  : nativeBuildArtifacts;

module.exports = withNativeWind(config, { input: './src/global.css' })