export interface RuntimeConfig {
    deploymentMode: string;
    localCaptureEnabled: boolean;
    dashboardTokenConfigured: boolean;
}

export type TrustProxySetting = boolean | number | string;

export interface RuntimeCapabilities {
    mode: string;
    localCapture: boolean;
    whatsappTracker: boolean;
    reports: boolean;
    networkMonitor: boolean;
    callTrafficAnalysis: boolean;
    authRequired: boolean;
}

export function resolveDeploymentMode(env: NodeJS.ProcessEnv): string {
    return env.DEPLOYMENT_MODE || (env.RAILWAY_ENVIRONMENT_NAME ? 'railway-dashboard' : 'local-full');
}

export function resolveLocalCaptureEnabled(env: NodeJS.ProcessEnv, deploymentMode = resolveDeploymentMode(env)): boolean {
    return env.LOCAL_CAPTURE_ENABLED
        ? env.LOCAL_CAPTURE_ENABLED === 'true'
        : deploymentMode === 'local-full';
}

export function buildRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
    const deploymentMode = resolveDeploymentMode(env);
    return {
        deploymentMode,
        localCaptureEnabled: resolveLocalCaptureEnabled(env, deploymentMode),
        dashboardTokenConfigured: Boolean(env.DASHBOARD_TOKEN),
    };
}

export function validateProductionSecurity(env: NodeJS.ProcessEnv): string[] {
    const errors: string[] = [];
    const nodeEnv = env.NODE_ENV || 'development';
    const token = env.DASHBOARD_TOKEN || '';

    if (nodeEnv === 'production') {
        if (!token.trim()) {
            errors.push('DASHBOARD_TOKEN is required when NODE_ENV=production');
        } else if (token.trim().length < 32) {
            errors.push('DASHBOARD_TOKEN must be at least 32 characters when NODE_ENV=production');
        }
    }

    return errors;
}

export function resolveTrustProxy(env: NodeJS.ProcessEnv): TrustProxySetting {
    const configured = env.TRUST_PROXY?.trim();
    if (!configured) {
        return env.RAILWAY_ENVIRONMENT_NAME ? 1 : false;
    }

    const lower = configured.toLowerCase();
    if (lower === 'true') return true;
    if (lower === 'false') return false;
    const numeric = Number(configured);
    if (Number.isFinite(numeric) && numeric >= 0) return numeric;
    return configured;
}

export function buildRuntimeCapabilities(config: RuntimeConfig): RuntimeCapabilities {
    return {
        mode: config.deploymentMode,
        localCapture: config.localCaptureEnabled,
        whatsappTracker: true,
        reports: true,
        networkMonitor: config.localCaptureEnabled,
        callTrafficAnalysis: config.localCaptureEnabled,
        authRequired: config.dashboardTokenConfigured,
    };
}

export function buildCaptureUnavailablePayload(deploymentMode: string) {
    return {
        error: 'Local packet capture is disabled in this deployment',
        mode: deploymentMode,
        hint: 'Run with DEPLOYMENT_MODE=local-full and LOCAL_CAPTURE_ENABLED=true on an authorized local machine or VM.',
    };
}
