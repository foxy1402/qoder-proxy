FROM node:20-alpine

# Install qodercli globally — uses QODER_PERSONAL_ACCESS_TOKEN env var at runtime for auth
RUN npm install -g @qoder-ai/qodercli \
  && qodercli --version || true

WORKDIR /app

# Install production deps first (layer caching)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy source
COPY src/ ./src/

EXPOSE 3000

ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
