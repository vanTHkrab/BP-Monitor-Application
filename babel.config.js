module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      'babel-preset-expo',
      // Add NativeWind as a preset (v5 exports a preset via react-native-css)
      'nativewind/babel',
    ],
    plugins: [
      'expo-router/babel',
      // Reanimated plugin must be last
      'react-native-reanimated/plugin',
    ],
  };
};
