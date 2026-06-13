"""Local-dev model fetcher.

Mirrors the production `docker-entrypoint.sh` flow so contributors running
`uv run fastapi dev main.py` outside Docker get the same SHA256-verified
model artifacts without rebuilding an image.

Usage:
    uv run python -m ai_service.scripts.fetch_models
    uv run python -m ai_service.scripts.fetch_models --dry-run
    uv run python -m ai_service.scripts.fetch_models --models-dir /tmp/models

Single source of truth for which files exist and what their hashes are is
``server/app/ai-service/models/EXPECTED_HASHES.json`` — same file the shell
entrypoint parses. Keep them in lockstep; whoever uploads to R2 regenerates
that manifest and both consumers pick it up automatically.

`crnn.pt` (the training-source PyTorch checkpoint) is intentionally absent
from the manifest and never fetched at runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

import httpx

# Repository layout: this file lives at
#   server/app/ai-service/src/ai_service/scripts/fetch_models.py
# so the ai-service root (where models/ and pyproject.toml live) is 4
# parents up.
AI_SERVICE_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_MODELS_DIR = AI_SERVICE_ROOT / "models"
DEFAULT_HASH_FILE = DEFAULT_MODELS_DIR / "EXPECTED_HASHES.json"

PLACEHOLDER_URL = "https://REPLACE_ME.r2.dev/bp-monitor/models"
ENV_VAR_NAME = "AI_MODELS_R2_BASE_URL"


def _sha256_of(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def _download(client: httpx.Client, url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(target.suffix + ".part")
    try:
        with client.stream("GET", url) as resp:
            resp.raise_for_status()
            with tmp.open("wb") as f:
                for chunk in resp.iter_bytes():
                    f.write(chunk)
        tmp.replace(target)
    except Exception:
        tmp.unlink(missing_ok=True)
        raise


def fetch_models(
    base_url: str,
    models_dir: Path,
    hash_file: Path,
    *,
    dry_run: bool = False,
) -> int:
    """Download & verify every artifact listed in ``hash_file``.

    Returns 0 on success, non-zero on the first verification failure. The
    parent ``docker-entrypoint.sh`` has the same contract.
    """
    if base_url == PLACEHOLDER_URL or not base_url:
        print(
            f"ERROR: {ENV_VAR_NAME} is still the placeholder "
            f"({PLACEHOLDER_URL!r}). Replace it with the real R2 base URL "
            "before fetching models.",
            file=sys.stderr,
        )
        return 1

    if not hash_file.is_file():
        print(f"ERROR: hash manifest not found at {hash_file}", file=sys.stderr)
        return 1

    try:
        manifest: dict[str, str] = json.loads(hash_file.read_text())
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON in {hash_file}: {exc}", file=sys.stderr)
        return 1

    models_dir.mkdir(parents=True, exist_ok=True)
    base = base_url.rstrip("/")

    with httpx.Client(timeout=60.0, follow_redirects=True) as client:
        for filename, expected in manifest.items():
            target = models_dir / filename

            if target.is_file():
                actual = _sha256_of(target)
                if actual == expected:
                    print(f"models: {filename} ok (cached)")
                    continue
                print(
                    f"models: {filename} sha256 mismatch "
                    f"(have {actual}, expected {expected}); "
                    f"{'would re-download' if dry_run else 're-downloading'}",
                    file=sys.stderr,
                )
                if dry_run:
                    continue
                target.unlink()
            else:
                print(
                    f"models: {filename} "
                    f"{'missing (would download)' if dry_run else 'missing; downloading'}"
                )
                if dry_run:
                    continue

            url = f"{base}/{filename}"
            try:
                _download(client, url, target)
            except httpx.HTTPError as exc:
                print(
                    f"ERROR: failed to download {filename} from {url}: {exc}",
                    file=sys.stderr,
                )
                return 1

            actual = _sha256_of(target)
            if actual != expected:
                print(
                    f"ERROR: {filename} downloaded but sha256 mismatch "
                    f"(have {actual}, expected {expected})",
                    file=sys.stderr,
                )
                target.unlink(missing_ok=True)
                return 1
            print(f"models: {filename} ok (downloaded)")

    print(f"models: all artifacts verified in {models_dir}")
    return 0


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="python -m ai_service.scripts.fetch_models",
        description=(
            "Download and SHA256-verify the OCR model artifacts from R2 "
            "into the local models/ directory."
        ),
    )
    parser.add_argument(
        "--models-dir",
        type=Path,
        default=DEFAULT_MODELS_DIR,
        help=f"Where to place the artifacts (default: {DEFAULT_MODELS_DIR})",
    )
    parser.add_argument(
        "--hash-file",
        type=Path,
        default=DEFAULT_HASH_FILE,
        help=f"Manifest path (default: {DEFAULT_HASH_FILE})",
    )
    parser.add_argument(
        "--base-url",
        default=None,
        help=(
            f"Override the R2 base URL (otherwise read from ${ENV_VAR_NAME})."
        ),
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Report what would happen without downloading anything.",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    import os

    args = _parse_args(argv)
    base_url = args.base_url or os.environ.get(ENV_VAR_NAME, "")
    if not base_url:
        print(
            f"ERROR: ${ENV_VAR_NAME} is not set (and --base-url was not "
            "passed). Set it to the public R2 base URL hosting the model "
            "artifacts before running this command.",
            file=sys.stderr,
        )
        return 1
    return fetch_models(
        base_url=base_url,
        models_dir=args.models_dir,
        hash_file=args.hash_file,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    raise SystemExit(main())
