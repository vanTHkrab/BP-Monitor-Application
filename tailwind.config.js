/** @type {import('tailwindcss').Config} */
module.exports = {
  // NOTE: Update this to include the paths to all files that contain Nativewind classes.
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}", "./app/global.css"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      fontSize: {
        h1: '36px',
        h2: '24px',
        h3: '20px',
        h4: '16px',
        h5: '14px',
        h6: '12px',
        '14': '14px',
        '36': '36px',
        '24': '24px',
        '26': '26px',
      },
    },
  },
  plugins: [],
}