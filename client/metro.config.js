const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname)

// onnxruntime-react-native loads model files via require() — Metro must
// treat them as assets, not source. 'wasm' was already here for the web EP;
// 'onnx' is for the bundled YOLO detector under assets/models/.
config.resolver.assetExts.push('wasm', 'onnx');

module.exports = withNativeWind(config, { input: './global.css' })