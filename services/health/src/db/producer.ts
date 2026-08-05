import { createKafka } from '@twitter/shared';
import { Partitioners } from 'kafkajs';

export const producer = createKafka('health').producer({
    createPartitioner: Partitioners.DefaultPartitioner,
});
