process.env.EXPO_PUBLIC_API_URL ??= "http://localhost:3000/graphql";

jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock"),
);

// SecureStore: backed by AsyncStorage in tests so the auth-token helpers work.
jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      store.set(key, value);
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      store.delete(key);
    }),
  };
});

// SQLite: the offline queue isn't exercised by smoke tests; stub the helpers.
jest.mock("@/data/local-db", () => ({
  insertPendingReading: jest.fn(async () => 0),
  listPendingReadings: jest.fn(async () => []),
  deletePendingReading: jest.fn(async () => undefined),
  insertLocalPost: jest.fn(async () => 0),
  listLocalPosts: jest.fn(async () => []),
  deleteLocalPost: jest.fn(async () => undefined),
  updateLocalPost: jest.fn(async () => undefined),
  queuePendingPostAction: jest.fn(async () => undefined),
  listPendingPostActions: jest.fn(async () => []),
  deletePendingPostAction: jest.fn(async () => undefined),
  clearUserLocalData: jest.fn(async () => undefined),
}));

jest.mock("expo-sqlite", () => ({
  openDatabaseSync: jest.fn(() => ({
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 0, changes: 0 })),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
  })),
}));

// Fetch is used by the GraphQL client; default to a rejecting stub so tests
// that touch the network must explicitly opt-in.
if (!(globalThis as { fetch?: typeof fetch }).fetch) {
  (globalThis as { fetch: typeof fetch }).fetch = jest.fn(() =>
    Promise.reject(new Error("fetch not mocked in this test")),
  ) as unknown as typeof fetch;
}
