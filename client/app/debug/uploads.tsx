import { GradientBackground } from "@/components/gradient-background";
import { getPendingAvatarUpload } from "@/src/data/queries/avatars";
import { listPendingReadings } from "@/src/data/queries/readings";
import type {
    PendingAvatarUploadRow,
    PendingReadingRow,
} from "@/src/types/database";
import { useAppStore } from "@/src/store/use-app-store";
import { File } from "expo-file-system";
import { useCallback, useEffect, useState } from "react";
import {
    Image,
    RefreshControl,
    ScrollView,
    Text,
    View,
} from "react-native";
import { DebugHeader, useIsDark } from "./_shared";

interface MediaItem {
  uri: string;
  kind: "avatar" | "reading";
  source: "pending" | "synced";
  meta: Record<string, unknown>;
}

const SYNCED_READINGS_CAP = 20;

const isRemote = (uri: string | null | undefined): uri is string =>
  typeof uri === "string" && /^https?:\/\//i.test(uri);

const isLocalFile = (uri: string | null | undefined): uri is string =>
  typeof uri === "string" && uri.startsWith("file://");

const safeFileSize = (uri: string): number | null => {
  try {
    return new File(uri).size;
  } catch {
    return null;
  }
};

const formatBytes = (n: number | null): string => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const pendingAvatarToItem = (
  row: PendingAvatarUploadRow,
): MediaItem | null => {
  if (!isLocalFile(row.localUri)) return null;
  return {
    uri: row.localUri,
    kind: "avatar",
    source: "pending",
    meta: {
      createdAt: row.createdAt,
      sizeBytes: safeFileSize(row.localUri),
    },
  };
};

const pendingReadingToItem = (row: PendingReadingRow): MediaItem | null => {
  if (!isLocalFile(row.imageUri)) return null;
  return {
    uri: row.imageUri,
    kind: "reading",
    source: "pending",
    meta: {
      localId: row.id,
      clientId: row.clientId,
      measuredAt: row.measuredAt,
      sizeBytes: safeFileSize(row.imageUri),
    },
  };
};

const Thumb = ({ item, isDark }: { item: MediaItem; isDark: boolean }) => {
  const [failed, setFailed] = useState(false);
  return (
    <View
      className={
        "mb-3 rounded-xl overflow-hidden border " +
        (isDark
          ? "bg-slate-900 border-slate-700"
          : "bg-white border-gray-200")
      }
    >
      <View className="flex-row p-3">
        <View
          className={
            "w-20 h-20 rounded-lg overflow-hidden mr-3 " +
            (isDark ? "bg-slate-800" : "bg-gray-100")
          }
        >
          {failed ? (
            <View className="flex-1 items-center justify-center">
              <Text
                className={
                  (isDark ? "text-slate-400" : "text-gray-400") + " text-xs"
                }
              >
                load failed
              </Text>
            </View>
          ) : (
            <Image
              source={{ uri: item.uri }}
              className="w-full h-full"
              resizeMode="cover"
              onError={() => setFailed(true)}
            />
          )}
        </View>

        <View className="flex-1">
          <View className="flex-row items-center mb-1">
            <View
              className={
                "px-2 py-0.5 rounded-full mr-2 " +
                (item.source === "pending"
                  ? "bg-orange-500"
                  : "bg-emerald-500")
              }
            >
              <Text className="text-white text-[10px] font-bold uppercase">
                {item.source}
              </Text>
            </View>
            <View
              className={
                "px-2 py-0.5 rounded-full " +
                (isDark ? "bg-slate-700" : "bg-gray-200")
              }
            >
              <Text
                className={
                  (isDark ? "text-slate-200" : "text-gray-700") +
                  " text-[10px] font-bold uppercase"
                }
              >
                {item.kind}
              </Text>
            </View>
          </View>

          <Text
            selectable
            numberOfLines={2}
            className={
              (isDark ? "text-slate-200" : "text-gray-800") + " text-xs"
            }
          >
            {item.uri}
          </Text>

          {Object.entries(item.meta).map(([k, v]) => (
            <Text
              key={k}
              className={
                (isDark ? "text-slate-400" : "text-gray-500") +
                " text-[11px] mt-0.5"
              }
            >
              {k}:{" "}
              {k === "sizeBytes"
                ? formatBytes(typeof v === "number" ? v : null)
                : v instanceof Date
                  ? v.toISOString()
                  : String(v ?? "—")}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
};

const Section = ({
  title,
  count,
  emptyText,
  items,
  isDark,
  accent,
}: {
  title: string;
  count: number;
  emptyText: string;
  items: MediaItem[];
  isDark: boolean;
  accent: string;
}) => (
  <View className="mb-4">
    <View
      className="px-3 py-2 rounded-t-xl flex-row justify-between items-center"
      style={{ backgroundColor: accent }}
    >
      <Text className="text-white font-bold">{title}</Text>
      <Text className="text-white">{count}</Text>
    </View>
    <View
      className={
        "rounded-b-xl p-2 " + (isDark ? "bg-slate-950/40" : "bg-gray-50")
      }
    >
      {items.length === 0 ? (
        <Text
          className={
            (isDark ? "text-slate-400" : "text-gray-500") +
            " text-xs italic px-2 py-3"
          }
        >
          {emptyText}
        </Text>
      ) : (
        items.map((it, i) => (
          <Thumb key={`${it.source}-${it.kind}-${i}-${it.uri}`} item={it} isDark={isDark} />
        ))
      )}
    </View>
  </View>
);

export default function DebugUploadsPage() {
  const isDark = useIsDark();
  const [pending, setPending] = useState<MediaItem[]>([]);
  const [synced, setSynced] = useState<MediaItem[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const state = useAppStore.getState();
      const user = state.user;

      // ── Pending: read straight from SQLite (truth is in the queue,
      // not the store — the store only mirrors the latest pick) ──
      const pendingItems: MediaItem[] = [];
      if (user) {
        try {
          const avatar = await getPendingAvatarUpload(user.id);
          if (avatar) {
            const item = pendingAvatarToItem(avatar);
            if (item) pendingItems.push(item);
          }
        } catch {
          // SQLite unavailable (web) — leave the section empty.
        }
        try {
          const readings = await listPendingReadings(user.id);
          for (const r of readings) {
            const item = pendingReadingToItem(r);
            if (item) pendingItems.push(item);
          }
        } catch {
          // see above.
        }
      }
      setPending(pendingItems);

      // ── Synced: read from the store; URIs are signed GET URLs from
      // the gateway (10-min TTL) ──
      const syncedItems: MediaItem[] = [];
      if (isRemote(user?.avatar)) {
        syncedItems.push({
          uri: user.avatar,
          kind: "avatar",
          source: "synced",
          meta: { userId: user.id },
        });
      }
      const recent = state.readings.slice(0, SYNCED_READINGS_CAP);
      for (const r of recent) {
        if (isRemote(r.imageUri)) {
          syncedItems.push({
            uri: r.imageUri,
            kind: "reading",
            source: "synced",
            meta: {
              id: r.id,
              measuredAt: r.measuredAt,
              status: r.status,
            },
          });
        }
      }
      setSynced(syncedItems);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <GradientBackground>
      <DebugHeader title="Uploads" onRefresh={() => void refresh()} />
      <ScrollView
        className="flex-1 px-3 pt-2"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        }
      >
        <Text
          className={
            (isDark ? "text-slate-300" : "text-gray-600") +
            " text-xs mb-3 leading-5"
          }
        >
          Pending = ยังอยู่ใน SQLite queue, รอ sync ขึ้น S3. Synced = signed GET URL
          จาก server (อายุ ~10 นาที — ถ้าหมดอายุ thumbnail จะ load failed
          ให้กด refresh เพื่อ resign)
        </Text>

        <Section
          title="Pending"
          count={pending.length}
          emptyText="ไม่มีไฟล์ที่รอ sync"
          items={pending}
          isDark={isDark}
          accent="#F97316"
        />

        <Section
          title={`Synced (latest ${SYNCED_READINGS_CAP} readings)`}
          count={synced.length}
          emptyText="ยังไม่มีไฟล์ที่ sync แล้ว — ลอง refresh หลังจาก fetchReadings"
          items={synced}
          isDark={isDark}
          accent="#10B981"
        />

        <View className="h-12" />
      </ScrollView>
    </GradientBackground>
  );
}
