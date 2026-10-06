FROM node:20-bookworm-slim AS base
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates tini && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json package-lock.json .npmrc ./
COPY backend/package.json ./backend/package.json
COPY backend/prisma ./backend/prisma
RUN npm ci
COPY backend/tsconfig.json ./backend/tsconfig.json
COPY backend/src ./backend/src
RUN npm run db:generate && npm run build

FROM build AS dependencies
RUN npm prune --omit=dev

FROM build AS migrate
USER node
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["npm", "run", "db:migrate"]

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/dist ./backend/dist
COPY --from=build --chown=node:node /app/backend/package.json ./backend/package.json
COPY --from=build --chown=node:node /app/backend/prisma ./backend/prisma
USER node
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "backend/dist/server.js"]