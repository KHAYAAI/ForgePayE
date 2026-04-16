# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

RUN pip install poetry==1.8.3
WORKDIR /app
COPY pyproject.toml poetry.lock* ./
RUN poetry config virtualenvs.in-project true \
 && poetry install --only main --no-root

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runner

# Security: non-root user
RUN groupadd --system --gid 1001 python \
 && useradd  --system --uid 1001 --gid python app

WORKDIR /app

# Copy virtualenv from builder
COPY --from=builder --chown=app:python /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

COPY --chown=app:python src/ ./src/

USER app
EXPOSE 8010

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD python -c "import httpx; httpx.get('http://localhost:8010/healthz').raise_for_status()"

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8010", "--workers", "4"]
