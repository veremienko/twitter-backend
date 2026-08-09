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
- [x] **Keyset/cursor-пагінація** — `(created_at, id) < (cursor)` замість offset:
      курсор прив'язаний до рядка, тому нові твіти між читаннями не зсувають
      сторінку. Граблі: ORDER BY мусить бути тотальним (`id` як tiebreaker) і
      тупль у WHERE — у тому ж порядку, що й ORDER BY; курсор кодується як
      JSON+base64url (розділювач-двокрапка ламається об ISO-дату), `toString()`
      губить мілісекунди і мовчки викидає твіти з тієї ж секунди; індекс мусить
      повторювати ORDER BY разом із `NULLS FIRST`, інакше планувальник лишає
      Sort; курсор — це вхід від клієнта, отже 400, а не 500
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

### Streams і файли

- [x] **Аватарки потоком** — multipart через busboy, `pipeline()` замість `.pipe()`
      (передає помилки і прибирає ланцюг), backpressure як умова того, що 5 МБ
      не осідають у пам'яті, MinIO у compose + `@aws-sdk/lib-storage`.
      Граблі, кожна з яких коштувала окремої діагностики: gateway мусить
      прокидати `content-type` дослівно, інакше губиться boundary; busboy емітить
      `limit` **синхронно**, ще до першого читання, тому обробник треба вішати в
      колбеку `'file'`, а не після `await`; `part.destroy()` кидає `error`
      раніше, ніж `pipeline` встигає підключитися, — рятує порожній слухач плюс
      `part.errored`; непрочитана чужа частина стопорить парсер; `limits.files:1`
      з'їдається першою-ліпшою частиною, тож друга не долітає; сніф мусить
      віддавати **накопичене**, а не поточний чанк, інакше зникає заголовок
      картинки; `Readable.toWeb` не тайпиться проти undici — колізія двох
      описів web-потоків у `@types/node`
- [x] **Worker threads** — ресайз зображень через sharp, демонстрація
      блокування event loop: `perf_hooks.monitorEventLoopDelay` показав, що
      сам sharp event loop не блокує (важка робота йде в libuv threadpool),
      а синхронний `while`-цикл — блокує повністю (300мс блокування →
      рівно 300мс `Max Lag`). Той самий блок, винесений у `worker_threads`,
      головного потоку вже не чіпає (інший `threadId`). Граблі: Windows дає
      таймеру грубість ~15.6мс — це шумова підлога вимірювання, тому
      потрібен контрольний (свідомо блокуючий) тест, щоб довести, що
      інструмент взагалі щось бачить; `setTimeout` всередині `while` ніколи
      не спрацює — синхронний цикл сам не дає event loop дістатись до черги
      таймерів; подвійний `histogram.reset()` перед виводом обнуляє
      `Max Lag` до нуля ще до того, як його прочитали; `fileURLToPath` на
      відносному рядку падає — `Worker` приймає `URL`, резолвити слід через
      `new URL(rel, import.meta.url)`, бо в ESM немає `__dirname`;
      кореневий `tsconfig.json` не бачив `playground/`, бо `include`
      обмежений на `services/*/src`. Бонус: `nodejs_eventloop_lag_seconds`
      вже збирається безкоштовно через `collectDefaultMetrics` у
      `packages/shared/src/prometheus.ts` — не треба нічого писати, щоб
      бачити лаг у Prometheus/Grafana.
- [ ] **Real-time: SSE/WebSockets** — notification-service шле в браузер,
      довгоживучі з'єднання + graceful shutdown для них
- [ ] **Rate limiting** — token bucket на Redis у gateway
- [ ] **Кілька інстансів сервісу** — конкуренція relay за outbox
      (`FOR UPDATE SKIP LOCKED`), cache stampede, stateless-дизайн
- [ ] **Process hardening** — глобальні `unhandledRejection`/`uncaughtException`
- [x] **Профілювання** — `--inspect`, event loop lag на живому сервісі
      (аватарки під конкурентним навантаженням). `chrome://inspect` →
      Performance-панель (класичну "Profiler" і навіть "JavaScript
      Profiler" з "More tools" у нових Chrome прибрали взагалі). Спосіб
      довести, що знайдений у флейм-чарті блок — саме твій код: у стеку
      мають бути власні файли (`avatar.ts`, `users.service.ts`,
      `users.controller.ts`), а не здогад по часу. Головне відкриття:
      `nodejs_eventloop_lag_max_seconds` (безкоштовний з
      `collectDefaultMetrics`) скидається між скрейпами, а не тримає
      lifetime-максимум — перевірено напряму через Prometheus HTTP API
      (`/api/v1/query_range`), звірене по секундах з `process_start_time_seconds`
      і з лічильником `http_requests_total`. Найбільший зафіксований сплеск
      (~315мс) виявився не навантаженням, а холодним стартом самого
      сервісу (перше підвантаження нативного sharp/libvips); дрібніші
      сплески (52-245мс) точно збіглися в часі із запусками навантажувального
      скрипта. У самому профілі це не один великий блокуючий виклик, а
      купа дрібних синхронних задач підряд без пауз (парсинг HTTP,
      серіалізація запиту в AWS SDK, `Buffer.concat` з `collectToBuffer`,
      GC) — кожна на кілька мс, разом вони не лишають event loop вікна між
      таймерами. Граблі: лейбл у `prometheus.yml` — `service`, не `job`
      (усі таргети на одному job); лічильники `JS heap`/`Documents`/`Nodes`/
      `Listeners`/`GPU memory` у Performance-панелі — браузерні DOM-поняття,
      для чистого Node-процесу не працюють (heap-графік лишається
      порожнім, "No memory usage data").
- [ ] **Фінал: підписки + fan-out стрічки** — таблиця follows з лічильниками,
      fan-out on write vs on read — збирає разом усі попередні теми

## За межами проєкту (окремі напрямки)

- **NestJS** — формалізує вже знайомі патерни (DI, controllers, guards)
- **GraphQL / gRPC / tRPC** — інші стилі API
- **CLI-інструменти, публікація npm-пакета, serverless**
- **Тести: моки (`mock.method`), coverage, contract-тести між сервісами**