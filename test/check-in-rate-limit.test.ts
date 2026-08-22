import test from 'node:test';
import assert from 'node:assert/strict';
import {
    createPublicCheckInSubmitRateLimitGuard,
    getClientIp,
    type RateLimitResponseLike,
} from '../src/check-in-rate-limit.js';
import {
    RedisFixedWindowRateLimitStore,
    type FixedWindowRateLimitStore,
    type RateLimitDecision,
    type RateLimitRule,
} from '../src/rate-limit.js';

class ResponseRecorder implements RateLimitResponseLike {
    readonly headers = new Map<string, string>();
    statusCode = 200;
    body: { error: string } | null = null;

    setHeader(name: string, value: string): void {
        this.headers.set(name.toLowerCase(), value);
    }

    status(code: number): this {
        this.statusCode = code;
        return this;
    }

    json(body: { error: string }): this {
        this.body = body;
        return this;
    }
}

class CapturingStore implements FixedWindowRateLimitStore {
    rules: RateLimitRule[] = [];
    windowMs = 0;

    constructor(private readonly result: RateLimitDecision | Error) {}

    async consume(rules: RateLimitRule[], windowMs: number): Promise<RateLimitDecision> {
        this.rules = rules;
        this.windowMs = windowMs;
        if (this.result instanceof Error) throw this.result;
        return this.result;
    }
}

const baseOptions = {
    identitySecret: 'unit-secret-with-sufficient-entropy',
    windowMs: 600_000,
    maxPerIp: 60,
    maxPerTokenIp: 8,
};

test('normalizes IPv4-mapped client addresses', () => {
    assert.equal(getClientIp({ ip: '::ffff:192.0.2.10' }), '192.0.2.10');
    assert.equal(getClientIp({ socket: { remoteAddress: '2001:db8::10' } }), '2001:db8::10');
    assert.equal(getClientIp({}), 'unknown');
});

test('allows a request while sending only opaque identities to the store', async () => {
    const store = new CapturingStore({ allowed: true, retryAfterSeconds: 0, counts: [1, 1] });
    const guard = createPublicCheckInSubmitRateLimitGuard({ ...baseOptions, store });
    const response = new ResponseRecorder();

    assert.equal(await guard({ ip: '::ffff:192.0.2.10' }, response, 'synthetic-secret-token'), true);
    assert.equal(response.statusCode, 200);
    assert.equal(store.windowMs, 600_000);
    assert.deepEqual(store.rules.map(rule => rule.limit), [60, 8]);
    for (const rule of store.rules) {
        assert.equal(rule.key.includes('192.0.2.10'), false);
        assert.equal(rule.key.includes('synthetic-secret-token'), false);
        assert.match(rule.key, /^checkin-submit:(ip|token-ip):[a-f0-9]{64}$/);
    }
});

test('returns 429 and Retry-After when a shared counter denies the request', async () => {
    const store = new CapturingStore({ allowed: false, retryAfterSeconds: 37, counts: [61, 9] });
    const guard = createPublicCheckInSubmitRateLimitGuard({ ...baseOptions, store });
    const response = new ResponseRecorder();

    assert.equal(await guard({ ip: '192.0.2.10' }, response, 'synthetic-token'), false);
    assert.equal(response.statusCode, 429);
    assert.equal(response.headers.get('retry-after'), '37');
    assert.deepEqual(response.body, { error: 'Too many check-in submit attempts. Try again later.' });
});

test('fails closed with 503 without exposing store errors or request identities', async () => {
    const store = new CapturingStore(new Error('Redis failed for 192.0.2.10 and synthetic-token'));
    const guard = createPublicCheckInSubmitRateLimitGuard({ ...baseOptions, store });
    const response = new ResponseRecorder();

    assert.equal(await guard({ ip: '192.0.2.10' }, response, 'synthetic-token'), false);
    assert.equal(response.statusCode, 503);
    assert.equal(response.headers.get('retry-after'), '5');
    assert.deepEqual(response.body, { error: 'Rate limit service unavailable. Try again later.' });
    assert.equal(JSON.stringify(response.body).includes('192.0.2.10'), false);
    assert.equal(JSON.stringify(response.body).includes('synthetic-token'), false);
});

test('two application instances share the same Redis counters', async () => {
    const counters = new Map<string, number>();
    const redis = {
        async sendCommand(command: string[]): Promise<unknown> {
            const keyCount = Number(command[2]);
            const keys = command.slice(3, 3 + keyCount);
            const limitOffset = 4 + keyCount;
            const limits = command.slice(limitOffset, limitOffset + keyCount).map(Number);
            const counts = keys.map(key => {
                const count = (counters.get(key) || 0) + 1;
                counters.set(key, count);
                return count;
            });
            const blocked = counts.some((count, index) => count > (limits[index] ?? 0));
            return [blocked ? 1 : 0, blocked ? 4_000 : 0, ...counts];
        },
    };
    const instanceA = createPublicCheckInSubmitRateLimitGuard({
        ...baseOptions,
        store: new RedisFixedWindowRateLimitStore(redis, 'shared-test'),
        maxPerIp: 2,
        maxPerTokenIp: 2,
    });
    const instanceB = createPublicCheckInSubmitRateLimitGuard({
        ...baseOptions,
        store: new RedisFixedWindowRateLimitStore(redis, 'shared-test'),
        maxPerIp: 2,
        maxPerTokenIp: 2,
    });
    const request = { ip: '192.0.2.10' };

    assert.equal(await instanceA(request, new ResponseRecorder(), 'shared-token'), true);
    assert.equal(await instanceB(request, new ResponseRecorder(), 'shared-token'), true);
    const deniedResponse = new ResponseRecorder();
    assert.equal(await instanceA(request, deniedResponse, 'shared-token'), false);
    assert.equal(deniedResponse.statusCode, 429);
    assert.equal(deniedResponse.headers.get('retry-after'), '4');
});
