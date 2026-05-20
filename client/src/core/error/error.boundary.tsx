// Top-level React ErrorBoundary.
//
// Catches render-phase errors anywhere in the tree below it and swaps in
// a Thai-localized fallback screen with a "ลองใหม่" button. The reset
// just bumps state — children remount on next render.
//
// Constraints worth keeping in mind when editing:
//   - No `useAppStore` / no hooks. The whole point of the boundary is
//     to survive when the store itself is the thing that crashed; we
//     can't depend on it for theme or font preferences here.
//   - NativeWind `dark:` variant follows whatever color scheme was last
//     applied — if hydration crashed before theme was set, we get the
//     device default. Acceptable for a crash screen.
//   - `componentDidCatch` only fires for render-phase errors. Async
//     errors in effects / event handlers won't trigger this — those go
//     through `formatError` + `<ErrorMessage>` at the call site.

import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    if (__DEV__) {
      console.error("[ErrorBoundary] render crash", error, info.componentStack);
    }
  }

  private handleReset = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View className="flex-1 items-center justify-center bg-white px-6 dark:bg-slate-950">
        <View className="w-full max-w-md items-center">
          <View className="mb-4 h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-950/60">
            <Ionicons name="alert-circle" size={36} color="#DC2626" />
          </View>

          <Text className="mb-2 text-center text-xl font-semibold text-slate-900 dark:text-slate-100">
            แอปพบข้อผิดพลาด
          </Text>
          <Text className="mb-6 text-center text-sm text-slate-600 dark:text-slate-400">
            เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาลองใหม่อีกครั้ง หรือปิดแล้วเปิดแอปใหม่
          </Text>

          <Pressable
            onPress={this.handleReset}
            accessibilityRole="button"
            accessibilityLabel="ลองใหม่"
            className="mb-4 w-full items-center rounded-xl bg-blue-600 px-6 py-3 active:bg-blue-700"
          >
            <Text className="text-base font-medium text-white">ลองใหม่</Text>
          </Pressable>

          {__DEV__ && (
            <ScrollView
              className="max-h-48 w-full rounded-lg bg-slate-100 p-3 dark:bg-slate-900"
              contentContainerStyle={{ paddingBottom: 4 }}
            >
              <Text className="mb-1 font-mono text-xs text-slate-700 dark:text-slate-300">
                {error.name}: {error.message}
              </Text>
              {error.stack && (
                <Text
                  className="font-mono text-[10px] text-slate-500 dark:text-slate-500"
                  selectable
                >
                  {error.stack}
                </Text>
              )}
            </ScrollView>
          )}
        </View>
      </View>
    );
  }
}

export default ErrorBoundary;
