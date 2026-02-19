# BP-Mobile 🩺

A **Blood Pressure Monitor** mobile application built with [Expo](https://expo.dev) & [React Native](https://reactnative.dev).  
Track, visualize, and export your blood pressure readings — all from your phone.

## ✨ Features

- 📊 **Dashboard** — overview of recent readings with charts ([react-native-chart-kit](https://github.com/indiespirit/react-native-chart-kit))
- � **Camera** — scan / capture BP readings via the device camera
- 💬 **Chat / Community** — share and discuss with other users
- 📜 **History** — full log of past measurements with search & filters
- 📤 **Export** — generate and share PDF reports ([expo-print](https://docs.expo.dev/versions/latest/sdk/print/) + [expo-sharing](https://docs.expo.dev/versions/latest/sdk/sharing/))
- 🔐 **Authentication** — email / password sign-in via [Firebase](https://firebase.google.com/)
- 🗄️ **Local Storage** — offline-first with [expo-sqlite](https://docs.expo.dev/versions/latest/sdk/sqlite/)
- ⚙️ **Settings** — profile, security, help, and about screens

## 🛠 Tech Stack

| Layer | Technology |
| ----- | --------- |
| Framework | Expo SDK 54 / React Native 0.81 |
| Navigation | Expo Router (file-based) + React Navigation 7 |
| Styling | [NativeWind](https://www.nativewind.dev/) (Tailwind CSS for RN) |
| State | [Zustand](https://zustand-demo.pmnd.rs/) |
| Animations | [Reanimated](https://docs.swmansion.com/react-native-reanimated/) + [Moti](https://moti.fyi/) |
| Backend | Firebase (Auth & more) |
| Local DB | expo-sqlite |
| Build / CI | [EAS Build](https://docs.expo.dev/build/introduction/) |

## 📁 Project Structure

```text
app/               # Screens (file-based routing)
├── (tabs)/         #   ├── index (Home / Dashboard)
│                   #   ├── history, explore, camera, chat, menu
├── auth, profile, settings, security, help, about …
components/         # Reusable UI components
constants/          # Theme & design tokens
data/               # Local DB helpers & mock data
hooks/              # Custom React hooks
store/              # Zustand store (useAppStore)
types/              # TypeScript type definitions
utils/              # Utility functions (export-data, etc.)
assets/             # Images, icons, splash
scripts/            # Maintenance scripts (reset-project)
```

## 🚀 Getting Started

> This project uses **[pnpm](https://pnpm.io/)**.  
> Enable it via [Corepack](https://nodejs.org/api/corepack.html) if you haven't already:
>
> ```bash
> corepack enable
> ```

### 1. Install dependencies

```bash
pnpm install
```

### 2. Start the dev server

```bash
pnpm start
```

From there you can open the app in:

- [Development build](https://docs.expo.dev/develop/development-builds/introduction/)
- [Android emulator](https://docs.expo.dev/workflow/android-studio-emulator/)
- [iOS simulator](https://docs.expo.dev/workflow/ios-simulator/)
- [Expo Go](https://expo.dev/go) (limited sandbox)

### Platform shortcuts

```bash
pnpm run android   # start on Android
pnpm run ios       # start on iOS
pnpm run web       # start on Web
```

### Linting

```bash
pnpm run lint
```

## 🏗 EAS Build

The project is configured with [EAS](https://docs.expo.dev/build/introduction/) for cloud builds.

```bash
# Development (internal distribution)
eas build --profile development --platform android

# Preview (internal distribution)
eas build --profile preview --platform android

# Production
eas build --profile production --platform android
```

## 🔄 Reset Project

Move starter code to **app-example** and get a blank **app** directory:

```bash
pnpm run reset-project
```

## 📚 Learn More

- [Expo documentation](https://docs.expo.dev/)
- [Expo Router docs](https://docs.expo.dev/router/introduction/)
- [NativeWind docs](https://www.nativewind.dev/)
- [Zustand docs](https://zustand-demo.pmnd.rs/)
- [Firebase docs](https://firebase.google.com/docs)

## 🤝 Community

- [Expo on GitHub](https://github.com/expo/expo)
- [Expo Discord](https://chat.expo.dev)
