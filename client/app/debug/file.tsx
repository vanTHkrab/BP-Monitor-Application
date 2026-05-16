import { GradientBackground } from "@/components/gradient-background";
import { Directory, File, Paths } from "expo-file-system";
import { useCallback, useEffect, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { DebugHeader, Pre, stringify, useIsDark } from "./_shared";

interface Entry {
  path: string;
  uri: string;
  kind: "file" | "dir";
  size: number | null;
  mtime: string | null;
}

interface RootDump {
  label: string;
  uri: string;
  exists: boolean;
  entries: Entry[];
  totalBytes: number;
  truncated: boolean;
}

const MAX_DEPTH = 2;
const MAX_ENTRIES = 200;

const nameFromUri = (uri: string) => {
  const trimmed = uri.replace(/\/+$/, "");
  return trimmed.split("/").pop() || trimmed;
};

const formatBytes = (n: number | null): string => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
};

const walk = (
  root: Directory,
  maxDepth: number,
  maxEntries: number,
): { entries: Entry[]; truncated: boolean; totalBytes: number } => {
  const rootUri = root.uri;
  const out: Entry[] = [];
  let totalBytes = 0;
  let truncated = false;

  const visit = (dir: Directory, depth: number) => {
    if (truncated) return;
    if (depth > maxDepth) return;
    let items: (Directory | File)[];
    try {
      items = dir.list();
    } catch {
      return;
    }
    for (const item of items) {
      if (out.length >= maxEntries) {
        truncated = true;
        return;
      }
      const isDir = item instanceof Directory;
      const relPath = item.uri.startsWith(rootUri)
        ? item.uri.slice(rootUri.length) || nameFromUri(item.uri)
        : item.uri;
      let mtime: string | null = null;
      let size: number | null = null;
      if (!isDir) {
        const file = item as File;
        size = file.size;
        if (size != null) totalBytes += size;
        if (file.modificationTime != null) {
          mtime = new Date(file.modificationTime).toISOString();
        }
      }
      out.push({
        path: relPath,
        uri: item.uri,
        kind: isDir ? "dir" : "file",
        size,
        mtime,
      });
      if (isDir) visit(item as Directory, depth + 1);
    }
  };

  visit(root, 0);
  return { entries: out, truncated, totalBytes };
};

const safeDumpRoot = (label: string, dir: Directory): RootDump => {
  try {
    const exists = dir.exists;
    if (!exists) {
      return {
        label,
        uri: dir.uri,
        exists: false,
        entries: [],
        totalBytes: 0,
        truncated: false,
      };
    }
    const { entries, truncated, totalBytes } = walk(
      dir,
      MAX_DEPTH,
      MAX_ENTRIES,
    );
    return { label, uri: dir.uri, exists: true, entries, totalBytes, truncated };
  } catch (e) {
    return {
      label,
      uri: dir.uri,
      exists: false,
      entries: [
        {
          path: `[error: ${e instanceof Error ? e.message : "unknown"}]`,
          uri: dir.uri,
          kind: "dir",
          size: null,
          mtime: null,
        },
      ],
      totalBytes: 0,
      truncated: false,
    };
  }
};

export default function DebugFilePage() {
  const isDark = useIsDark();
  const [roots, setRoots] = useState<RootDump[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(() => {
    setRefreshing(true);
    try {
      setRoots([
        safeDumpRoot("document", Paths.document),
        safeDumpRoot("cache", Paths.cache),
      ]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <GradientBackground>
      <DebugHeader title="FileSystem" onRefresh={refresh} />
      <ScrollView
        className="flex-1 px-3 pt-2"
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={refresh} />
        }
      >
        {roots.map((root) => (
          <View
            key={root.label}
            className="mb-4 rounded-xl overflow-hidden"
          >
            <View className="bg-blue-500 px-3 py-2">
              <Text className="text-white font-bold">
                {root.label} {root.exists ? "" : "(missing)"}
              </Text>
              <Text className="text-white text-xs mt-0.5" selectable>
                {root.uri}
              </Text>
              <Text className="text-white text-xs mt-0.5">
                {root.entries.length} entries · total{" "}
                {formatBytes(root.totalBytes)}
                {root.truncated ? ` · truncated at ${MAX_ENTRIES}` : ""}
              </Text>
            </View>
            <Pre
              isDark={isDark}
              text={stringify(
                root.entries.map((e) => ({
                  path: e.path,
                  kind: e.kind,
                  size: e.kind === "file" ? formatBytes(e.size) : null,
                  mtime: e.mtime,
                })),
              )}
            />
          </View>
        ))}
        <View className="h-12" />
      </ScrollView>
    </GradientBackground>
  );
}
