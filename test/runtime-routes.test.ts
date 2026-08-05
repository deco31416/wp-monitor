import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import type { Server } from 'http';
import { buildRuntimeHealth, localCaptureGuard, registerRuntimeRoutes } from '../src/routes/runtime.js';
import { buildRuntimeConfig } from '../src/runtime.js';

async function withServer(app: express.Express, run: (baseUrl: string) => Promise<void>) {
    const server: Server = app.listen(0);
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address();
    assert.equal(typeof address, 'object');
    assert.ok(address);
    const baseUrl = `http://127.0.0.1:${address.port}`;
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
        DASHBOARD_TOKEN: 'configured',
    });
    registerRuntimeRoutes(app, config);

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/runtime-capabilities`);
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), {
            mode: 'railway-dashboard',
            localCapture: false,
            whatsappTracker: true,
            reports: true,
            networkMonitor: false,
            callTrafficAnalysis: false,
            authRequired: true,
        });
    });
});

test('buildRuntimeHealth marks service degraded without leaking secrets', () => {
    const health = buildRuntimeHealth(
        buildRuntimeConfig({ DEPLOYMENT_MODE: 'local-full', DASHBOARD_TOKEN: 'secret' }),
        {
            mongoConfigured: () => true,
            mongoConnected: () => false,
            whatsappConnected: () => true,
        },
    );

    assert.equal(health.status, 'degraded');
    assert.deepEqual(health.degradedReasons, ['mongodb_disconnected']);
    assert.equal(health.dependencies.mongodb.configured, true);
    assert.equal(health.dependencies.mongodb.connected, false);
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
    });

    await withServer(app, async baseUrl => {
        const response = await fetch(`${baseUrl}/api/health`);
        const body = await response.json();
        assert.equal(response.status, 503);
        assert.equal(body.status, 'degraded');
        assert.deepEqual(body.degradedReasons, ['mongodb_disconnected', 'whatsapp_disconnected']);
        assert.equal(body.dependencies.localCapture.enabled, true);
    });
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
