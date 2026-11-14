# Stage 1: Build the React + Vite SPA
FROM node:22-slim AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: Python FastAPI + Playwright Chromium runtime
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FRONTEND_DIST_DIR=/app/frontend/dist \
    PORT=8080

WORKDIR /app/backend
COPY backend/pyproject.toml ./
COPY backend/src/ ./src/

RUN pip install --no-cache-dir . \
    && playwright install --with-deps chromium

COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

EXPOSE 8080
CMD ["sh", "-c", "uvicorn pricepulse.api.app:app --host 0.0.0.0 --port ${PORT:-8080}"]

