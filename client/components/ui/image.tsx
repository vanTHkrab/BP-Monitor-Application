import { Image, ImageContentFit, ImageSource } from "expo-image";
import { cssInterop } from "nativewind";
import { ReactNode, useEffect, useState } from "react";
import { View } from "react-native";

cssInterop(Image, { className: "style" });

type Source = string | number | ImageSource | null | undefined;

const normalize = (
  s: Source,
): ImageSource | number | undefined => {
  if (s == null) return undefined;
  if (typeof s === "number") return s;
  if (typeof s === "string") {
    const trimmed = s.trim();
    return trimmed ? { uri: trimmed } : undefined;
  }
  return s;
};

const identityOf = (s: Source): string => {
  if (s == null) return "";
  if (typeof s === "number") return `m:${s}`;
  if (typeof s === "string") return `s:${s}`;
  return s.uri ? `u:${s.uri}` : "";
};

export type UIImageProps = {
  source?: Source;
  className?: string;
  contentFit?: ImageContentFit;
  placeholder?: string;
  transition?: number;
  recyclingKey?: string;
  fallback?: ReactNode;
  accessibilityLabel?: string;
  cachePolicy?: "none" | "disk" | "memory" | "memory-disk";
};

export const UIImage = ({
  source,
  className,
  contentFit = "cover",
  placeholder,
  transition = 200,
  recyclingKey,
  fallback,
  accessibilityLabel,
  cachePolicy = "memory-disk",
}: UIImageProps) => {
  const normalized = normalize(source);
  const sourceKey = identityOf(source);
  const [errored, setErrored] = useState(false);

  useEffect(() => {
    setErrored(false);
  }, [sourceKey]);

  if (normalized === undefined || errored) {
    if (fallback) return <>{fallback}</>;
    return className ? <View className={className} /> : null;
  }

  return (
    <Image
      source={normalized}
      className={className}
      contentFit={contentFit}
      placeholder={placeholder ? { blurhash: placeholder } : undefined}
      transition={transition}
      recyclingKey={recyclingKey}
      cachePolicy={cachePolicy}
      onError={() => setErrored(true)}
      accessibilityLabel={accessibilityLabel}
    />
  );
};
