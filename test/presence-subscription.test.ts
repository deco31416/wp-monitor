import test from 'node:test';
import assert from 'node:assert/strict';
import { PresenceSubscriptionCoordinator } from '../src/presence-subscription.js';

const TARGET = {
    jid: '573001112233@s.whatsapp.net',
    trackingSessionId: 'tracking-synthetic-001',
};

function fixture(redisResponse: unknown = 'OK') {
    const redisCommands: string[][] = [];
    const delays: number[] = [];
    const coordinator = new PresenceSubscriptionCoordinator({
        async sendCommand(command) {
            redisCommands.push(command);
            if (redisResponse instanceof Error) throw redisResponse;
            return redisResponse;
        },
    }, 'unit', 'unit-presence-identity-secret-1234567890', 60_000, [0, 10, 20], async delay => {
        delays.push(delay);
    });
    return { coordinator, redisCommands, delays };
}

test('subscribes once and stores only an opaque expiring Redis confirmation', async () => {
    const { coordinator, redisCommands, delays } = fixture();
    const subscribedJids: string[] = [];
    const result = await coordinator.subscribe(TARGET, {
        async presenceSubscribe(jid) { subscribedJids.push(jid); },
    }, 'tracking_start');

    assert.deepEqual(result, {
        subscribed: true,
        attempts: 1,
        reason: 'tracking_start',
        redisCoordinated: true,
    });
    assert.deepEqual(subscribedJids, [TARGET.jid]);
    assert.deepEqual(delays, []);
    assert.equal(redisCommands.length, 1);
    assert.match(redisCommands[0]?.[1] || '', /^unit:presence:subscription:[a-f0-9]{64}$/);
    assert.equal(redisCommands[0]?.join(' ').includes(TARGET.jid), false);
    assert.deepEqual(redisCommands[0]?.slice(0, 3), [
        'SET', redisCommands[0]?.[1], 'subscribed:v1:tracking_start',
    ]);
    assert.equal(redisCommands[0]?.includes('PX'), true);
});

test('retries transient Baileys failures with bounded delays', async () => {
    const { coordinator, delays } = fixture();
    let attempts = 0;
    const result = await coordinator.subscribe(TARGET, {
        async presenceSubscribe() {
            attempts += 1;
            if (attempts < 3) throw new Error('temporary');
        },
    }, 'connection_restore');

    assert.equal(result.subscribed, true);
    assert.equal(result.attempts, 3);
    assert.deepEqual(delays, [10, 20]);
});

test('reports a failed subscription without creating Redis state', async () => {
    const { coordinator, redisCommands } = fixture();
    const result = await coordinator.subscribe(TARGET, {
        async presenceSubscribe() { throw new Error('unavailable'); },
    }, 'connection_restore');

    assert.deepEqual(result, {
        subscribed: false,
        attempts: 3,
        reason: 'connection_restore',
        redisCoordinated: false,
    });
    assert.deepEqual(redisCommands, []);
});

test('keeps a successful Baileys subscription explicit when Redis is degraded', async () => {
    const { coordinator } = fixture(new Error('redis unavailable'));
    const result = await coordinator.subscribe(TARGET, {
        async presenceSubscribe() { return; },
    }, 'tracking_start');

    assert.equal(result.subscribed, true);
    assert.equal(result.redisCoordinated, false);
});

test('rejects group and non-canonical targets before contacting Baileys or Redis', async () => {
    const { coordinator, redisCommands } = fixture();
    let attempts = 0;
    await assert.rejects(() => coordinator.subscribe({
        ...TARGET,
        jid: '12345-67890@g.us',
    }, {
        async presenceSubscribe() { attempts += 1; },
    }, 'tracking_start'), /canonical individual/);

    assert.equal(attempts, 0);
    assert.deepEqual(redisCommands, []);
});
