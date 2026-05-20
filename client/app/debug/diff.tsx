import { GradientBackground } from "@/components/gradient-background";
import { graphqlRequest } from "@/src/core/graphql/client";
import { GQL_DEBUG_MY_STORAGE } from "@/src/core/graphql/operations";
import { getPendingAvatarUpload } from "@/src/data/queries/avatars";
import { listPendingReadings } from "@/src/data/queries/readings";
import { useAppStore } from "@/src/store/use-app-store";
import { useCallback, useEffect, useState } from "react";
import {
    RefreshControl,
    ScrollView,
    Text,
    View,
} from "react-native";
import { DebugHeader, Pre, stringify, useIsDark } from "./_shared";

interface ServerItem {
  source: string;
  refId: string;
  rawKey: string | null;
  s3Exists: boolean;
  s3ContentLength: number | null;
  note: string | null;
}

interface ServerResponse {
  debugMyStorage: {
    generatedAt: string;
    userId: string;
    items: ServerItem[];
  };
}

interface DiffRow {
  refId: string;
  source: string;
  inSqlite: boolean;
  inStore: boolean;
  inDb: boolean;
  inS3: boolean;
  rawKey: string | null;
  s3ContentLength: number | null;
  note: string | null;
}

const formatBytes = (n: number | null): string => {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

const Tick = ({ on, label }: { on: boolean; label: string }) => (
  <View className={"px-1.5 py-0.5 rounded mr-1 " + (on ? "bg-emerald-500" : "bg-gray-400")}>
    <Text className="text-white text-[10px] font-bold">
      {on ? "✓" : "✕"} {label}
    </Text>
  </View>
);

const Row = ({ row, isDark }: { row: DiffRow; isDark: boolean }) => {
  // Inconsistency flags — anything that should match across tiers but doesn't.
  const flags: string[] = [];
  if (row.inDb && !row.inS3) flags.push("DB→S3 missing");
  if (row.inStore && !row.inDb) flags.push("store→DB drift");
  if (row.inSqlite && row.inStore) flags.push("queued but already in store?");

  return (
    <View
      className={
        "mb-2 rounded-lg p-3 border " +
        (flags.length > 0
          ? "border-red-400"
          : isDark
            ? "border-slate-700"
            : "border-gray-200") +
        " " +
        (isDark ? "bg-slate-900" : "bg-white")
      }
    >
      <View className="flex-row items-center mb-1.5">
        <Text className={(isDark ? "text-slate-100" : "text-gray-800") + " text-xs font-bold mr-2"}>
          {row.refId}
        </Text>
        <View className={"px-1.5 py-0.5 rounded " + (isDark ? "bg-slate-700" : "bg-gray-200")}>
          <Text className={(isDark ? "text-slate-200" : "text-gray-600") + " text-[10px] uppercase font-bold"}>
            {row.source}
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap mb-1">
        <Tick on={row.inSqlite} label="SQLite" />
        <Tick on={row.inStore} label="Store" />
        <Tick on={row.inDb} label="DB" />
        <Tick on={row.inS3} label="S3" />
      </View>

      {row.rawKey ? (
        <Text selectable className={(isDark ? "text-slate-300" : "text-gray-600") + " text-[11px]"}>
          {row.rawKey}
        </Text>
      ) : null}

      <View className="flex-row mt-1">
        <Text className={(isDark ? "text-slate-400" : "text-gray-500") + " text-[10px] mr-3"}>
          size: {formatBytes(row.s3ContentLength)}
        </Text>
      </View>

      {row.note ? (
        <Text className={(isDark ? "text-slate-400" : "text-gray-500") + " text-[10px] mt-0.5"}>
          {row.note}
        </Text>
      ) : null}

      {flags.length > 0 ? (
        <View className="mt-1.5 flex-row flex-wrap">
          {flags.map((f) => (
            <View key={f} className="bg-red-500 px-1.5 py-0.5 rounded mr-1 mb-1">
              <Text className="text-white text-[10px] font-bold">{f}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
};

const isRemote = (uri: string | null | undefined): uri is string =>
  typeof uri === "string" && /^https?:\/\//i.test(uri);

const isLocal = (uri: string | null | undefined): uri is string =>
  typeof uri === "string" && uri.startsWith("file://");

const stripQuery = (url: string): string => {
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
};

// Match a signed-URL the store holds against a raw key the server reports.
// The store's value has signature query params + S3 host prefix; the
// server's rawKey is just `users/.../uuid.jpg`. We compare on suffix.
const storeUrlMatchesKey = (
  storeUrl: string | null | undefined,
  rawKey: string | null | undefined,
): boolean => {
  if (!isRemote(storeUrl) || !rawKey) return false;
  return stripQuery(storeUrl).endsWith(rawKey);
};

export default function DebugDiffPage() {
  const isDark = useIsDark();
  const [rows, setRows] = useState<DiffRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError(null);
    try {
      const token = useAppStore.getState().authToken;
      const user = useAppStore.getState().user;
      if (!token || !user) {
        setError("กรุณาเข้าสู่ระบบก่อนใช้งานหน้านี้");
        setRows([]);
        return;
      }

      // ── Server side ──
      let server: ServerResponse["debugMyStorage"];
      try {
        const data = await graphqlRequest<ServerResponse>(
          GQL_DEBUG_MY_STORAGE,
          undefined,
          token,
        );
        server = data.debugMyStorage;
        setGeneratedAt(server.generatedAt);
      } catch (e) {
        setError(e instanceof Error ? e.message : "GraphQL error");
        return;
      }

      // ── Local SQLite ──
      const sqlitePendingAvatar = await getPendingAvatarUpload(user.id);
      const sqlitePendingReadings = await listPendingReadings(user.id);

      // ── Store ──
      const state = useAppStore.getState();
      const storeAvatar = state.user?.avatar ?? null;
      const storeReadings = state.readings;

      // ── Build diff rows keyed by server.refId ──
      const out: DiffRow[] = [];

      for (const item of server.items) {
        let inSqlite = false;
        let inStore = false;

        if (item.source === "avatar") {
          inSqlite = Boolean(sqlitePendingAvatar);
          inStore = storeUrlMatchesKey(storeAvatar, item.rawKey);
        } else if (item.source === "reading") {
          const readingId = item.refId.replace(/^reading:/, "");
          // SQLite has rows keyed by local autoinc id, not server id —
          // a reading shown by the server can't also be in pending.
          inSqlite = false;
          const storeRow = storeReadings.find((r) => String(r.id) === readingId);
          inStore = Boolean(
            storeRow && storeUrlMatchesKey(storeRow.imageUri, item.rawKey),
          );
        } else if (item.source === "image") {
          // Image table — not directly mirrored to store; we just know
          // about it from the server response.
          inSqlite = false;
          inStore = false;
        }

        out.push({
          refId: item.refId,
          source: item.source,
          inSqlite,
          inStore,
          inDb: true,
          inS3: item.s3Exists,
          rawKey: item.rawKey,
          s3ContentLength: item.s3ContentLength,
          note: item.note,
        });
      }

      // Add SQLite-only rows (queued media the server doesn't know about yet).
      if (sqlitePendingAvatar) {
        out.push({
          refId: "avatar (pending)",
          source: "avatar",
          inSqlite: true,
          inStore: isLocal(storeAvatar) && storeAvatar === sqlitePendingAvatar.localUri,
          inDb: false,
          inS3: false,
          rawKey: sqlitePendingAvatar.localUri,
          s3ContentLength: null,
          note: `queued at ${sqlitePendingAvatar.createdAt}`,
        });
      }

      for (const r of sqlitePendingReadings) {
        if (!isLocal(r.imageUri)) continue;
        out.push({
          refId: `reading:local-${r.id}`,
          source: "reading",
          inSqlite: true,
          inStore: true,
          inDb: false,
          inS3: false,
          rawKey: r.imageUri,
          s3ContentLength: null,
          note: `clientId=${r.clientId ?? "—"}`,
        });
      }

      setRows(out);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const counts = rows.reduce(
    (acc, r) => {
      if (r.inSqlite) acc.sqlite += 1;
      if (r.inStore) acc.store += 1;
      if (r.inDb) acc.db += 1;
      if (r.inS3) acc.s3 += 1;
      return acc;
    },
    { sqlite: 0, store: 0, db: 0, s3: 0 },
  );

  return (
    <GradientBackground>
      <DebugHeader title="Cross-tier diff" onRefresh={() => void refresh()} />
      <ScrollView
        className="flex-1 px-3 pt-2"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void refresh()}
          />
        }
      >
        <Text className={(isDark ? "text-slate-300" : "text-gray-600") + " text-xs mb-2 leading-5"}>
          เทียบ media refs ของ user ตัวเองข้าม 4 ชั้น: SQLite queue · Zustand store ·
          Prisma DB · S3 (HEAD-checked สดๆ). แถวสีแดงคือ inconsistency
        </Text>

        {error ? (
          <View className="bg-red-500 rounded-xl p-3 mb-3">
            <Text className="text-white text-xs">{error}</Text>
          </View>
        ) : null}

        {generatedAt ? (
          <Text className={(isDark ? "text-slate-400" : "text-gray-500") + " text-[10px] mb-2"}>
            server time: {generatedAt}
          </Text>
        ) : null}

        <View className="mb-3 rounded-xl overflow-hidden">
          <View className="bg-blue-500 px-3 py-2">
            <Text className="text-white font-bold">Totals</Text>
          </View>
          <Pre isDark={isDark} text={stringify(counts)} />
        </View>

        {rows.length === 0 && !error ? (
          <Text className={(isDark ? "text-slate-400" : "text-gray-500") + " text-center mt-6"}>
            ไม่มี media refs
          </Text>
        ) : null}

        {rows.map((r) => (
          <Row key={r.refId} row={r} isDark={isDark} />
        ))}

        <View className="h-12" />
      </ScrollView>
    </GradientBackground>
  );
}
