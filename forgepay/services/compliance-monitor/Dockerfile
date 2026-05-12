# syntax=docker/dockerfile:1
# ForgePay Compliance Monitor — Python 3.12 slim, non-root user

# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

RUN pip install --no-cache-dir poetry==1.8.3

WORKDIR /app
COPY pyproject.toml poetry.lock* ./

RUN poetry config virtualenvs.in-project true \
 && poetry install --only main --no-root --no-interaction --no-ansi

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runner

# Security: non-root user (uid/gid 1001)
RUN groupadd --system --gid 1001 python \
 && useradd  --system --uid 1001 --gid python --no-create-home app

WORKDIR /app

# Copy virtualenv from builder stage
COPY --from=builder --chown=app:python /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH"

# Copy application source
COPY --chown=app:python src/ ./src/

USER app

EXPOSE 8003

HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD python -c \
    "import httpx; r = httpx.get('http://localhost:8003/health', timeout=4); r.raise_for_status()"

CMD ["uvicorn", "src.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8003", \
     "--workers", "2", \
     "--log-level", "info"]
