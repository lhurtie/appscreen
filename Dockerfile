# App Store Screenshot Generator
# Node container: serves the static frontend AND the /api/asc App Store Connect
# upload backend from a single process.

FROM node:20-alpine

LABEL maintainer="App Store Screenshot Generator"
LABEL description="Browser-based App Store screenshot generator with App Store Connect upload"

WORKDIR /app

# Install backend dependencies first for better layer caching.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Backend source
COPY server/server.js server/asc.js ./server/

# Frontend static files
COPY index.html app.js styles.css three-renderer.js language-utils.js \
     magical-titles.js llm.js lucide-icons.js asc-upload.js ./
COPY models/ ./models/
COPY img/ ./img/

ENV PORT=3000
ENV STATIC_ROOT=/app
EXPOSE 3000

# Health check hits the same /health endpoint the old nginx image exposed.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "server/server.js"]
