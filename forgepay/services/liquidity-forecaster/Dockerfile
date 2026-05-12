# syntax=docker/dockerfile:1

# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.12-slim AS builder

# Install build tools required by some numpy/scipy/statsmodels C extensions
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      gcc \
      g++ \
      libatlas-base-dev \
      liblapack-dev \
      gfortran \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files first to exploit layer caching
COPY requirements.txt ./

# Install into an isolated prefix so we can copy just that tree
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

# Copy application source
COPY pyproject.toml ./
COPY src/ ./src/

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM python:3.12-slim AS runner

# Runtime BLAS/LAPACK shared libraries needed by numpy/scipy
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libatlas-base-dev \
      liblapack3 \
 && rm -rf /var/lib/apt/lists/*

# Security: non-root user
RUN groupadd --system --gid 1001 python \
 && useradd  --system --uid 1001 --gid python app

WORKDIR /app

# Copy installed packages from builder
COPY --from=builder /install /usr/local

# Copy application source with correct ownership
COPY --from=builder --chown=app:python /app/src ./src/

USER app

EXPOSE 8002

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD python -c "import httpx; httpx.get('http://localhost:8002/health').raise_for_status()"

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8002", "--workers", "2"]
