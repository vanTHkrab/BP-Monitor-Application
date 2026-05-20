module.exports = function (api) {
    api.cache(true);
    return {
        presets: [
            ["babel-preset-expo", { jsxImportSource: "nativewind" }],
            "nativewind/babel",
        ],
        plugins: [
            // Inline the body of `.sql` files into the JS bundle so the
            // drizzle-kit generated migrations.js can `import x from
            // './0000_init.sql'`. Required by Drizzle's expo-sqlite
            // migrator — pairs with `sourceExts.push('sql')` in
            // metro.config.js (Metro resolves the path, this plugin
            // turns the contents into a string literal at build time).
            ["babel-plugin-inline-import", { extensions: [".sql"] }],
        ],
    };
};