# twitter-backend

Educational microservice backend: Express 5 + TypeScript (run natively by Node 25, no build step), PostgreSQL + Drizzle ORM, Redis (sessions and cache), Kafka (events between services).

## Architecture

```
client → api-gateway :3000 ─┬→ twit-service :3002 → PostgreSQL, Redis(cache) → Kafka: twit.created
        (sessions in Redis) ├→ auth-service :3003 → PostgreSQL, Redis(sessions)      ↓
                            └→ health       :3001                    notification-service (consumer)
```

| Service | Port | Role |
|---|---|---|
| api-gateway | 3000 | single entry point, session check, proxy |
| health | 3001 | postgres/redis/kafka status |
| twit-service | 3002 | twit CRUD, cache, event publishing |
| auth-service | 3003 | registration, login, sessions |
| notification-service | — | Kafka consumer of `twit.created` events |

Shared code (Kafka/Redis clients, topic names) lives in `packages/shared` and is imported as `@twitter/shared` via npm workspaces.

## Running

Requires Node 25+ and Docker.

```bash
npm install
cp .env.example .env

# dev mode: infrastructure in Docker, services on the host with hot-reload
docker compose up -d
npm run db:migrate
npm run dev

# everything in Docker (production-like): only the gateway is exposed on 127.0.0.1:3000
docker compose --profile app up -d --build

# same, but code changes sync and restart containers automatically (no manual rebuild)
docker compose --profile app watch
```

Docker-mode logs: `docker compose --profile app logs -f [service]`.

## Migrations (Drizzle)

```bash
npm run db:generate   # changes in src/db/schema.ts → SQL file in drizzle/
npm run db:migrate    # apply new migrations to the database
```

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | /api/register | — | register `{email, password}` |
| POST | /api/login | — | login, sets `sid` cookie |
| POST | /api/logout | — | deletes the session, clears the cookie |
| GET | /api/twits | cookie | twit feed |
| POST | /api/twits | cookie | create a twit `{text}`; author comes from the session |
| GET | /api/health | — | infrastructure status |

## Tools

| UI | Address | Connection from inside Docker |
|---|---|---|
| pgAdmin | http://localhost:8082 | host `postgres:5432`, user/pass/db `twitter` |
| Kafka UI | http://localhost:8081 | cluster preconfigured |
| RedisInsight | http://localhost:5540 | host `redis`, port `6379` |

All ports are bound to 127.0.0.1 — nothing is visible from outside the machine.

## Layout

```
packages/shared/          shared clients (kafka, redis, topics)
services/<name>/          standalone service: package.json + src/
services/twit-service/
  ├── drizzle/            SQL migrations
  └── src/db/schema.ts    database schema (source of truth)
Dockerfile                one for all services: --build-arg SERVICE=<name>
docker-compose.yml        infrastructure + app profile for the services
.env                      variables for host processes and docker-compose interpolation
```
