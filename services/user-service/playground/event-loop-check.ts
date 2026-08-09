import sharp from 'sharp';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import {
    AVATAR_MAX_DIMENSION,
    HttpError,
} from '@twitter/shared';

const testImage = await sharp({
    create: {
        width: 4000,
        height: 4000,
        channels: 3,
        background: { r: 100, g: 150, b: 200 },
    },
})
    .png()
    .toBuffer();

const histogram = monitorEventLoopDelay({ resolution: 1 });
histogram.enable();

setInterval(() => {
    console.log(`Mean Lag: ${histogram.mean / 1e6} ms`);
    console.log(`Max Lag: ${histogram.max / 1e6} ms`);
    histogram.reset();
}, 1000);
