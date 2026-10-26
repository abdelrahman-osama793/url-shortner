# One image for both backend processes; compose picks the command (api or worker).
# The backend is plain JavaScript, so there is no build stage.
FROM node:22.23-bookworm-slim

ENV NODE_ENV=production

WORKDIR /app

# Install production dependencies first so source edits don't invalidate this layer.
# Every workspace package.json is needed for npm ci to match the lockfile.
COPY package.json package-lock.json ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/

RUN npm ci --omit=dev --workspace=@shortlist/server --include-workspace-root=false \
  && npm cache clean --force

COPY packages/contracts/src packages/contracts/src
COPY apps/server/src apps/server/src

USER node

WORKDIR /app/apps/server

CMD ["node", "src/api.js"]
