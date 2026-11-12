# Production Dockerfile for SceneFlow
FROM node:20-bullseye-slim

# Install system dependencies (Python 3, FFmpeg, build essentials)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    ffmpeg \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy Node dependencies
COPY package*.json ./
RUN npm install --production

# Create Python virtual environment and install faster-whisper
COPY python/requirements.txt python/requirements.txt
RUN python3 -m venv .venv && \
    .venv/bin/pip install --upgrade pip && \
    .venv/bin/pip install -r python/requirements.txt

# Copy source code
COPY . .

# Pre-download Fast (base) Whisper model into Docker image for instant server cold starts
RUN npm run download-models

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
