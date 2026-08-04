export function registerShutdown(
    ...steps: Array<() => Promise<unknown> | unknown>
) {
    async function shutdown(signal: string) {
        console.log(`${signal} received, shutting down`);

        setTimeout(() => process.exit(1), 10_000).unref();

        for (const step of steps) {
            await step();
        }

        console.log('shutdown complete');
        process.exit(0);
    }

    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
}
