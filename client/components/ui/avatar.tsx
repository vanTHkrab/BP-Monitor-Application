import { Ionicons } from "@expo/vector-icons";
import { ReactNode } from "react";
import { Text, View } from "react-native";

import { UIImage } from "./image";

export type AvatarSize = "xs" | "sm" | "md" | "lg" | "xl";

type SizeTokens = { box: string; text: string; icon: number };

const sizeMap: Record<AvatarSize, SizeTokens> = {
  xs: { box: "w-6 h-6", text: "text-[10px]", icon: 12 },
  sm: { box: "w-8 h-8", text: "text-xs", icon: 16 },
  md: { box: "w-12 h-12", text: "text-base", icon: 24 },
  lg: { box: "w-20 h-20", text: "text-xl", icon: 36 },
  xl: { box: "w-28 h-28", text: "text-3xl", icon: 48 },
};

const FALLBACK_ICON_COLOR = "#94A3B8"; // slate-400 — readable on both themes

export type AvatarProps = {
  uri?: string | null;
  name?: string;
  size?: AvatarSize;
  className?: string;
  fallback?: ReactNode;
  accessibilityLabel?: string;
};

const getInitials = (name?: string): string | null => {
  if (!name) return null;
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return null;
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  const initials = (first + last).toUpperCase();
  return initials || null;
};

export const Avatar = ({
  uri,
  name,
  size = "md",
  className = "",
  fallback,
  accessibilityLabel,
}: AvatarProps) => {
  const { box, text, icon } = sizeMap[size];
  const base = `${box} rounded-full overflow-hidden bg-slate-200 dark:bg-slate-800 ${className}`.trim();
  const initials = getInitials(name);

  const defaultFallback = (
    <View
      className={`${base} items-center justify-center`}
      accessibilityLabel={accessibilityLabel ?? (name ? `Avatar for ${name}` : "Avatar")}
    >
      {initials ? (
        <Text className={`${text} font-semibold text-slate-600 dark:text-slate-300`}>
          {initials}
        </Text>
      ) : (
        <Ionicons name="person" size={icon} color={FALLBACK_ICON_COLOR} />
      )}
    </View>
  );

  return (
    <UIImage
      source={uri}
      className={base}
      contentFit="cover"
      fallback={fallback ?? defaultFallback}
      accessibilityLabel={accessibilityLabel ?? (name ? `Avatar for ${name}` : undefined)}
    />
  );
};
