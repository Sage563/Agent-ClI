FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/src/runtime_assets.generated.ts ./src/runtime_assets.generated.ts
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
ENTRYPOINT ["node", "dist/index.js"]
