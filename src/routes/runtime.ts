import type { Express, RequestHandler, Response } from 'express';
import { buildCaptureUnavailablePayload, buildRuntimeCapabilities, RuntimeConfig } from '../runtime.js';

export interface RuntimeHealthProviders {
    mongoConfigured?: () => boolean;
    mongoConnected?: () => boolean;
    whatsappConnected?: () => boolean;
}

export function buildRuntimeHealth(config: RuntimeConfig, providers: RuntimeHealthProviders = {}) {
    const mongoConfigured = providers.mongoConfigured?.() ?? false;
    const mongoConnected = providers.mongoConnected?.() ?? false;
    const whatsappConnected = providers.whatsappConnected?.() ?? false;
    const degradedReasons = [
        mongoConfigured && !mongoConnected ? 'mongodb_disconnected' : null,
        !whatsappConnected ? 'whatsapp_disconnected' : null,
    ].filter((reason): reason is string => Boolean(reason));

    return {
        service: 'wp-monitor',
        developedBy: 'WP MONITOR',
        status: degradedReasons.length > 0 ? 'degraded' : 'operational',
        generatedAt: new Date().toISOString(),
        runtime: buildRuntimeCapabilities(config),
        dependencies: {
            mongodb: {
                configured: mongoConfigured,
                connected: mongoConnected,
            },
            whatsapp: {
                connected: whatsappConnected,
            },
            localCapture: {
                enabled: config.localCaptureEnabled,
            },
        },
        degradedReasons,
    };
}

export function registerRuntimeRoutes(app: Express, config: RuntimeConfig, providers: RuntimeHealthProviders = {}): void {
    app.get('/api/runtime-capabilities', (_req, res) => {
        res.json(buildRuntimeCapabilities(config));
    });

    app.get('/api/health', (_req, res) => {
        const health = buildRuntimeHealth(config, providers);
        res.status(health.status === 'operational' ? 200 : 503).json(health);
    });
}

export function sendCaptureUnavailableIfNeeded(config: RuntimeConfig, res: Response): boolean {
    if (config.localCaptureEnabled) return false;
    res.status(403).json(buildCaptureUnavailablePayload(config.deploymentMode));
    return true;
}

export function localCaptureGuard(config: RuntimeConfig): RequestHandler {
    return (_req, res, next) => {
        if (sendCaptureUnavailableIfNeeded(config, res)) return;
        next();
    };
}
