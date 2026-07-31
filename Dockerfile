# Generic image for any workspace service: docker build --build-arg SERVICE=<name> .
# Node 25 runs TypeScript natively (type stripping), so there is no build step.
FROM node:25-alpine

ARG SERVICE
ENV SERVICE=${SERVICE}

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages ./packages
COPY services/${SERVICE}/package.json services/${SERVICE}/package.json

RUN npm ci -w services/${SERVICE} --omit=dev

COPY services/${SERVICE} services/${SERVICE}

CMD ["sh", "-c", "node services/$SERVICE/src/index.ts"]
