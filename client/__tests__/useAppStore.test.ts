import { useAppStore } from "@/store/useAppStore";

describe("useAppStore — smoke", () => {
  beforeEach(() => {
    useAppStore.setState({
      isAuthenticated: false,
      user: null,
      authInitialized: false,
      authToken: null,
      authErrorCode: null,
      authErrorMessage: null,
      authErrorRawMessage: null,
      readings: [],
      isOnline: true,
      posts: [],
      commentsByPostId: {},
      alerts: [],
      caregiverLinks: [],
      sessions: [],
      themePreference: "light",
      themeHydrated: false,
      fontSizePreference: "medium",
      hideSensitiveData: false,
      sensitiveDataUnlocked: false,
    });
  });

  it("starts unauthenticated with empty collections", () => {
    const s = useAppStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.authToken).toBeNull();
    expect(s.readings).toEqual([]);
    expect(s.posts).toEqual([]);
    expect(s.alerts).toEqual([]);
    expect(s.themePreference).toBe("light");
    expect(s.fontSizePreference).toBe("medium");
  });

  it("setNetworkStatus toggles isOnline", () => {
    useAppStore.getState().setNetworkStatus(false);
    expect(useAppStore.getState().isOnline).toBe(false);
    useAppStore.getState().setNetworkStatus(true);
    expect(useAppStore.getState().isOnline).toBe(true);
  });

  it("clearAuthError clears all three auth-error fields", () => {
    useAppStore.setState({
      authErrorCode: "auth/login-failed",
      authErrorMessage: "ผิดพลาด",
      authErrorRawMessage: "Invalid credentials",
    });
    useAppStore.getState().clearAuthError();
    const s = useAppStore.getState();
    expect(s.authErrorCode).toBeNull();
    expect(s.authErrorMessage).toBeNull();
    expect(s.authErrorRawMessage).toBeNull();
  });

  it("lockSensitiveData only locks when hideSensitiveData is on", () => {
    useAppStore.setState({
      hideSensitiveData: false,
      sensitiveDataUnlocked: true,
    });
    useAppStore.getState().lockSensitiveData();
    expect(useAppStore.getState().sensitiveDataUnlocked).toBe(true);

    useAppStore.setState({
      hideSensitiveData: true,
      sensitiveDataUnlocked: true,
    });
    useAppStore.getState().lockSensitiveData();
    expect(useAppStore.getState().sensitiveDataUnlocked).toBe(false);
  });

  it("logout wipes user-scoped state", () => {
    useAppStore.setState({
      isAuthenticated: true,
      user: { id: "u1", firstname: "A", lastname: "B", phone: "0000000000", createdAt: new Date() } as never,
      authToken: "tok",
      readings: [{ id: "r1" } as never],
      posts: [{ id: "p1" } as never],
      sessions: [{ id: "s1" } as never],
    });
    useAppStore.getState().logout();
    const s = useAppStore.getState();
    expect(s.isAuthenticated).toBe(false);
    expect(s.user).toBeNull();
    expect(s.authToken).toBeNull();
    expect(s.readings).toEqual([]);
    expect(s.posts).toEqual([]);
    expect(s.sessions).toEqual([]);
  });
});
