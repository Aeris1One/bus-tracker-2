# Build from the repository root: docker build -f providers/darwin/Dockerfile -t bus-tracker-darwin .

FROM node:26.7.0-alpine AS base
RUN npm install -g --force corepack@latest
RUN corepack enable

#####################################
# STAGE 1 - Build project artifacts #
#####################################

FROM base AS build
WORKDIR /bus-tracker

# Install project dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm fetch
COPY libraries/contracts/ ./libraries/contracts/
COPY libraries/monitoring/ ./libraries/monitoring/
COPY providers/darwin/ ./providers/darwin/
RUN pnpm install --offline --filter "@bus-tracker/processor-darwin..."

# Build project artifacts
RUN pnpm --filter "@bus-tracker/processor-darwin..." run build
RUN pnpm deploy --legacy --filter=@bus-tracker/processor-darwin --prod darwin-deployment

#####################################
# STAGE 2 - Run project artifacts   #
#####################################

FROM base
WORKDIR /bus-tracker

COPY --from=build /bus-tracker/darwin-deployment/node_modules ./node_modules/
COPY --from=build /bus-tracker/darwin-deployment/dist ./dist/
COPY --from=build /bus-tracker/darwin-deployment/package.json ./package.json

ENV NODE_ENV=production
ENV DATA_DIR=/data
VOLUME ["/data"]

# The configuration file path is a positional argument, not an environment variable.
ENTRYPOINT ["node", "--enable-source-maps", "dist/index.js"]
