export function registerShutdown(
    ...steps: Array<() => Promise<unknown> | unknown>
) {
    async function shutdown(reason: string, exitCode: number) {
        console.log(`${reason}, shutting down`);

        setTimeout(() => process.exit(1), 10_000).unref();

        for (const step of steps) {
            await step();
        }

        console.log('shutdown complete');
        process.exit(exitCode);
    }

    process.once('SIGTERM', () => shutdown('SIGTERM received', 0));
    process.once('SIGINT', () => shutdown('SIGINT received', 0));

    // Node's default reaction to either of these is to crash immediately —
    // no chance to close the HTTP server, Kafka producer/consumer, Redis or
    // DB connections first. Routing them through the same teardown steps
    // buys a clean-ish exit instead of open connections just vanishing.
    // `once` matters here as much as on the signals above: if a teardown
    // step itself throws, that must not re-enter `shutdown` a second time
    // and start a second, overlapping teardown — the 10s watchdog inside
    // `shutdown` is the backstop if a step hangs or fails.
    process.once('uncaughtException', (error) => {
        console.error('uncaughtException:', error);
        shutdown('uncaughtException', 1);
    });
    process.once('unhandledRejection', (reason) => {
        console.error('unhandledRejection:', reason);
        shutdown('unhandledRejection', 1);
    });
}
