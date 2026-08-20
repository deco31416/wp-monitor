import test from 'node:test';
import assert from 'node:assert/strict';
import {
    hashRateLimitIdentity,
    MemoryFixedWindowRateLimitStore,
    parseRedisRateLimitResponse,
    RedisFixedWindowRateLimitStore,
} from '../src/rate-limit.js';

test('memory fixed-window limits increment atomically and reset after expiry', async () => {
    let now = 1_000;
    const store = new MemoryFixedWindowRateLimitStore(() => now);
    const rules = [
        { key: 'ip:opaque-a', limit: 3 },
        { key: 'pair:opaque-b', limit: 2 },
    ];

    assert.deepEqual(await store.consume(rules, 10_000), {
        allowed: true,
        retryAfterSeconds: 0,
        counts: [1, 1],
    });
    assert.equal((await store.consume(rules, 10_000)).allowed, true);

    const denied = await store.consume(rules, 10_000);
    assert.equal(denied.allowed, false);
    assert.equal(denied.retryAfterSeconds, 10);
    assert.deepEqual(denied.counts, [3, 3]);

    now = 11_000;
    assert.deepEqual(await store.consume(rules, 10_000), {
        allowed: true,
        retryAfterSeconds: 0,
        counts: [1, 1],
    });
});

test('rate-limit identities are stable HMACs without raw IP or token material', () => {
    const first = hashRateLimitIdentity('unit-secret', 'checkin-submit', '192.0.2.10', 'synthetic-token');
    const second = hashRateLimitIdentity('unit-secret', 'checkin-submit', '192.0.2.10', 'synthetic-token');
    const otherSecret = hashRateLimitIdentity('different-secret', 'checkin-submit', '192.0.2.10', 'synthetic-token');

    assert.equal(first, second);
    assert.notEqual(first, otherSecret);
    assert.match(first, /^[a-f0-9]{64}$/);
    assert.equal(first.includes('192.0.2.10'), false);
    assert.equal(first.includes('synthetic-token'), false);
});

test('Redis rate-limit store sends one atomic EVAL for all counters', async () => {
    let command: string[] = [];
    const store = new RedisFixedWindowRateLimitStore({
        async sendCommand(received) {
            command = received;
            return [1, 4_250, 61, 9];
        },
    }, 'unit');

    const decision = await store.consume([
        { key: 'ip:opaque-a', limit: 60 },
        { key: 'pair:opaque-b', limit: 8 },
    ], 600_000);

    assert.equal(command[0], 'EVAL');
    assert.equal(command[2], '2');
    assert.deepEqual(command.slice(3, 5), [
        'unit:rate-limit:ip:opaque-a',
        'unit:rate-limit:pair:opaque-b',
    ]);
    assert.deepEqual(decision, {
        allowed: false,
        retryAfterSeconds: 5,
        counts: [61, 9],
    });
});

test('rejects malformed Redis rate-limit responses', () => {
    assert.throws(() => parseRedisRateLimitResponse([0, 0], 2), /invalid rate-limit response/);
    assert.throws(() => parseRedisRateLimitResponse([2, 0, 1], 1), /invalid rate-limit decision/);
});
