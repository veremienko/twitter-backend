# Навчальна мапа проєкту

Що вже вивчено на цьому проєкті і що попереду. Помітка `[x]` — тема пройдена і
закріплена кодом у репозиторії. Оновлюється в міру просування.

## Пройдено

### База даних і транзакції

- [x] **ACID-транзакції** — лайки: insert + інкремент лічильника атомарно,
      rollback через виняток (404), «помилку в транзакції не можна проковтнути»
- [x] **Unique-констрейнт як інваріант** — один лайк на користувача, код `23505` → 409
- [x] **Денормалізований лічильник** — `twits.likes` як кешований `count(*)`
- [x] **Міграції (drizzle-kit)** і колекція граблів: append-only; NOT NULL без
      DEFAULT на непорожній таблиці; перегенерація застосованої міграції;
      зміна схеми без міграції (`42703`); rename через інтерактивний generate;
      squash і baseline
- [x] **Transactional outbox + relay** — подія в БД у тій самій транзакції,
      фоновий відправник, at-least-once
- [x] **Ідемпотентний консюмер** — `eventId` у headers, Redis `SET NX`,
      «помітити → зробити» = at-most-once для ефекту

### Kafka і асинхронність

- [x] **Consumer groups** — партиція на одного учасника, ребаланс, session
      timeout, чому дублікати інстансів (Docker + локальний) крадуть партиції
- [x] **Публікація/споживання** — headers, offset-и, консольні інструменти
      (`kafka-console-consumer`, `kafka-consumer-groups`)

### Надійність

- [x] **Graceful shutdown** — `registerShutdown` у shared: порядок
      «вхід → поточна робота → клієнти», `server.close` + `closeIdleConnections`,
      `consumer.disconnect` (ребаланс за ~1с замість 30-45с), страховка exit(1)
- [x] **Таймаути** — `AbortSignal.timeout` на кожен мережевий виклик,
      зовнішній ліміт більший за внутрішній, 504 vs 502
- [x] **Graceful degradation** — стрічка без імен замість падіння;
      деградована відповідь не кешується

### Кешування

- [x] **Cache-aside + інвалідація на запис** — після коміту транзакції, не всередині
- [x] **Отруєння кешу** — деградовані/пагіновані відповіді в спільному ключі

### Тестування

- [x] **node:test** — describe/it, хуки, `assert.rejects`, пастки
      (`assert.throws` з рядком, `notEqual` на масивах, порожні it — зелені)
- [x] **Три рівні** — unit (parseBody) → сервіс з реальними Postgres/Redis
      (rollback, 409) → HTTP через `createApp` + `listen(0)`
- [x] **Ізоляція** — окрема БД `twitter_test`, TRUNCATE у beforeEach, окрема
      Redis-база `/1`, запобіжник по `current_database()`, гонка паралельних
      тест-файлів → `--test-concurrency=1`

### API

- [x] **Offset-пагінація** — контракт у shared, пастка falsy-нуля,
      «обидва або жодного», кеш тільки для повної стрічки
- [x] **OpenAPI з zod** — одна схема на валідацію і документацію, Swagger UI
- [x] **Router-per-domain** — роутери gateway, збирач apiRouter, фабрика createApp

### Інфраструктура і процеси

- [x] **CI (GitHub Actions)** — сервіс-контейнери Postgres/Redis, health checks,
      міграції перед тестами, версія екшена vs версія Node
- [x] **Docker profiles + compose watch** — інфраструктура окремо від застосунків
- [x] **Node процеси** — сигнали (SIGTERM/SIGSTOP), event loop і відкриті
      хендли (чому раннер/процес «не завершується»), unhandled rejection вбиває
      процес, `node --watch` і його зависання

### Observability

- [x] **Request-id наскрізь** — народжується в gateway (або приходить від
      клієнта), `AsyncLocalStorage` замість прокидання параметрами, переживає
      Kafka через колонку в outbox + headers
- [x] **pino** — структуровані JSON-логи, фабрика в shared, `mixin()` +
      AsyncLocalStorage підмішують requestId автоматично, access-log через
      `res.on('finish')`, pino-pretty у dev / сирий JSON у проді
- [x] **Метрики** — prom-client: default-метрики + Counter/Histogram у middleware,
      кардинальність лейблів (шаблон роута, не URL), Prometheus + Grafana в compose,
      таргет-лейбли з `honor_labels`, PromQL (`rate`, `histogram_quantile`)

## Попереду (в рекомендованому порядку)

- [ ] **Keyset/cursor-пагінація** — чому offset дрейфує на живій стрічці,
      `WHERE (created_at, id) < cursor` (мала тема-розминка)
- [ ] **Streams і файли** — завантаження аватарок: multipart, `pipeline()`,
      backpressure, MinIO у compose (найбільша суто Node-тема)
- [ ] **Worker threads** — ресайз зображень через sharp, демонстрація
      блокування event loop
- [ ] **Real-time: SSE/WebSockets** — notification-service шле в браузер,
      довгоживучі з'єднання + graceful shutdown для них
- [ ] **Rate limiting** — token bucket на Redis у gateway
- [ ] **Кілька інстансів сервісу** — конкуренція relay за outbox
      (`FOR UPDATE SKIP LOCKED`), cache stampede, stateless-дизайн
- [ ] **Process hardening** — глобальні `unhandledRejection`/`uncaughtException`
- [ ] **Профілювання** — `--inspect`, heap snapshot, пошук memory leak,
      event loop lag на живому сервісі
- [ ] **Фінал: підписки + fan-out стрічки** — таблиця follows з лічильниками,
      fan-out on write vs on read — збирає разом усі попередні теми

## За межами проєкту (окремі напрямки)

- **NestJS** — формалізує вже знайомі патерни (DI, controllers, guards)
- **GraphQL / gRPC / tRPC** — інші стилі API
- **CLI-інструменти, публікація npm-пакета, serverless**
- **Тести: моки (`mock.method`), coverage, contract-тести між сервісами**
