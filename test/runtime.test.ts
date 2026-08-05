import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCaptureUnavailablePayload,
    buildRuntimeCapabilities,
    buildRuntimeConfig,
    resolveTrustProxy,
    resolveDeploymentMode,
    resolveLocalCaptureEnabled,
    validateProductionSecurity,
} from '../src/runtime.js';

test('resolves Railway mode from Railway environment name and disables local capture by default', () => {
    const env = { RAILWAY_ENVIRONMENT_NAME: 'production', DASHBOARD_TOKEN: 'configured' };
    const config = buildRuntimeConfig(env);
    const capabilities = buildRuntimeCapabilities(config);

    assert.equal(resolveDeploymentMode(env), 'railway-dashboard');
    assert.equal(resolveLocalCaptureEnabled(env), false);
    assert.deepEqual(capabilities, {
        mode: 'railway-dashboard',
        localCapture: false,
        whatsappTracker: true,
        reports: true,
        networkMonitor: false,
        callTrafficAnalysis: false,
        authRequired: true,
    });
});

test('resolves local-full mode and enables capture by default', () => {
    const env = { DEPLOYMENT_MODE: 'local-full' };
    const config = buildRuntimeConfig(env);
    const capabilities = buildRuntimeCapabilities(config);

    assert.equal(capabilities.mode, 'local-full');
    assert.equal(capabilities.localCapture, true);
    assert.equal(capabilities.networkMonitor, true);
    assert.equal(capabilities.callTrafficAnalysis, true);
    assert.equal(capabilities.authRequired, false);
});

test('explicit LOCAL_CAPTURE_ENABLED overrides deployment default', () => {
    assert.equal(resolveLocalCaptureEnabled({ DEPLOYMENT_MODE: 'local-full', LOCAL_CAPTURE_ENABLED: 'false' }), false);
    assert.equal(resolveLocalCaptureEnabled({ DEPLOYMENT_MODE: 'railway-dashboard', LOCAL_CAPTURE_ENABLED: 'true' }), true);
});

test('builds capture unavailable payload with operational hint', () => {
    assert.deepEqual(buildCaptureUnavailablePayload('railway-dashboard'), {
        error: 'Local packet capture is disabled in this deployment',
        mode: 'railway-dashboard',
        hint: 'Run with DEPLOYMENT_MODE=local-full and LOCAL_CAPTURE_ENABLED=true on an authorized local machine or VM.',
    });
});

test('requires a strong dashboard token in production', () => {
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'development' }), []);
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'production' }), [
        'DASHBOARD_TOKEN is required when NODE_ENV=production',
    ]);
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'production', DASHBOARD_TOKEN: 'short' }), [
        'DASHBOARD_TOKEN must be at least 32 characters when NODE_ENV=production',
    ]);
    assert.deepEqual(validateProductionSecurity({
        NODE_ENV: 'production',
        DASHBOARD_TOKEN: '12345678901234567890123456789012',
    }), []);
});

test('resolves trust proxy safely for local and Railway deployments', () => {
    assert.equal(resolveTrustProxy({}), false);
    assert.equal(resolveTrustProxy({ RAILWAY_ENVIRONMENT_NAME: 'production' }), 1);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'true' }), true);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'false' }), false);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '2' }), 2);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'loopback' }), 'loopback');
});
