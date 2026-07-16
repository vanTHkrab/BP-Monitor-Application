import {
  clientKeyFromPendingImageFilename,
  isOrphanedPendingImageFilename,
  pendingImageFilename,
  sanitizeClientIdForFilename,
} from "@/utils/pending-image-store";

// Only the pure filename/orphan-matching helpers are covered here — the
// copy/delete/sweep I/O paths need real expo-file-system Directory/File
// behavior that jsdom can't provide without native mocks.

describe("sanitizeClientIdForFilename", () => {
  it("passes through createClientId-shaped ids unchanged", () => {
    const id = "reading-42-m3k9zq-a1b2c3d4e5f6g7h8i9j0";
    expect(sanitizeClientIdForFilename(id)).toBe(id);
  });

  it("replaces path-hostile characters", () => {
    expect(sanitizeClientIdForFilename("read/../ing:1 x")).toBe(
      "read_.._ing_1_x",
    );
  });
});

describe("pendingImageFilename", () => {
  it("keys the file to the clientId and keeps the source extension", () => {
    expect(pendingImageFilename("reading-1-abc", "file:///cache/img.jpg")).toBe(
      "reading-1-abc.jpg",
    );
    expect(pendingImageFilename("reading-1-abc", "file:///cache/img.PNG")).toBe(
      "reading-1-abc.png",
    );
  });

  it("ignores query strings when extracting the extension", () => {
    expect(
      pendingImageFilename("reading-1-abc", "file:///cache/img.webp?x=1"),
    ).toBe("reading-1-abc.webp");
  });

  it("defaults to .jpg for extension-less or weird URIs", () => {
    expect(pendingImageFilename("reading-1-abc", "content://media/1234")).toBe(
      "reading-1-abc.jpg",
    );
    expect(
      pendingImageFilename("reading-1-abc", "file:///cache/img.notanext"),
    ).toBe("reading-1-abc.jpg");
  });
});

describe("clientKeyFromPendingImageFilename", () => {
  it("round-trips with pendingImageFilename", () => {
    const clientId = "reading-42-m3k9zq-a1b2c3";
    const filename = pendingImageFilename(clientId, "file:///cache/x.jpeg");
    expect(clientKeyFromPendingImageFilename(filename)).toBe(
      sanitizeClientIdForFilename(clientId),
    );
  });

  it("only strips a trailing extension, not dots inside the key", () => {
    expect(clientKeyFromPendingImageFilename("a.b.c.jpg")).toBe("a.b.c");
    expect(clientKeyFromPendingImageFilename("noext")).toBe("noext");
  });
});

describe("isOrphanedPendingImageFilename", () => {
  const active = new Set(
    ["reading-1-live", "reading-2-live"].map(sanitizeClientIdForFilename),
  );

  it("keeps files whose clientId is still queued", () => {
    expect(isOrphanedPendingImageFilename("reading-1-live.jpg", active)).toBe(
      false,
    );
  });

  it("sweeps files whose clientId is no longer queued", () => {
    expect(isOrphanedPendingImageFilename("reading-9-gone.jpg", active)).toBe(
      true,
    );
    expect(isOrphanedPendingImageFilename("junk.png", active)).toBe(true);
  });

  it("sweeps everything when the queue is empty", () => {
    expect(
      isOrphanedPendingImageFilename("reading-1-live.jpg", new Set()),
    ).toBe(true);
  });
});
