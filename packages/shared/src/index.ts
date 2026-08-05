export { createKafka, ensureTopics } from './kafka.ts';
export type { Producer, Consumer } from 'kafkajs';
export { createRedis, type RedisClient } from './redis.ts';
export { TOPICS } from './topics.ts';
export { HttpError, sendError, internalAuth, parseBody } from './http.ts';
export { NewUserSchema, type NewUser } from './contracts/users.ts';
export {
    CredentialsSchema,
    RegistrationSchema,
    MIN_PASSWORD_LENGTH,
    type Credentials,
    type Registration,
} from './contracts/auth.ts';
export {
    NewTwitSchema,
    MAX_TEXT_LENGTH,
    type NewTwit,
} from './contracts/twits.ts';

export { PaginationSchema, type Pagination } from './contracts/pagination.ts';

export { requestContext, requestContextMiddleware } from './context.ts';

export { createLogger } from './logger.ts';

export { registerShutdown } from './shutdown.ts';

export {
    metricsHandler,
    httpRequestsTotal,
    httpRequestDuration,
    httpMetricsMiddleware,
} from './prometheus.ts';
