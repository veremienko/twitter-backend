# Generic image for any workspace service: docker build --build-arg SERVICE=<name> .
# Node 25 runs TypeScript natively (type stripping), so there is no build step.
FROM node:25-alpine

# Service name comes in at build time; ENV persists it into the container for CMD.
ARG SERVICE
ENV SERVICE=${SERVICE}
ENV NODE_ENV=production

WORKDIR /app

# Copy only dependency manifests first so the npm ci layer stays cached
# until dependencies actually change.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/${SERVICE}/package.json services/${SERVICE}/package.json

# Install production deps for this one workspace only.
RUN npm ci -w services/${SERVICE} --omit=dev

# Service source changes most often, so it goes last to keep earlier layers cached.
COPY services/${SERVICE} services/${SERVICE}

# Run as the unprivileged node user instead of root.
USER node

CMD ["sh", "-c", "node services/$SERVICE/src/index.ts"]
