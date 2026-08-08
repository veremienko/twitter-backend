import { z } from 'zod';
import {
    AVATAR_MAX_BYTES,
    AVATAR_MIME_TYPES,
    CredentialsSchema,
    NewTwitSchema,
    PaginationSchema,
    RegistrationSchema,
} from '@twitter/shared';

/**
 * Request bodies are generated from the zod contracts the services validate with,
 * so the spec cannot drift from the validation. Responses below are hand-written:
 * nothing validates them at runtime, and pretending otherwise would be a lie.
 *
 * `io: 'input'` describes what the client sends (before trim/lowercase), which is
 * what a request body means.
 */
function requestSchema(schema: z.ZodType) {
    const { $schema, ...jsonSchema } = z.toJSONSchema(schema, { io: 'input' });
    return jsonSchema;
}

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const json = (description: string, schema: object) => ({
    description,
    content: { 'application/json': { schema } },
});

const body = (schema: z.ZodType) => ({
    required: true,
    content: { 'application/json': { schema: requestSchema(schema) } },
});

/**
 * One field of a zod object contract, reused as a parameter schema so bounds
 * like limit's 1..100 stay in step with validation. `.refine()` rules have no
 * JSON Schema equivalent and are dropped here, so any rule spanning two
 * parameters has to be stated in their descriptions.
 */
const paramSchema = (schema: z.ZodType, field: string) =>
    (requestSchema(schema) as { properties: Record<string, object> })
        .properties[field];

/** `{ error }` as produced by sendError in @twitter/shared. */
const error = (description: string) => json(description, ref('Error'));

const badGateway = error(
    'A downstream service is unreachable or returned junk.',
);

export const openApiDocument = {
    openapi: '3.1.0',
    info: {
        title: 'twitter-backend API',
        version: '1.0.0',
        description: [
            'Public API of the gateway. Everything here is proxied to an internal service;',
            'the internal ports and their `x-internal-token` are never exposed.',
            '',
            '**Authentication.** `POST /login` sets an httpOnly `sid` cookie holding the session',
            '(stored in Redis, TTL 7 days). Swagger UI cannot set that cookie by hand — but these',
            'docs are served from the same origin as the API, so running `POST /login` via',
            '*Try it out* leaves the cookie in your browser and the 🔒 endpoints work right after.',
        ].join('\n'),
    },
    servers: [{ url: '/api', description: 'through the gateway' }],
    tags: [
        { name: 'auth', description: 'registration and sessions' },
        { name: 'twits', description: 'feed and posting' },
        { name: 'ops', description: 'infrastructure status' },
        { name: 'users', description: 'profiles and avatars' },
    ],
    paths: {
        '/health': {
            get: {
                tags: ['ops'],
                summary: 'Infrastructure status',
                operationId: 'getHealth',
                description:
                    'Pings postgres, redis and kafka. 200 only when all three answer `ok`.',
                security: [],
                responses: {
                    200: json('Everything is up.', ref('Health')),
                    503: json(
                        'At least one dependency is down; its field holds the error message.',
                        ref('Health'),
                    ),
                    502: badGateway,
                },
            },
        },
        '/register': {
            post: {
                tags: ['auth'],
                summary: 'Register a user',
                operationId: 'register',
                description:
                    'Hashes the password with bcrypt and hands the profile to user-service. Does not log you in.',
                security: [],
                requestBody: body(RegistrationSchema),
                responses: {
                    201: json('Registered.', ref('Message')),
                    400: error('A field failed validation.'),
                    409: error('Email already exists.'),
                    502: badGateway,
                },
            },
        },
        '/login': {
            post: {
                tags: ['auth'],
                summary: 'Log in',
                operationId: 'login',
                description:
                    'Creates a session in Redis and returns it as the `sid` cookie.',
                security: [],
                requestBody: body(CredentialsSchema),
                responses: {
                    200: {
                        ...json('Logged in.', ref('Message')),
                        headers: {
                            'Set-Cookie': {
                                description:
                                    'sid=<uuid>; HttpOnly; SameSite=Lax; Max-Age=604800',
                                schema: { type: 'string' },
                            },
                        },
                    },
                    400: error('A field failed validation.'),
                    401: error(
                        'Invalid email or password — the same message either way, on purpose.',
                    ),
                    502: badGateway,
                },
            },
        },
        '/logout': {
            post: {
                tags: ['auth'],
                summary: 'Log out',
                operationId: 'logout',
                description:
                    'Deletes the session from Redis and clears the cookie. Succeeds even without a session.',
                security: [],
                responses: {
                    200: json('Logged out.', ref('Message')),
                    502: badGateway,
                },
            },
        },
        '/twits': {
            get: {
                tags: ['twits'],
                summary: 'Feed',
                operationId: 'getTwits',
                description: [
                    'Twits newest first, enriched with author names.',
                    '',
                    'Without `limit` the whole feed comes back in one response, cached in Redis',
                    'for 30s — so a fresh twit may take a moment to appear. With `limit` the feed',
                    'is paginated by keyset: send `nextCursor` back as the `x-cursor` header to get',
                    'the following page, and stop when `items` is empty. Unlike offset pagination',
                    'a cursor is anchored to a row, so twits posted between two reads never shift',
                    'a page and cause a duplicate.',
                ].join('\n'),
                parameters: [
                    {
                        name: 'limit',
                        in: 'query',
                        required: false,
                        description:
                            'Page size. Omit for the whole feed; required whenever `x-cursor` is sent.',
                        schema: paramSchema(PaginationSchema, 'limit'),
                    },
                    {
                        name: 'x-cursor',
                        in: 'header',
                        required: false,
                        description:
                            'The `nextCursor` of the previous page. Requires `limit` — on its own it is a 400, because it would otherwise be ignored and return the entire feed.',
                        schema: paramSchema(PaginationSchema, 'nextCursor'),
                    },
                ],
                responses: {
                    200: json('The feed.', {
                        type: 'object',
                        properties: {
                            items: { type: 'array', items: ref('FeedTwit') },
                            nextCursor: {
                                type: 'string',
                                description:
                                    'Absent on an unpaginated feed and once the feed is exhausted.',
                                examples: [
                                    'eyJpZCI6OSwiY3JlYXRlZEF0IjoiMjAyNi0wOC0wNlQxMjowMjo0Ny45NjFaIn0',
                                ],
                            },
                        },
                        required: ['items'],
                    }),
                    400: error(
                        'limit is out of the 1..100 range, x-cursor was sent without limit, or the cursor is malformed.',
                    ),
                    401: error('No or expired session.'),
                    502: badGateway,
                },
            },
            post: {
                tags: ['twits'],
                summary: 'Post a twit',
                operationId: 'createTwit',
                description:
                    'The author comes from the session, never from the body. Publishes `twit.created` via the transactional outbox.',
                requestBody: body(NewTwitSchema),
                responses: {
                    201: json('Created.', ref('Twit')),
                    400: error('Text is empty or over 280 characters.'),
                    401: error('No or expired session.'),
                    502: badGateway,
                },
            },
        },
        '/twits/{twitId}/like': {
            post: {
                tags: ['twits'],
                summary: 'Like a twit',
                operationId: 'likeTwit',
                description:
                    'One like per user per twit, enforced by a unique constraint; the counter is bumped in the same transaction.',
                parameters: [
                    {
                        name: 'twitId',
                        in: 'path',
                        required: true,
                        // `examples` belongs to the schema here: on a parameter object
                        // itself OpenAPI expects a map, not the JSON Schema array.
                        schema: { type: 'integer', minimum: 1, examples: [1] },
                    },
                ],
                responses: {
                    200: json('Liked, with the updated counter.', ref('Twit')),
                    401: error('No or expired session.'),
                    404: error('Twit not found.'),
                    409: error('You already liked this twit.'),
                    502: badGateway,
                },
            },
        },
        '/avatar': {
            post: {
                tags: ['users'],
                summary: 'Upload an avatar',
                operationId: 'uploadAvatar',
                description: [
                    'Replaces the avatar of the logged-in user; the owner comes from the session,',
                    `never from the request. Send one file part named \`file\`, at most ${
                        AVATAR_MAX_BYTES / 1024 / 1024
                    } MB,`,
                    `as ${AVATAR_MIME_TYPES.join(', ')}.`,
                    '',
                    'The body is never buffered: it is parsed and forwarded to object storage while',
                    'it arrives, so an oversized upload is cut off mid-transfer rather than after the',
                    'last byte, and the connection may be closed before the error response is read.',
                ].join('\n'),
                requestBody: {
                    required: true,
                    content: {
                        'multipart/form-data': {
                            schema: {
                                type: 'object',
                                properties: {
                                    file: {
                                        type: 'string',
                                        format: 'binary',
                                    },
                                },
                                required: ['file'],
                            },
                            encoding: {
                                file: {
                                    contentType: AVATAR_MIME_TYPES.join(', '),
                                },
                            },
                        },
                    },
                },
                responses: {
                    200: json(
                        'Stored, and the profile now points at it.',
                        ref('Avatar'),
                    ),
                    400: error(
                        'The body is not multipart, carries no `file` part, or the file is empty.',
                    ),
                    401: error('No or expired session.'),
                    404: error(
                        'The session points at a user that no longer exists.',
                    ),
                    413: error(
                        `The file is larger than ${AVATAR_MAX_BYTES / 1024 / 1024} MB.`,
                    ),
                    415: error(
                        'The leading bytes of the file are not a supported image. The declared Content-Type is ignored, so a mislabelled file is rejected here even when the header looks right.',
                    ),
                    502: badGateway,
                },
            },
        },
        '/users/{userId}/avatar': {
            get: {
                tags: ['users'],
                summary: 'Read an avatar',
                operationId: 'getAvatar',
                description: [
                    'Serves the stored image. The path never changes for a given user, so a',
                    'client that caches it has to revalidate rather than expect a new URL after',
                    'an upload.',
                    '',
                    'The media type is the one sniffed from the bytes when they were stored, not',
                    'the one the uploader claimed.',
                ].join('\n'),
                parameters: [
                    {
                        name: 'userId',
                        in: 'path',
                        required: true,
                        schema: { type: 'integer', minimum: 1, examples: [1] },
                    },
                ],
                responses: {
                    200: {
                        description: 'The image, streamed from object storage.',
                        content: Object.fromEntries(
                            AVATAR_MIME_TYPES.map((type) => [
                                type,
                                {
                                    schema: {
                                        type: 'string',
                                        format: 'binary',
                                    },
                                },
                            ]),
                        ),
                    },
                    401: error('No or expired session.'),
                    404: error('No such user, or the user has no avatar.'),
                    502: badGateway,
                },
            },
        },
    },
    components: {
        securitySchemes: {
            cookieAuth: {
                type: 'apiKey',
                in: 'cookie',
                name: 'sid',
                description: 'Session cookie set by POST /login.',
            },
        },
        schemas: {
            Message: {
                type: 'object',
                properties: {
                    message: {
                        type: 'string',
                        examples: ['Login successful'],
                    },
                },
                required: ['message'],
            },
            Error: {
                type: 'object',
                properties: {
                    error: { type: 'string', examples: ['unauthorized'] },
                },
                required: ['error'],
            },
            Health: {
                type: 'object',
                description: 'Per-dependency `ok`, or the error message.',
                properties: {
                    postgres: { type: 'string', examples: ['ok'] },
                    redis: { type: 'string', examples: ['ok'] },
                    kafka: { type: 'string', examples: ['ok'] },
                },
                required: ['postgres', 'redis', 'kafka'],
            },
            Twit: {
                type: 'object',
                properties: {
                    id: { type: 'integer', examples: [1] },
                    authorId: { type: 'integer', examples: [1] },
                    text: { type: 'string', examples: ['hello world'] },
                    createdAt: {
                        type: 'string',
                        format: 'date-time',
                        examples: ['2026-08-04T09:14:44.981Z'],
                    },
                    likes: { type: 'integer', examples: [0] },
                },
                required: ['id', 'authorId', 'text', 'createdAt', 'likes'],
            },
            FeedTwit: {
                allOf: [
                    ref('Twit'),
                    {
                        type: 'object',
                        description:
                            'A twit in the feed; authorName is null when user-service knows no such author.',
                        properties: {
                            authorName: {
                                type: ['string', 'null'],
                                examples: ['Alice'],
                            },
                        },
                        required: ['authorName'],
                    },
                ],
            },
            Avatar: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: [
                            'Where to read the image back, through the gateway and behind the same',
                            'session cookie. The path is derived from the user id, so it stays the',
                            'same after every upload — a client that caches it has to revalidate',
                            'rather than trust the URL to change.',
                        ].join(' '),
                        examples: ['/api/users/1/avatar'],
                    },
                },
                required: ['url'],
            },
        },
    },
    security: [{ cookieAuth: [] }],
};
