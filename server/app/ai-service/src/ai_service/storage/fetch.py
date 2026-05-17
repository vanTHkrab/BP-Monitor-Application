"""Async image fetcher — pulls a presigned URL → BGR ndarray.

Used by ``handlers.py`` before YOLO detection. ai-service holds no S3
credentials by design (PLAN.md "Image fetch" decision) — the gateway
hands us a presigned GET URL in the Redis request payload and we GET it
ourselves.

No retries here: the gateway's BullMQ worker retries the whole job
(3 attempts, exponential backoff) on failure. Fail fast and let the
gateway own retry policy.
"""
from __future__ import annotations

from typing import Final

import cv2
import httpx
import numpy as np


# Defense-in-depth: presigned URLs come from our gateway, not user input,
# but cap at 20 MB so a misconfigured upload can't OOM the worker.
MAX_IMAGE_BYTES: Final[int] = 20 * 1024 * 1024


class ImageFetchError(Exception):
    """Raised when the image can't be fetched or decoded.

    ``handlers.py`` catches this and emits an ``err`` reply per PLAN.md's
    "Image fetch fails" error mode.
    """


async def fetch_image(
    url: str,
    *,
    timeout_s: float,
    client: httpx.AsyncClient | None = None,
) -> np.ndarray:
    """Download an image from a presigned URL and decode it as BGR.

    Args:
        url: presigned GET URL (the gateway produces these via S3 presign).
        timeout_s: hard wall-clock timeout passed to ``httpx``.
        client: optional shared ``httpx.AsyncClient``. When ``None`` a
            one-shot client is constructed (fine for tests; production
            should pass a lifespan-scoped client to reuse the connection
            pool).

    Returns:
        BGR ndarray (HxWx3 uint8) ready for ``cv2`` / ``YoloDetector``.

    Raises:
        ImageFetchError: on network failure, non-2xx HTTP, oversized
            payload, empty body, or undecodable bytes.
    """
    own_client = client is None
    http = client if client is not None else httpx.AsyncClient(timeout=timeout_s)

    try:
        try:
            response = await http.get(url, timeout=timeout_s)
        except httpx.TimeoutException as e:
            raise ImageFetchError(f"timeout after {timeout_s}s") from e
        except httpx.HTTPError as e:
            raise ImageFetchError(f"network error: {e!s}") from e

        if response.status_code != 200:
            raise ImageFetchError(f"HTTP {response.status_code} from upstream")

        body = response.content
        if not body:
            raise ImageFetchError("empty response body")
        if len(body) > MAX_IMAGE_BYTES:
            raise ImageFetchError(
                f"payload too large: {len(body)} bytes (max {MAX_IMAGE_BYTES})"
            )

        nparr = np.frombuffer(body, dtype=np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            ctype = response.headers.get("content-type", "?")
            raise ImageFetchError(
                f"cv2.imdecode failed ({len(body)} bytes, content-type={ctype})"
            )
        return image
    finally:
        if own_client:
            await http.aclose()
