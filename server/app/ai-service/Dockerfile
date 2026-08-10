FROM python:3.13-slim AS base
WORKDIR /app

# curl is needed by docker-entrypoint.sh to pull model artifacts from R2
# on first boot. Combined with the pip install into a single layer so the
# apt cache cleanup actually shrinks the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

COPY pyproject.toml uv.lock* ./
# --no-install-project is load-bearing, not an optimisation. This layer exists
# to resolve *dependencies* before the source tree is copied, but pyproject.toml
# declares this directory as a hatchling package (`packages = ["src/ai_service"]`,
# `readme = "README.md"`), so a plain `uv sync` also tries to build the project
# itself — against a layer that contains neither src/ nor README.md. It fails
# with `OSError: Readme file does not exist: README.md`, which reads like a
# missing-file bug rather than "you installed the project too early".
#
# The project is installed later, by `uv run` in the dev/prod stages, once
# `COPY . .` has put the real source in place.
RUN uv sync --frozen --no-install-project || uv sync --no-install-project

# Bring in only the hash manifest at build time — the .onnx / .npz weights
# are downloaded by docker-entrypoint.sh from $AI_MODELS_R2_BASE_URL on the
# first start, then cached on a volume mount.
COPY models/EXPECTED_HASHES.json ./models/EXPECTED_HASHES.json
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]

FROM base AS dev
COPY . .
# Second sync, now that src/ and README.md exist: installs the project itself,
# which `base` deliberately skipped. Without it `uv run` builds and installs the
# project on EVERY container start — it works, but it makes start-up do a build
# step that can fail, and does it again on every restart.
RUN uv sync --frozen || uv sync
EXPOSE 8000
CMD ["uv", "run", "fastapi", "dev", "main.py", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS prod
COPY . .
RUN uv sync --frozen || uv sync
EXPOSE 8000
CMD ["uv", "run", "fastapi", "run", "main.py", "--host", "0.0.0.0", "--port", "8000"]
