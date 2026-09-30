# Single container: builds the frontend, serves it from the API. Suitable for Google Cloud Run.
FROM node:22-slim AS web
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 MIRROR_ENV=prod MIRROR_WEB_DIST=/app/web/dist
WORKDIR /app/backend
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=web /web/dist /app/web/dist
RUN useradd --create-home --uid 10001 mirror && mkdir -p data && chown -R mirror:mirror data
USER mirror
EXPOSE 8080
# The synthetic population is generated on start (needs DEMO_PASSWORD and MIRROR_JWT_SECRET as env vars).
CMD ["sh", "-c", "[ -f data/mirror.duckdb ] || python -m mirror.generate --customers ${MIRROR_CUSTOMERS:-100000}; exec uvicorn mirror.api:app --host 0.0.0.0 --port ${PORT:-8080}"]
