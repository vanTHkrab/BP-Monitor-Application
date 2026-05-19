import { resolveImageUri } from "@/src/utils/image-cache";
import { useEffect, useState } from "react";

// Returns either the remote URI (initially / while resolving) or a
// file:// URI once the local image cache has it. Falls back to the
// remote URI on resolution failure so the <Image> can still try.
//
// The state intentionally starts at the remote URI so the UI shows the
// network image immediately when no cache entry exists — instead of
// flashing the fallback while we round-trip SQLite + file system.
export const useResolvedImageUri = (
  remoteUri: string | undefined | null,
): string | undefined => {
  const [resolved, setResolved] = useState<string | undefined>(
    remoteUri ?? undefined,
  );

  useEffect(() => {
    let active = true;
    setResolved(remoteUri ?? undefined);
    if (!remoteUri) return () => {
      active = false;
    };
    resolveImageUri(remoteUri)
      .then((next) => {
        // Replace state even when `next` is undefined — that's the cache
        // signaling "download failed, don't keep showing the stale URL"
        // so the consumer can fall through to its fallback UI.
        if (active) setResolved(next);
      })
      .catch(() => {
        // resolveImageUri logs internally; if it threw anyway, leave the
        // last good URI in place rather than blanking the image.
      });
    return () => {
      active = false;
    };
  }, [remoteUri]);

  return resolved;
};
