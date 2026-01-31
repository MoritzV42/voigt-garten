# Voigt-Garten Docker Image
# Multi-Stage Build: Node.js (Astro Build) + Python (Flask Runtime)

# ============ Stage 1: Build Astro Frontend ============
FROM node:20-slim AS frontend-builder

WORKDIR /build

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY astro.config.mjs tsconfig.json tailwind.config.mjs ./
COPY src/ ./src/
COPY public/ ./public/

# Build static site
RUN npm run build

# ============ Stage 2: Python Runtime ============
FROM python:3.11-slim

WORKDIR /app

# Install system dependencies (ffmpeg for video, libwebp for images)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    libwebp-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy Python requirements and install
COPY pi-backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY pi-backend/app.py .
COPY pi-backend/email_service.py .
COPY pi-backend/seed_projects.py .
COPY pi-backend/start.sh .
RUN chmod +x start.sh

# Copy built frontend from Stage 1
COPY --from=frontend-builder /build/dist /app/static

# Create data directories
RUN mkdir -p /app/data /app/public/images/gallery

# Environment variables (defaults)
ENV FLASK_ENV=production
ENV PYTHONUNBUFFERED=1

# Expose port
EXPOSE 5055

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:5055/api/health || exit 1

# Run with startup script (seeds DB + starts Gunicorn)
CMD ["./start.sh"]
