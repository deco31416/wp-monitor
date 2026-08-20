import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCheckInHash,
    buildConsentText,
    hasValidCheckInLocation,
    normalizeCheckInSubmission,
} from '../src/check-in.js';
import { createPublicCheckInSubmitRateLimitGuard, type RateLimitResponseLike } from '../src/check-in-rate-limit.js';
import { MemoryFixedWindowRateLimitStore } from '../src/rate-limit.js';
import { buildRedisConfig } from '../src/redis.js';
import { buildRuntimeHealth } from '../src/routes/runtime.js';
import { buildRuntimeConfig, validateProductionSecurity } from '../src/runtime.js';
import { buildStatsInsights } from '../src/stats-insights.js';
import { selectPrimaryTrackerDevice, shouldPersistTrackerMeasurement } from '../src/tracker-signals.js';

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

test('tracking flow keeps primary state, RTT, persistence, and statistics consistent', () => {
    const now = new Date('2026-08-19T12:00:00.000Z');
    const updates = [
        {
            sampleKind: 'probe' as const,
            median: 80,
            devices: [
                { jid: 'device-timeout', state: 'NO_ACK', rtt: 10_000, avg: 10_000 },
                { jid: 'device-online', state: 'Online', rtt: 70, avg: 75 },
            ],
        },
        {
            sampleKind: 'probe' as const,
            median: 120,
            devices: [{ jid: 'device-standby', state: 'Standby', rtt: 120, avg: 115 }],
        },
        {
            sampleKind: 'probe' as const,
            median: 10_000,
            devices: [{ jid: 'device-timeout', state: 'NO_ACK', rtt: 10_000, avg: 10_000 }],
        },
    ];

    const samples = updates
        .filter(shouldPersistTrackerMeasurement)
        .map((update, index) => {
            const primary = selectPrimaryTrackerDevice(update.devices);
            assert.ok(primary);
            return {
                state: primary.state,
                rtt: primary.rtt,
                timestamp: new Date(now.getTime() - index * 60_000),
            };
        });
    const last24h = buildStatsInsights(samples, now).periods.find(period => period.key === 'last24h');

    assert.equal(samples[0]?.state, 'Online');
    assert.equal(samples[0]?.rtt, 70);
    assert.equal(last24h?.totalMeasurements, 3);
    assert.equal(last24h?.conclusiveMeasurements, 2);
    assert.equal(last24h?.inconclusiveMeasurements, 1);
    assert.equal(last24h?.onlinePct, 50);
    assert.equal(last24h?.avgRtt, 95);
});

test('public check-in flow limits retries and preserves only valid authorized evidence', async () => {
    const submission = normalizeCheckInSubmission({
        consentAccepted: true,
        browser: { timezone: 'America/Bogota', language: 'es-CO' },
        location: {
            permission: 'granted',
            lat: '4.7110',
            lon: '-74.0721',
            accuracy: 18,
            capturedAt: '2026-08-19T12:00:00-05:00',
        },
    });
    assert.equal(hasValidCheckInLocation(submission.location), true);
    assert.equal(submission.location?.capturedAt, '2026-08-19T17:00:00.000Z');

    const consent = buildConsentText('Acepto la politica autorizada del caso.', true);
    assert.match(consent, /Aviso tecnico minimo/);
    assert.match(consent, /ubicacion aproximada solo si se concede permiso GPS/);

    const evidence = {
        token: 'synthetic-token',
        consent: { accepted: true, text: consent },
        browser: submission.browser,
        location: submission.location,
        completedAt: new Date('2026-08-19T17:00:01.000Z'),
    };
    const firstHash = buildCheckInHash(evidence as any);
    const changedHash = buildCheckInHash({
        ...evidence,
        location: { ...submission.location, lat: 4.72 },
    } as any);
    assert.match(firstHash, /^[a-f0-9]{64}$/);
    assert.notEqual(firstHash, changedHash);

    const guard = createPublicCheckInSubmitRateLimitGuard({
        store: new MemoryFixedWindowRateLimitStore(() => 1_000),
        identitySecret: 'synthetic-test-secret-with-enough-entropy',
        windowMs: 60_000,
        maxPerIp: 1,
        maxPerTokenIp: 1,
    });
    const firstResponse = new ResponseRecorder();
    const secondResponse = new ResponseRecorder();
    const request = { ip: '::ffff:192.0.2.10' };

    assert.equal(await guard(request, firstResponse, 'synthetic-token'), true);
    assert.equal(await guard(request, secondResponse, 'synthetic-token'), false);
    assert.equal(secondResponse.statusCode, 429);
    assert.equal(secondResponse.headers.get('retry-after'), '60');
});

test('production readiness flow requires strong auth and shared Redis before reporting operational', () => {
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'production' }), [
        'AUTH_IDENTITY_SECRET is required when NODE_ENV=production',
        'MONGODB_URI is required for single-operator authentication in production',
        'ALLOWED_ORIGINS is required for dashboard authentication in production',
        'REDIS_URL is required for operator sessions and shared rate limits',
    ]);

    const env = {
        NODE_ENV: 'production',
        DEPLOYMENT_MODE: 'railway-dashboard',
        AUTH_IDENTITY_SECRET: '12345678901234567890123456789012',
        MONGODB_URI: 'mongodb://database.example.test/wp-monitor',
        ALLOWED_ORIGINS: 'https://dashboard.example.test',
        REDIS_URL: 'rediss://redis.example.test:6380',
    };
    const runtime = buildRuntimeConfig(env);
    const redis = buildRedisConfig(env);
    const health = buildRuntimeHealth(runtime, {
        mongoConfigured: () => true,
        mongoConnected: () => true,
        redisConfigured: () => redis.configured,
        redisRequired: () => redis.required,
        redisConnected: () => true,
        whatsappConnected: () => true,
    });

    assert.deepEqual(validateProductionSecurity(env), []);
    assert.equal(redis.required, true);
    assert.equal(health.status, 'operational');
    assert.deepEqual(health.degradedReasons, []);
    assert.equal(JSON.stringify(health).includes(env.AUTH_IDENTITY_SECRET), false);
    assert.equal(JSON.stringify(health).includes(env.REDIS_URL), false);
});
