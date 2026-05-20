const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname)

config.resolver.assetExts.push('wasm');
// Drizzle ORM ships .sql migration files that the expo-sqlite migrator
// require()s at runtime — see src/core/database/migrations/migrations.js.
config.resolver.sourceExts.push('sql');

module.exports = withNativeWind(config, { input: './global.css' })