import { formatError } from "@/src/core/error/error.handler";
import type { FormattedError } from "@/src/core/error/error.types";
import { useAppStore } from "@/src/store/use-app-store";
import { getFontClass } from "@/src/utils/font-scale";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Pressable, Text, View } from "react-native";

type Severity = "error" | "warning" | "info";

interface ErrorMessageProps {
  /** Raw error / Error / string. Will be normalized via formatError. */
  error?: unknown;
  /** Override the user-facing message. Use when the caller already localized it. */
  userMessage?: string;
  /** Override the dev-only detail. Ignored in production. */
  devDetail?: string;
  /** Optional dev-only code (e.g. "auth/login-failed"). Ignored in production. */
  devCode?: string;
  /** Fallback Thai message if the error can't be classified. */
  fallback?: string;
  severity?: Severity;
  /** Optional close handler — renders a dismiss "X" when provided. */
  onDismiss?: () => void;
  className?: string;
}

const severityStyles: Record<
  Severity,
  { icon: keyof typeof Ionicons.glyphMap; bg: string; bgDark: string; iconColor: string; border: string; borderDark: string }
> = {
  error: {
    icon: "alert-circle",
    bg: "bg-red-50",
    bgDark: "bg-red-950/40",
    iconColor: "#DC2626",
    border: "border-red-200",
    borderDark: "border-red-900/60",
  },
  warning: {
    icon: "warning",
    bg: "bg-amber-50",
    bgDark: "bg-amber-950/40",
    iconColor: "#D97706",
    border: "border-amber-200",
    borderDark: "border-amber-900/60",
  },
  info: {
    icon: "information-circle",
    bg: "bg-sky-50",
    bgDark: "bg-sky-950/40",
    iconColor: "#0284C7",
    border: "border-sky-200",
    borderDark: "border-sky-900/60",
  },
};

const resolve = (props: ErrorMessageProps): FormattedError | null => {
  if (props.userMessage) {
    return {
      userMessage: props.userMessage,
      devDetail: __DEV__ ? props.devDetail : undefined,
      devCode: __DEV__ ? props.devCode : undefined,
    };
  }
  if (props.error === undefined || props.error === null) return null;
  return formatError(props.error, {
    fallback: props.fallback,
    code: props.devCode,
  });
};

export const ErrorMessage: React.FC<ErrorMessageProps> = (props) => {
  const themePreference = useAppStore((s) => s.themePreference);
  const fontSizePreference = useAppStore((s) => s.fontSizePreference);
  const isDark = themePreference === "dark";
  const [expanded, setExpanded] = useState(false);

  const formatted = resolve(props);
  if (!formatted) return null;

  const severity = props.severity ?? "error";
  const palette = severityStyles[severity];

  const textSize = getFontClass(fontSizePreference, {
    small: "text-xs",
    medium: "text-sm",
    large: "text-base",
    xlarge: "text-lg",
  });

  const detailSize = getFontClass(fontSizePreference, {
    small: "text-[10px]",
    medium: "text-xs",
    large: "text-sm",
    xlarge: "text-base",
  });

  const hasDevDetail =
    __DEV__ && Boolean(formatted.devDetail || formatted.devCode);

  return (
    <View
      className={
        `flex-row items-start rounded-xl border p-3 ` +
        (isDark ? `${palette.bgDark} ${palette.borderDark} ` : `${palette.bg} ${palette.border} `) +
        (props.className ?? "")
      }
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
    >
      <Ionicons
        name={palette.icon}
        size={20}
        color={palette.iconColor}
        style={{ marginTop: 1 }}
      />
      <View className="flex-1 ml-2">
        <Text
          className={`font-medium ${textSize} ${isDark ? "text-slate-100" : "text-slate-900"}`}
        >
          {formatted.userMessage}
        </Text>

        {hasDevDetail && (
          <View className="mt-2">
            <Pressable
              onPress={() => setExpanded((v) => !v)}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={
                expanded ? "Hide developer details" : "Show developer details"
              }
            >
              <Text
                className={`${detailSize} ${isDark ? "text-slate-400" : "text-slate-500"}`}
              >
                {expanded ? "▼ Hide details (dev only)" : "▶ Show details (dev only)"}
              </Text>
            </Pressable>
            {expanded && (
              <View
                className={`mt-1 rounded-md px-2 py-1.5 ${isDark ? "bg-slate-900/60" : "bg-white/60"}`}
              >
                {formatted.devCode && (
                  <Text
                    className={`${detailSize} font-mono ${isDark ? "text-slate-300" : "text-slate-600"}`}
                  >
                    code: {formatted.devCode}
                  </Text>
                )}
                {formatted.devDetail && (
                  <Text
                    className={`${detailSize} font-mono ${isDark ? "text-slate-300" : "text-slate-600"}`}
                    selectable
                  >
                    {formatted.devDetail}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}
      </View>

      {props.onDismiss && (
        <Pressable
          onPress={props.onDismiss}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          className="ml-2"
        >
          <Ionicons
            name="close"
            size={18}
            color={isDark ? "#94A3B8" : "#64748B"}
          />
        </Pressable>
      )}
    </View>
  );
};

export default ErrorMessage;
