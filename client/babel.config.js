module.exports = function (api) {
    api.cache(true);
    return {
        presets: [
            ["babel-preset-expo", { jsxImportSource: "nativewind" }],
            "nativewind/babel",
        ],
        // Order matters: inline-import must run before anything reads the
        // module graph, and reanimated's plugin must stay last.
        plugins: [
            // Drizzle migrations are .sql files. Metro cannot bundle them as
            // source, so they are inlined as strings at build time.
            ['inline-import', { extensions: ['.sql'] }],
            [
                '@tamagui/babel-plugin',
                {
                    components: ['tamagui'],
                    config: './tamagui.config.ts',
                    logTimings: false,
                },
            ],
            'react-native-reanimated/plugin',
        ],
    };
};