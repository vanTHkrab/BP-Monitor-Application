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
RUN uv sync --frozen || uv sync

# Bring in only the hash manifest at build time — the .onnx / .npz weights
# are downloaded by docker-entrypoint.sh from $AI_MODELS_R2_BASE_URL on the
# first start, then cached on a volume mount.
COPY models/EXPECTED_HASHES.json ./models/EXPECTED_HASHES.json
COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]

FROM base AS dev
COPY . .
EXPOSE 8000
CMD ["uv", "run", "fastapi", "dev", "main.py", "--host", "0.0.0.0", "--port", "8000"]

FROM base AS prod
COPY . .
EXPOSE 8000
CMD ["uv", "run", "fastapi", "run", "main.py", "--host", "0.0.0.0", "--port", "8000"]
