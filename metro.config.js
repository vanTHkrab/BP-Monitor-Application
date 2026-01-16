const { getDefaultConfig } = require('@expo/metro-config');
const { withReactNativeCSS } = require('react-native-css/metro');

const config = getDefaultConfig(__dirname);

module.exports = withReactNativeCSS(config);
