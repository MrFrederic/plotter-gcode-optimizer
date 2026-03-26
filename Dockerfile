# ── Stage 1: Build React frontend ─────────────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY app/frontend/package.json app/frontend/package-lock.json ./
RUN npm ci --legacy-peer-deps
COPY app/frontend/ .
RUN npm run build

# ── Stage 2: Python backend ──────────────────────────────────────────────────
FROM python:3.11-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends gcc libc6-dev && rm -rf /var/lib/apt/lists/*
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY ./app /app/app
COPY --from=frontend-build /frontend/dist /app/app/frontend/dist
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port 8000 ${BASE_PATH:+--root-path $BASE_PATH}"]
