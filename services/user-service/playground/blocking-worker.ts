import { parentPort, threadId } from "node:worker_threads";



setTimeout(async() => {
    const start = Date.now();
    while (Date.now() - start < 300) {}
    console.log('threadId', threadId);
    parentPort?.postMessage('done');
}, 5000);

