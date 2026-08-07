# twitter-backend

Educational microservice backend: Express 5 + TypeScript (run natively by Node 25, no build step), PostgreSQL + Drizzle ORM, Redis (sessions and cache), Kafka (events between services).

## Architecture

```
client → api-gateway :3000 ─┬→ twit-service :3002 → PostgreSQL, Redis(cache) → Kafka: twit.created
        (sessions in Redis) ├→ auth-service :3003 → PostgreSQL, Redis(sessions)      ↓
                            └→ health       :3001                    notification-service (consumer)
```

| Service              | Port | Role                                     |
| -------------------- | ---- | ---------------------------------------- |
| api-gateway          | 3000 | single entry point, session check, proxy |
| health               | 3001 | postgres/redis/kafka status              |
| twit-service         | 3002 | twit CRUD, cache, event publishing       |
| auth-service         | 3003 | registration, login, sessions            |
| notification-service | —    | Kafka consumer of `twit.created` events  |

Shared code (Kafka/Redis clients, topic names) lives in `packages/shared` and is imported as `@twitter/shared` via npm workspaces.

Design patterns used across the services are catalogued in [docs/patterns.md](docs/patterns.md).
Learning progress and remaining topics live in [docs/learning-roadmap.md](docs/learning-roadmap.md).

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

Each service keeps its own journal table (`migrations.table` in `drizzle.config.ts`),
so several services can migrate the same database independently.

### Squashing migrations into one

Local dev only — never do this after migrations ran in a shared environment.

```bash
# 1. delete the service's migration history and generate one fresh migration
rm -rf services/<name>/drizzle
npm run db:generate -w services/<name>

# 2. recreate the database with an empty volume
docker compose rm -sf postgres
docker volume rm twitter-backend_postgres_data
docker compose up -d --wait postgres

# 3. apply migrations of ALL services (the database is empty now)
npm run db:migrate
```

To drop a single not-yet-applied migration instead, use `npx drizzle-kit drop`
inside the service directory — never delete migration files by hand, the
`drizzle/meta` journal must stay in sync.

### Baseline: adopting an existing table (production-safe)

When a table moves to a new service (or a fresh journal meets an existing schema),
its `0000` migration fails with `relation already exists`. Never drop data:
mark the migration as applied instead. Drizzle stores `sha256` of the SQL file
and the `when` timestamp from `meta/_journal.json`:

```bash
# 1. verify the live table matches the migration (column by column)
docker exec twitter-postgres psql -U twitter -d twitter -c '\d <table>'

# 2. hash + timestamp of the migration being baselined
shasum -a 256 services/<name>/drizzle/0000_*.sql
cat services/<name>/drizzle/meta/_journal.json   # take "when"

# 3. stamp the journal, then drop the previous owner's journal table
docker exec twitter-postgres psql -U twitter -d twitter \
  -c "INSERT INTO drizzle.<name>_migrations (hash, created_at) VALUES ('<sha256>', <when>)"

# 4. npm run db:migrate now succeeds without executing anything
```

## API

Interactive docs (Swagger UI): **http://localhost:3000/api/docs** — raw spec at
`/api/openapi.json`. Request bodies in the spec are generated from the same zod contracts the
services validate with (`packages/shared/src/contracts/`), so they cannot drift from the code.

`POST /api/login` through _Try it out_ leaves the `sid` cookie in the browser — the docs are
served from the same origin as the API, so the authenticated endpoints work right after it.

| Method | Path                    | Auth   | Description                                           |
| ------ | ----------------------- | ------ | ----------------------------------------------------- |
| POST   | /api/register           | —      | register `{email, password, name, age, sex}`          |
| POST   | /api/login              | —      | login, sets `sid` cookie                              |
| POST   | /api/logout             | —      | deletes the session, clears the cookie                |
| GET    | /api/twits              | cookie | twit feed, `{items, nextCursor}` — see below          |
| POST   | /api/twits              | cookie | create a twit `{text}`; author comes from the session |
| POST   | /api/twits/:twitId/like | cookie | like a twit, once per user; bumps the counter         |
| GET    | /api/health             | —      | infrastructure status                                 |
| GET    | /api/docs               | —      | Swagger UI                                            |
| GET    | /api/openapi.json       | —      | OpenAPI 3.1 spec                                      |
| POST   | /api/avatar             | —      | Upload profile avatar                                 |

### Feed pagination (keyset)

`GET /api/twits` always answers `{ items, nextCursor }`. Without `limit` it returns the whole
feed (cached in Redis for 30s) and no cursor. With `limit` it returns one page plus the
`nextCursor` to continue from; pass it back in the **`x-cursor` header** for the next page:

```bash
curl -b cookies.txt 'http://localhost:3000/api/twits?limit=20'
curl -b cookies.txt 'http://localhost:3000/api/twits?limit=20' -H "x-cursor: $NEXT"
```

An exhausted feed answers `items: []`. A cursor without `limit` is `400` (it would otherwise be
silently ignored and return everything), and a malformed cursor is `400` too.

The cursor is base64url of `{id, createdAt}` — the last row of the page. The query seeks with
`(created_at, id) < (cursor.created_at, cursor.id)`, so unlike `offset` it cannot drift when a
twit is posted between two reads. `ORDER BY created_at DESC, id DESC` needs `id` as a
tiebreaker to make the sort key unique, and `twits_created_at_id_idx` mirrors that ordering
exactly (including `NULLS FIRST`) so Postgres seeks instead of sorting.

## Tools

| UI           | Address               | Connection from inside Docker                |
| ------------ | --------------------- | -------------------------------------------- |
| pgAdmin      | http://localhost:8082 | host `postgres:5432`, user/pass/db `twitter` |
| Kafka UI     | http://localhost:8081 | cluster preconfigured                        |
| RedisInsight | http://localhost:5540 | host `redis`, port `6379`                    |

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
