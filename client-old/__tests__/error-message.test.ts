import { formatError } from "@/lib/error-message";

describe("formatError", () => {
  it("maps timeout errors to a Thai user-facing message", () => {
    const result = formatError(new Error("Network request timed out"));
    expect(result.userMessage).toContain("เชื่อมต่อ");
  });

  it("maps network errors to a Thai user-facing message", () => {
    const result = formatError(new Error("Network request failed"));
    expect(result.userMessage).toContain("อินเทอร์เน็ต");
  });

  it("maps HTTP 401 to a session-expired message", () => {
    const result = formatError(new Error("Login failed: HTTP 401"));
    expect(result.userMessage).toContain("เซสชัน");
  });

  it("maps HTTP 5xx to a server-error message", () => {
    const result = formatError(new Error("HTTP 503"));
    expect(result.userMessage).toContain("เซิร์ฟเวอร์ขัดข้อง");
  });

  it("preserves Thai messages from the backend", () => {
    const result = formatError(new Error("ไม่พบผู้ใช้"));
    expect(result.userMessage).toBe("ไม่พบผู้ใช้");
  });

  it("falls back to the default for unknown English errors", () => {
    const result = formatError(new Error("Some weird internal exception"));
    expect(result.userMessage).toBe("เกิดข้อผิดพลาด กรุณาลองใหม่");
  });

  it("uses a custom fallback when provided", () => {
    const result = formatError(new Error("nope"), { fallback: "ลองใหม่นะ" });
    expect(result.userMessage).toBe("ลองใหม่นะ");
  });

  it("includes devDetail in __DEV__ mode", () => {
    const result = formatError(new Error("Some weird internal exception"));
    // jest defaults __DEV__ to true via jest-expo preset
    expect(result.devDetail).toBe("Some weird internal exception");
  });

  it("never reveals the raw English message in the user-facing field", () => {
    const result = formatError(new Error("Database constraint violation: users.phone"));
    expect(result.userMessage).not.toContain("Database");
    expect(result.userMessage).not.toContain("phone");
  });
});
