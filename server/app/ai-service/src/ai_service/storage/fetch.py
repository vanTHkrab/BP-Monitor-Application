"""Async image fetcher — pulls a presigned URL → BGR ndarray.

Used by ``handlers.py`` before YOLO detection. ai-service holds no S3
credentials by design (PLAN.md "Image fetch" decision) — the gateway
hands us a presigned GET URL in the Redis request payload and we GET it
ourselves.

No retries here: the gateway's BullMQ worker retries the whole job
(3 attempts, exponential backoff) on failure. Fail fast and let the
gateway own retry policy.

Two things this module is responsible for beyond "download bytes":

* **Size enforcement that actually enforces.** The cap is checked
  against ``Content-Length`` *before* the body is read and again
  chunk-by-chunk while streaming, because a declared length is a claim,
  not a guarantee.
* **Destination validation.** ``imageUrl`` arrives over Redis. Anything
  that can publish on that channel can otherwise make this service
  issue a GET to a URL of its choosing — the classic SSRF shape, with
  cloud metadata endpoints as the prize.
"""
from __future__ import annotations

import ipaddress
import logging
from collections.abc import Sequence
from typing import Final
from urllib.parse import urlsplit

import cv2
import httpx
import numpy as np

logger = logging.getLogger(__name__)


# Defense-in-depth: presigned URLs come from our gateway, not user input,
# but cap at 20 MB so a misconfigured upload can't OOM the worker.
MAX_IMAGE_BYTES: Final[int] = 20 * 1024 * 1024

# Only these two schemes ever make sense for a presigned object URL.
# Rejecting the rest closes file://, gopher://, and friends.
ALLOWED_SCHEMES: Final[frozenset[str]] = frozenset({"http", "https"})


class ImageFetchError(Exception):
    """Raised when the image can't be fetched or decoded.

    ``handlers.py`` catches this and emits an ``err`` reply per PLAN.md's
    "Image fetch fails" error mode.
    """


def _validate_url(url: str, allowed_hosts: Sequence[str]) -> None:
    """Raise ``ImageFetchError`` when ``url`` is not a safe fetch target.

    Two mechanisms, in order of strength:

    1. **An explicit allowlist** (``allowed_hosts``, from
       ``AI_ALLOWED_IMAGE_HOSTS``). When set, the host must match one
       entry exactly and nothing else is examined. This is the real
       control — a positive statement of where images legitimately come
       from beats any heuristic.
    2. **Otherwise**: the scheme must be http/https, and a *literal*
       link-local IP is refused. ``169.254.169.254`` hands out IAM
       credentials to anything that can issue a plain GET, so it is
       worth refusing unconditionally and costs nothing to check.

    **What this deliberately does not do: resolve hostnames.** An
    earlier draft called ``getaddrinfo`` so a *name* pointing at the
    metadata service would be caught too. That was dropped, and the
    reasoning matters more than the code:

    * It buys little. An attacker who can publish to the Redis channel
      can pass the literal IP, which rule 2 already refuses. Escalating
      to a hostname means controlling DNS — and a resolve-then-connect
      check is two separate lookups, so DNS rebinding defeats it anyway.
      Closing that properly needs connection-level pinning, not a
      pre-flight lookup.
    * It costs real availability. Every production fetch would depend on
      a DNS round trip in the hot path, and a resolver hiccup would
      surface as a failed analysis.

    So: cheap checks that cannot fail spuriously, plus an allowlist for
    deployments that want it closed. The primary control remains that
    only the gateway can publish to the Redis channel at all.

    Loopback and RFC1918 are **not** blocked by default either: a
    developer running MinIO on ``localhost:9000``, or an S3-compatible
    store on a compose-internal hostname, is a legitimate setup this
    service cannot distinguish from an attack.
    """
    parts = urlsplit(url)
    if parts.scheme.lower() not in ALLOWED_SCHEMES:
        raise ImageFetchError(
            f"refusing scheme {parts.scheme!r}: only http/https are fetchable"
        )

    host = parts.hostname
    if not host:
        raise ImageFetchError("image URL has no host")

    if allowed_hosts:
        permitted = {h.strip().lower() for h in allowed_hosts if h.strip()}
        if host.lower() not in permitted:
            raise ImageFetchError(f"host {host!r} is not in the configured allowlist")
        return

    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return  # a hostname — see the docstring on why we stop here
    if ip.is_link_local:
        raise ImageFetchError(
            f"refusing to fetch from link-local address {host} — cloud "
            f"metadata endpoints are not valid image sources"
        )


async def _read_capped(response: httpx.Response) -> bytes:
    """Stream the body, aborting as soon as it exceeds ``MAX_IMAGE_BYTES``.

    The previous implementation read ``response.content`` — which
    buffers the *entire* body into memory — and only then compared its
    length to the cap. A 2 GB response therefore OOM'd the worker before
    the check that existed to prevent exactly that ever ran. Streaming
    makes the cap real: the transfer is abandoned mid-flight.

    ``Content-Length`` is checked first as a cheap early exit, but it is
    only a claim, so the accumulated size is checked on every chunk too.
    """
    declared = response.headers.get("content-length")
    if declared is not None:
        try:
            if int(declared) > MAX_IMAGE_BYTES:
                raise ImageFetchError(
                    f"payload too large: content-length {declared} bytes "
                    f"(max {MAX_IMAGE_BYTES})"
                )
        except ValueError:
            # A malformed header is not fatal — the streaming cap below
            # is the authority either way.
            logger.debug("ignoring malformed content-length %r", declared)

    buffer = bytearray()
    async for chunk in response.aiter_bytes():
        buffer += chunk
        if len(buffer) > MAX_IMAGE_BYTES:
            raise ImageFetchError(
                f"payload too large: exceeded {MAX_IMAGE_BYTES} bytes mid-stream"
            )
    return bytes(buffer)


async def fetch_image(
    url: str,
    *,
    timeout_s: float,
    client: httpx.AsyncClient | None = None,
    allowed_hosts: Sequence[str] = (),
) -> np.ndarray:
    """Download an image from a presigned URL and decode it as BGR.

    Args:
        url: presigned GET URL (the gateway produces these via S3 presign).
        timeout_s: hard wall-clock timeout passed to ``httpx``.
        client: optional shared ``httpx.AsyncClient``. When ``None`` a
            one-shot client is constructed (fine for tests; production
            should pass a lifespan-scoped client to reuse the connection
            pool).
        allowed_hosts: optional host allowlist. Empty (the default) keeps
            the permissive path with link-local blocking; non-empty
            restricts fetches to exactly these hosts.

    Returns:
        BGR ndarray (HxWx3 uint8) ready for ``cv2`` / ``YoloDetector``.

    Raises:
        ImageFetchError: on a rejected destination, network failure,
            non-2xx HTTP, oversized payload, empty body, or undecodable
            bytes.
    """
    _validate_url(url, allowed_hosts)

    own_client = client is None
    http = client if client is not None else httpx.AsyncClient(timeout=timeout_s)

    try:
        try:
            async with http.stream("GET", url, timeout=timeout_s) as response:
                if response.status_code != 200:
                    raise ImageFetchError(f"HTTP {response.status_code} from upstream")
                body = await _read_capped(response)
                content_type = response.headers.get("content-type", "?")
        except httpx.TimeoutException as e:
            raise ImageFetchError(f"timeout after {timeout_s}s") from e
        except httpx.HTTPError as e:
            raise ImageFetchError(f"network error: {e!s}") from e

        if not body:
            raise ImageFetchError("empty response body")

        nparr = np.frombuffer(body, dtype=np.uint8)
        image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if image is None:
            raise ImageFetchError(
                f"cv2.imdecode failed ({len(body)} bytes, content-type={content_type})"
            )
        return image
    finally:
        if own_client:
            await http.aclose()
