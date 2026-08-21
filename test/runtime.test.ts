import test from 'node:test';
import assert from 'node:assert/strict';
import {
    buildCapturePrivilegeUnavailablePayload,
    buildCaptureUnavailablePayload,
    buildRuntimeCapabilities,
    buildRuntimeConfig,
    resolveTrustProxy,
    resolveDeploymentMode,
    resolveLocalCaptureEnabled,
    validateProductionSecurity,
} from '../src/runtime.js';

test('resolves Railway mode from Railway environment name and disables local capture by default', () => {
    const env = { RAILWAY_ENVIRONMENT_NAME: 'production' };
    const config = buildRuntimeConfig(env);
    const capabilities = buildRuntimeCapabilities(config);

    assert.equal(resolveDeploymentMode(env), 'railway-dashboard');
    assert.equal(resolveLocalCaptureEnabled(env), false);
    assert.deepEqual(capabilities, {
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

test('resolves local-full mode and enables capture by default', () => {
    const env = { DEPLOYMENT_MODE: 'local-full' };
    const config = buildRuntimeConfig(env);
    const capabilities = buildRuntimeCapabilities(config);

    assert.equal(capabilities.mode, 'local-full');
    assert.equal(capabilities.localCapture, true);
    assert.equal(capabilities.localCaptureAvailable, true);
    assert.equal(capabilities.networkMonitor, true);
    assert.equal(capabilities.callTrafficAnalysis, true);
    assert.equal(capabilities.authRequired, true);
});

test('keeps local capture configured but marks capture features unavailable without OS privileges', () => {
    const config = buildRuntimeConfig({ DEPLOYMENT_MODE: 'local-full' });
    const capabilities = buildRuntimeCapabilities(config, false);

    assert.equal(capabilities.localCapture, true);
    assert.equal(capabilities.localCaptureAvailable, false);
    assert.equal(capabilities.networkMonitor, false);
    assert.equal(capabilities.callTrafficAnalysis, false);
});

test('explicit LOCAL_CAPTURE_ENABLED overrides deployment default', () => {
    assert.equal(resolveLocalCaptureEnabled({ DEPLOYMENT_MODE: 'local-full', LOCAL_CAPTURE_ENABLED: 'false' }), false);
    assert.equal(resolveLocalCaptureEnabled({ DEPLOYMENT_MODE: 'railway-dashboard', LOCAL_CAPTURE_ENABLED: 'true' }), true);
});

test('keeps active probes disabled unless explicitly enabled', () => {
    assert.equal(buildRuntimeConfig({ DEPLOYMENT_MODE: 'local-full' }).experimentalProbesEnabled, false);
    assert.equal(buildRuntimeCapabilities(buildRuntimeConfig({
        DEPLOYMENT_MODE: 'local-full',
        ENABLE_EXPERIMENTAL_PROBES: 'true',
    })).experimentalProbes, true);
});

test('builds capture unavailable payload with operational hint', () => {
    assert.deepEqual(buildCaptureUnavailablePayload('railway-dashboard'), {
        error: 'Local packet capture is disabled in this deployment',
        mode: 'railway-dashboard',
        hint: 'Run with DEPLOYMENT_MODE=local-full and LOCAL_CAPTURE_ENABLED=true on an authorized local machine or VM.',
    });
});

test('builds actionable payload when Linux capture privileges are missing', () => {
    assert.deepEqual(buildCapturePrivilegeUnavailablePayload(), {
        error: 'Local packet capture privileges are unavailable',
        code: 'capture_privileges_missing',
        hint: 'Start the dedicated service with CAP_NET_RAW and CAP_NET_ADMIN; do not run the application as root.',
    });
});

test('requires Redis in every mode and hardened authentication dependencies in production', () => {
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'development' }), [
        'REDIS_URL is required for operator sessions and shared rate limits',
    ]);
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'production' }), [
        'AUTH_IDENTITY_SECRET is required when NODE_ENV=production',
        'MONGODB_URI is required for single-operator authentication in production',
        'ALLOWED_ORIGINS is required for dashboard authentication in production',
        'REDIS_URL is required for operator sessions and shared rate limits',
    ]);
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'production', AUTH_IDENTITY_SECRET: 'short' }), [
        'AUTH_IDENTITY_SECRET must be at least 32 characters when NODE_ENV=production',
        'MONGODB_URI is required for single-operator authentication in production',
        'ALLOWED_ORIGINS is required for dashboard authentication in production',
        'REDIS_URL is required for operator sessions and shared rate limits',
    ]);
    assert.deepEqual(validateProductionSecurity({
        NODE_ENV: 'production',
        AUTH_IDENTITY_SECRET: '12345678901234567890123456789012',
        MONGODB_URI: 'mongodb://database.example.test/wp-monitor',
        ALLOWED_ORIGINS: 'https://dashboard.example.test',
        REDIS_URL: 'rediss://redis.example.test:6380',
    }), []);
});

test('validates bootstrap credentials, session lifetime, login limits, and HTTPS origins', () => {
    assert.deepEqual(validateProductionSecurity({
        NODE_ENV: 'production',
        AUTH_IDENTITY_SECRET: '12345678901234567890123456789012',
        MONGODB_URI: 'mongodb://database.example.test/wp-monitor',
        REDIS_URL: 'rediss://redis.example.test:6380',
        ALLOWED_ORIGINS: 'http://dashboard.example.test',
        INITIAL_ADMIN_USERNAME: '-invalid',
        INITIAL_ADMIN_PASSWORD: 'short',
        AUTH_SESSION_TTL_SECONDS: '60',
        AUTH_PASSWORD_VERIFY_CONCURRENCY: '5',
        AUTH_LOGIN_RATE_MAX_PER_USERNAME_IP: '0',
    }), [
        'ALLOWED_ORIGINS must contain only valid HTTPS origins in production',
        'INITIAL_ADMIN_USERNAME must satisfy the 3-64 character username policy',
        'INITIAL_ADMIN_PASSWORD must contain between 15 and 128 characters',
        'AUTH_SESSION_TTL_SECONDS must be an integer between 300 and 604800',
        'AUTH_PASSWORD_VERIFY_CONCURRENCY must be an integer between 1 and 4',
        'AUTH_LOGIN_RATE_MAX_PER_USERNAME_IP must be an integer between 1 and 10000',
    ]);
});

test('validates required Redis configuration and protocol', () => {
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'development', REDIS_REQUIRED: 'true' }), [
        'REDIS_URL is required for operator sessions and shared rate limits',
    ]);
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'development', REDIS_URL: 'http://localhost:6379' }), [
        'REDIS_URL must use the redis:// or rediss:// protocol',
    ]);
    assert.deepEqual(validateProductionSecurity({ NODE_ENV: 'development', REDIS_URL: 'redis://127.0.0.1:6379' }), []);
});

test('resolves trust proxy safely for local and Railway deployments', () => {
    assert.equal(resolveTrustProxy({}), false);
    assert.equal(resolveTrustProxy({ RAILWAY_ENVIRONMENT_NAME: 'production' }), 1);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'true' }), true);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'false' }), false);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: '2' }), 2);
    assert.equal(resolveTrustProxy({ TRUST_PROXY: 'loopback' }), 'loopback');
});
