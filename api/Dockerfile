# Build context is the repository root, not api/ — the API is one package in a
# pnpm workspace and needs the root lockfile to install reproducibly.
#   docker build -f api/Dockerfile -t health-tracker-api .

# Node and pnpm are both pinned here. That is the point of building this in
# Docker rather than configuring commands in a dashboard: the host cannot
# choose a pnpm too old to read a lockfileVersion 9 file.
FROM node:22-alpine AS deps

# Set before install so pnpm omits devDependencies. That matters more than
# usual here: mongodb-memory-server is a devDependency whose postinstall
# downloads a MongoDB binary of well over a hundred megabytes.
ENV NODE_ENV=production
ENV PNPM_VERSION=12.3.4
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

# Only the manifests first, so the install layer is reused whenever source
# changes but dependencies do not.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY api/package.json api/package.json
COPY shared/package.json shared/package.json
COPY web/package.json web/package.json

# `api...` resolves the API plus the workspace packages it depends on (shared),
# and skips the web package entirely — Next.js and its toolchain have no place
# in the API image.
RUN pnpm install --frozen-lockfile --prod --filter "@health-tracker/api..."

# ---------------------------------------------------------------------------

FROM node:22-alpine AS runner

ENV NODE_ENV=production
ENV PNPM_VERSION=12.3.4
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/api/node_modules ./api/node_modules
COPY --from=deps /app/shared/node_modules ./shared/node_modules

COPY pnpm-workspace.yaml package.json ./
COPY api ./api
COPY shared ./shared

# The API runs its TypeScript directly through tsx rather than a compiled
# dist/. That is deliberate: @health-tracker/shared publishes src/index.ts as
# its entry point, so plain `node dist/index.js` would try to require a .ts
# file at runtime and fail. tsx is a production dependency for this reason.

# Drop root. node:alpine ships an unprivileged `node` user already.
RUN chown -R node:node /app
USER node

# Render injects PORT and the app reads it; 4000 is only the local default.
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["pnpm", "--filter", "@health-tracker/api", "start"]
