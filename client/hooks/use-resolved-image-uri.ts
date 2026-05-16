import { resolveImageUri } from "@/utils/image-cache";
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
        if (active && next) setResolved(next);
      })
      .catch(() => {
        // resolveImageUri logs internally and returns the remote URI on
        // failure; if it threw anyway, keep whatever we already have.
      });
    return () => {
      active = false;
    };
  }, [remoteUri]);

  return resolved;
};
