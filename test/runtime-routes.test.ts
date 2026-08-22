import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { buildRuntimeHealth, localCaptureGuard, registerRuntimeRoutes } from '../src/routes/runtime.js';
import { buildRuntimeConfig } from '../src/runtime.js';
import { SOFTWARE_VERSION } from '../src/version.js';

async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>) {
    const server: Server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.ok(address && typeof address === 'object');
    const listeningAddress = address as AddressInfo;
    const baseUrl = `http://127.0.0.1:${listeningAddress.port}`;
    try {
        await run(baseUrl);
    } finally {
        await new Promise<void>((resolve, reject) => {
            server.close(error => error ? reject(error) : resolve());
        });
    }
}

test('GET /api/runtime-capabilities returns Railway dashboard capabilities over HTTP', async () => {
    const app = express();
    const config = buildRuntimeConfig({
        RAILWAY_ENVIRONMENT_NAME: 'production',
    });
    registerRuntimeRoutes(app, config);

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/runtime-capabilities`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            version: SOFTWARE_VERSION,
            mode: 'railway-dashboard',
            localCapture: false,
            localCaptureAvailable: false,
            whatsappTracker: true,
            reports: true,
            networkMonitor: false,
            callTrafficAnalysis: false,
            passiveMessageReceipts: true,
            experimentalProbes: false,
            authRequired: true,
        });
    });
});

test('buildRuntimeHealth marks service degraded without leaking secrets', () => {
    const health = buildRuntimeHealth(
        buildRuntimeConfig({ DEPLOYMENT_MODE: 'local-full' }),
        {
            mongoConfigured: () => true,
            mongoConnected: () => false,
            redisConfigured: () => true,
            redisRequired: () => true,
            redisConnected: () => false,
            whatsappConnected: () => true,
            localCaptureAvailable: () => true,
        },
    );

    assert.equal(health.status, 'degraded');
    assert.equal(health.version, SOFTWARE_VERSION);
    assert.deepEqual(health.degradedReasons, ['mongodb_disconnected', 'redis_disconnected']);
    assert.equal(health.dependencies.mongodb.configured, true);
    assert.equal(health.dependencies.mongodb.connected, false);
    assert.equal(health.dependencies.redis.required, true);
    assert.equal(health.dependencies.redis.connected, false);
    assert.equal(JSON.stringify(health).includes('secret'), false);
});

test('GET /api/health returns 503 when dependencies are degraded', async () => {
    const app = express();
    const config = buildRuntimeConfig({
        DEPLOYMENT_MODE: 'local-full',
    });
    registerRuntimeRoutes(app, config, {
        mongoConfigured: () => true,
        mongoConnected: () => false,
        whatsappConnected: () => false,
        localCaptureAvailable: () => true,
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health`);
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.status, 'degraded');
        assert.deepEqual(body.degradedReasons, ['mongodb_disconnected', 'whatsapp_disconnected']);
        assert.equal(body.dependencies.localCapture.enabled, true);
        assert.equal(body.dependencies.localCapture.available, true);
    });
});

test('health reports required Redis that is not configured', () => {
    const health = buildRuntimeHealth(
        buildRuntimeConfig({ DEPLOYMENT_MODE: 'local-full' }),
        {
            redisRequired: () => true,
            redisConfigured: () => false,
            redisConnected: () => false,
            whatsappConnected: () => true,
            localCaptureAvailable: () => true,
        },
    );

    assert.equal(health.status, 'degraded');
    assert.deepEqual(health.degradedReasons, ['redis_not_configured']);
    assert.equal(health.dependencies.redis.required, true);
});

test('health reports missing Linux capture privileges when local capture is enabled', () => {
    const health = buildRuntimeHealth(
        buildRuntimeConfig({ DEPLOYMENT_MODE: 'local-full' }),
        {
            mongoConfigured: () => true,
            mongoConnected: () => true,
            redisConfigured: () => true,
            redisRequired: () => true,
            redisConnected: () => true,
            whatsappConnected: () => true,
            localCaptureAvailable: () => false,
        },
    );

    assert.equal(health.status, 'degraded');
    assert.deepEqual(health.degradedReasons, ['local_capture_privileges_missing']);
    assert.deepEqual(health.dependencies.localCapture, { enabled: true, available: false });
});

test('GET /api/health returns 200 when dependencies are operational', async () => {
    const app = express();
    const config = buildRuntimeConfig({
        DEPLOYMENT_MODE: 'railway-dashboard',
        LOCAL_CAPTURE_ENABLED: 'false',
    });
    registerRuntimeRoutes(app, config, {
        mongoConfigured: () => true,
        mongoConnected: () => true,
        redisConfigured: () => true,
        redisRequired: () => true,
        redisConnected: () => true,
        whatsappConnected: () => true,
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health`);
        const body = await response.json();
        assert.equal(response.status, 200);
        assert.equal(body.status, 'operational');
        assert.deepEqual(body.degradedReasons, []);
        assert.equal(body.runtime.networkMonitor, false);
    });
});

test('localCaptureGuard blocks capture routes in Railway mode over HTTP', async () => {
    const app = express();
    const config = buildRuntimeConfig({
        DEPLOYMENT_MODE: 'railway-dashboard',
        LOCAL_CAPTURE_ENABLED: 'false',
    });
    app.get('/api/network/interfaces', localCaptureGuard(config), (_req, res) => {
        res.json([{ name: 'should-not-return' }]);
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/network/interfaces`);
        assert.equal(response.status, 403);
        assert.deepEqual(await response.json(), {
            error: 'Local packet capture is disabled in this deployment',
            mode: 'railway-dashboard',
            hint: 'Run with DEPLOYMENT_MODE=local-full and LOCAL_CAPTURE_ENABLED=true on an authorized local machine or VM.',
        });
    });
});

test('localCaptureGuard allows capture routes in local-full mode over HTTP', async () => {
    const app = express();
    const config = buildRuntimeConfig({
        DEPLOYMENT_MODE: 'local-full',
        LOCAL_CAPTURE_ENABLED: 'true',
    });
    app.get('/api/network/interfaces', localCaptureGuard(config), (_req, res) => {
        res.json([{ name: 'local0' }]);
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/network/interfaces`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), [{ name: 'local0' }]);
    });
});

test('localCaptureGuard returns an actionable 503 when Linux privileges are missing', async () => {
    const app = express();
    const config = buildRuntimeConfig({
        DEPLOYMENT_MODE: 'local-full',
        LOCAL_CAPTURE_ENABLED: 'true',
    });
    app.get('/api/network/interfaces', localCaptureGuard(config, () => false), (_req, res) => {
        res.json([{ name: 'should-not-return' }]);
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/network/interfaces`);
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
            error: 'Local packet capture privileges are unavailable',
            code: 'capture_privileges_missing',
            hint: 'Start the dedicated service with CAP_NET_RAW and CAP_NET_ADMIN; do not run the application as root.',
        });
    });
});
