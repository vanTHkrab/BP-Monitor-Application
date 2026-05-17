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
