"""Entry point for `uv run fastapi dev main.py`.

Re-exports the FastAPI app from the ``ai_service`` package so the
Dockerfile / dev command can point at this file without depending
on the package's internal layout.
"""

from ai_service.main import app  # noqa: F401

__all__ = ["app"]
