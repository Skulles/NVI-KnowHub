# Stage 1 — Build TypeScript server
FROM node:20-alpine AS build
WORKDIR /build

COPY server/package*.json ./
RUN npm ci

COPY server/ ./
RUN npm run build

# Stage 2 — Production runtime (no devDependencies, no source)
FROM node:20-alpine AS runtime
WORKDIR /app

COPY --from=build /build/package*.json ./
RUN npm ci --omit=dev

COPY --from=build /build/dist ./dist

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]
