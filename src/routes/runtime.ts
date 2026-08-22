import type { Express, RequestHandler, Response } from 'express';
import {
    buildCapturePrivilegeUnavailablePayload,
    buildCaptureUnavailablePayload,
    buildRuntimeCapabilities,
} from '../runtime.js';
import type { RuntimeConfig } from '../runtime.js';
import { SOFTWARE_VERSION } from '../version.js';

export interface RuntimeHealthProviders {
    mongoConfigured?: () => boolean;
    mongoConnected?: () => boolean;
    redisConfigured?: () => boolean;
    redisRequired?: () => boolean;
    redisConnected?: () => boolean;
    whatsappConnected?: () => boolean;
    localCaptureAvailable?: () => boolean;
}

export function buildRuntimeHealth(config: RuntimeConfig, providers: RuntimeHealthProviders = {}) {
    const mongoConfigured = providers.mongoConfigured?.() ?? false;
    const mongoConnected = providers.mongoConnected?.() ?? false;
    const redisConfigured = providers.redisConfigured?.() ?? false;
    const redisRequired = providers.redisRequired?.() ?? false;
    const redisConnected = providers.redisConnected?.() ?? false;
    const whatsappConnected = providers.whatsappConnected?.() ?? false;
    const localCaptureAvailable = config.localCaptureEnabled
        ? providers.localCaptureAvailable?.() ?? false
        : false;
    const degradedReasons = [
        mongoConfigured && !mongoConnected ? 'mongodb_disconnected' : null,
        redisRequired && !redisConfigured ? 'redis_not_configured' : null,
        redisConfigured && !redisConnected ? 'redis_disconnected' : null,
        !whatsappConnected ? 'whatsapp_disconnected' : null,
        config.localCaptureEnabled && !localCaptureAvailable ? 'local_capture_privileges_missing' : null,
    ].filter((reason): reason is string => Boolean(reason));

    return {
        service: 'wp-monitor',
        version: SOFTWARE_VERSION,
        developedBy: 'WP MONITOR',
        status: degradedReasons.length > 0 ? 'degraded' : 'operational',
        generatedAt: new Date().toISOString(),
        runtime: buildRuntimeCapabilities(config, localCaptureAvailable),
        dependencies: {
            mongodb: {
                configured: mongoConfigured,
                connected: mongoConnected,
            },
            redis: {
                configured: redisConfigured,
                required: redisRequired,
                connected: redisConnected,
            },
            whatsapp: {
                connected: whatsappConnected,
            },
            localCapture: {
                enabled: config.localCaptureEnabled,
                available: localCaptureAvailable,
            },
        },
        degradedReasons,
    };
}

export function registerRuntimeRoutes(app: Express, config: RuntimeConfig, providers: RuntimeHealthProviders = {}): void {
    app.get('/api/runtime-capabilities', (_req, res) => {
        const localCaptureAvailable = config.localCaptureEnabled
            ? providers.localCaptureAvailable?.() ?? false
            : false;
        res.json(buildRuntimeCapabilities(config, localCaptureAvailable));
    });

    app.get('/api/health', (_req, res) => {
        const health = buildRuntimeHealth(config, providers);
        res.status(health.status === 'operational' ? 200 : 503).json(health);
    });
}

export function sendCaptureUnavailableIfNeeded(
    config: RuntimeConfig,
    res: Response,
    captureAvailable = true,
): boolean {
    if (!config.localCaptureEnabled) {
        res.status(403).json(buildCaptureUnavailablePayload(config.deploymentMode));
        return true;
    }
    if (!captureAvailable) {
        res.status(503).json(buildCapturePrivilegeUnavailablePayload());
        return true;
    }
    return false;
}

export function localCaptureGuard(
    config: RuntimeConfig,
    captureAvailable: () => boolean = () => true,
): RequestHandler {
    return (_req, res, next) => {
        if (sendCaptureUnavailableIfNeeded(config, res, captureAvailable())) return;
        next();
    };
}
