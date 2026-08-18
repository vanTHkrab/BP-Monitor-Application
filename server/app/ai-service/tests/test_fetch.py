"""fetch_image error modes via httpx.MockTransport — no real network."""
from __future__ import annotations

import httpx
import numpy as np
import pytest

from ai_service.storage.fetch import MAX_IMAGE_BYTES, ImageFetchError, fetch_image


async def _run(handler, *, url: str = "https://example/image.jpg", timeout_s: float = 2.0):
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        return await fetch_image(url, timeout_s=timeout_s, client=client)


class TestSuccess:
    async def test_decodes_jpeg(self, jpeg_bytes):
        def ok(_req):
            return httpx.Response(200, headers={"content-type": "image/jpeg"}, content=jpeg_bytes)

        img = await _run(ok)
        assert isinstance(img, np.ndarray)
        assert img.shape == (100, 200, 3)
        assert img.dtype == np.uint8


class TestFailureModes:
    async def test_http_404(self):
        async def runner():
            await _run(lambda _r: httpx.Response(404))

        with pytest.raises(ImageFetchError, match="HTTP 404"):
            await runner()

    async def test_empty_body(self):
        with pytest.raises(ImageFetchError, match="empty response body"):
            await _run(lambda _r: httpx.Response(200, content=b""))

    async def test_undecodable_bytes(self):
        with pytest.raises(ImageFetchError, match="imdecode failed"):
            await _run(
                lambda _r: httpx.Response(
                    200, headers={"content-type": "text/html"}, content=b"<html>nope</html>"
                )
            )

    async def test_payload_oversize(self):
        big = b"\xff" * (MAX_IMAGE_BYTES + 1)
        with pytest.raises(ImageFetchError, match="too large"):
            await _run(lambda _r: httpx.Response(200, content=big))

    async def test_timeout(self):
        def slow(req):
            raise httpx.TimeoutException("simulated", request=req)

        with pytest.raises(ImageFetchError, match="timeout"):
            await _run(slow, timeout_s=0.5)

    async def test_connect_error(self):
        def boom(req):
            raise httpx.ConnectError("boom", request=req)

        with pytest.raises(ImageFetchError, match="network error"):
            await _run(boom)


class TestClientLifecycle:
    async def test_supplied_client_not_closed(self, jpeg_bytes):
        """Production lifespan passes a shared client — fetch must NOT close it."""
        client = httpx.AsyncClient(
            transport=httpx.MockTransport(
                lambda _r: httpx.Response(200, content=jpeg_bytes)
            )
        )
        try:
            await fetch_image("https://example/image.jpg", timeout_s=2.0, client=client)
            # If fetch closed the client, the next call would raise.
            await fetch_image("https://example/image.jpg", timeout_s=2.0, client=client)
        finally:
            await client.aclose()


class TestDestinationValidation:
    """`imageUrl` arrives over Redis — anything able to publish there can
    otherwise aim this service at a URL of its choosing (SSRF)."""

    async def test_rejects_non_http_schemes(self):
        for url in ("file:///etc/passwd", "ftp://host/x.jpg", "gopher://host/1"):
            with pytest.raises(ImageFetchError, match="refusing scheme"):
                await _run(lambda _r: httpx.Response(200), url=url)

    async def test_rejects_url_without_host(self):
        with pytest.raises(ImageFetchError, match="no host"):
            await _run(lambda _r: httpx.Response(200), url="https:///no-host.jpg")

    async def test_rejects_the_cloud_metadata_address(self):
        """169.254.169.254 hands out IAM credentials to any plain GET."""
        with pytest.raises(ImageFetchError, match="link-local"):
            await _run(
                lambda _r: httpx.Response(200),
                url="http://169.254.169.254/latest/meta-data/iam/security-credentials/",
            )

    async def test_rejects_ipv6_link_local(self):
        with pytest.raises(ImageFetchError, match="link-local"):
            await _run(lambda _r: httpx.Response(200), url="http://[fe80::1]/x.jpg")

    async def test_allows_loopback_and_private_by_default(self, jpeg_bytes):
        """A developer running MinIO locally is a legitimate setup — the
        default posture blocks link-local only, not all private space."""
        for url in ("http://127.0.0.1:9000/b/x.jpg", "http://10.0.0.5/b/x.jpg"):
            img = await _run(
                lambda _r: httpx.Response(200, content=jpeg_bytes), url=url
            )
            assert img.shape == (100, 200, 3)


class TestHostAllowlist:
    async def _fetch(self, url, allowed, jpeg_bytes):
        transport = httpx.MockTransport(
            lambda _r: httpx.Response(200, content=jpeg_bytes)
        )
        async with httpx.AsyncClient(transport=transport) as client:
            return await fetch_image(
                url, timeout_s=2.0, client=client, allowed_hosts=allowed,
            )

    async def test_listed_host_passes(self, jpeg_bytes):
        img = await self._fetch(
            "https://bucket.r2.example/x.jpg", ["bucket.r2.example"], jpeg_bytes,
        )
        assert img.shape == (100, 200, 3)

    async def test_unlisted_host_is_refused(self, jpeg_bytes):
        with pytest.raises(ImageFetchError, match="not in the configured allowlist"):
            await self._fetch(
                "https://evil.example/x.jpg", ["bucket.r2.example"], jpeg_bytes,
            )

    async def test_matching_ignores_case_and_padding(self, jpeg_bytes):
        img = await self._fetch(
            "https://Bucket.R2.Example/x.jpg", ["  bucket.r2.example  "], jpeg_bytes,
        )
        assert img.shape == (100, 200, 3)

    async def test_port_does_not_affect_host_matching(self, jpeg_bytes):
        img = await self._fetch(
            "https://bucket.r2.example:8443/x.jpg", ["bucket.r2.example"], jpeg_bytes,
        )
        assert img.shape == (100, 200, 3)

    async def test_an_allowlisted_host_is_trusted_outright(self, jpeg_bytes):
        """Documented behaviour: an explicit allowlist is a stronger
        statement than the heuristic, so it replaces the checks rather
        than stacking with them."""
        img = await self._fetch(
            "http://169.254.169.254/x.jpg", ["169.254.169.254"], jpeg_bytes,
        )
        assert img.shape == (100, 200, 3)


class TestSizeCapIsEnforced:
    """The cap used to be checked *after* `response.content` had already
    buffered the whole body — a large enough response OOM'd the worker
    before the guard against exactly that could run."""

    async def test_oversize_content_length_is_refused_before_the_body(self):
        def huge_header(_req):
            return httpx.Response(
                200,
                headers={"content-length": str(MAX_IMAGE_BYTES + 1)},
                content=b"x" * 16,
            )

        with pytest.raises(ImageFetchError, match="content-length"):
            await _run(huge_header)

    async def test_cap_applies_mid_stream_without_content_length(self):
        """A chunked response declares no length, so the only real
        defence is aborting once the accumulated size passes the cap."""
        chunk = b"\xff" * (1024 * 1024)

        def chunked(_req):
            # Async generator: the async client requires an async byte
            # stream, and this is also what a real chunked transfer
            # looks like from httpx's side.
            async def gen():
                for _ in range(MAX_IMAGE_BYTES // len(chunk) + 2):
                    yield chunk

            return httpx.Response(200, content=gen())

        with pytest.raises(ImageFetchError, match="mid-stream"):
            await _run(chunked)

    async def test_malformed_content_length_falls_through_to_the_stream_cap(
        self, jpeg_bytes,
    ):
        def weird(_req):
            return httpx.Response(
                200, headers={"content-type": "image/jpeg"}, content=jpeg_bytes,
            )

        img = await _run(weird)
        assert img.shape == (100, 200, 3)
