import { SOFTWARE_VERSION } from './version.js';

export type CallCaptureMode = 'disabled' | 'local' | 'agent';

export interface RuntimeConfig {
    deploymentMode: string;
    localCaptureEnabled: boolean;
    callCaptureMode: CallCaptureMode;
    experimentalProbesEnabled: boolean;
    authRequired: true;
}

export type TrustProxySetting = boolean | number | string;

const PUBLIC_RUNTIME_API_PATHS = new Set([
    '/runtime-capabilities',
    '/health',
    '/health/live',
]);

export function isPublicRuntimeApiPath(path: string): boolean {
    return PUBLIC_RUNTIME_API_PATHS.has(path);
}

export interface RuntimeCapabilities {
    version: string;
    mode: string;
    localCapture: boolean;
    localCaptureAvailable: boolean;
    whatsappTracker: boolean;
    reports: boolean;
    networkMonitor: boolean;
    callTrafficAnalysis: boolean;
    callCaptureMode: CallCaptureMode;
    passiveMessageReceipts: boolean;
    experimentalProbes: boolean;
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

export function resolveCallCaptureMode(
    env: NodeJS.ProcessEnv,
    localCaptureEnabled = resolveLocalCaptureEnabled(env),
): CallCaptureMode {
    const configured = env.CALL_CAPTURE_MODE?.trim().toLowerCase();
    if (configured === 'disabled' || configured === 'local' || configured === 'agent') return configured;
    if (configured) return 'disabled';
    if (env.CAPTURE_AGENT_URL?.trim()) return 'agent';
    return localCaptureEnabled ? 'local' : 'disabled';
}

export function buildRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
    const deploymentMode = resolveDeploymentMode(env);
    const localCaptureEnabled = resolveLocalCaptureEnabled(env, deploymentMode);
    return {
        deploymentMode,
        localCaptureEnabled,
        callCaptureMode: resolveCallCaptureMode(env, localCaptureEnabled),
        experimentalProbesEnabled: env.ENABLE_EXPERIMENTAL_PROBES === 'true',
        authRequired: true,
    };
}

export function validateProductionSecurity(env: NodeJS.ProcessEnv): string[] {
    const errors: string[] = [];
    const nodeEnv = env.NODE_ENV || 'development';
    const authIdentitySecret = env.AUTH_IDENTITY_SECRET || '';
    const redisUrl = env.REDIS_URL?.trim() || '';
    const callCaptureMode = env.CALL_CAPTURE_MODE?.trim().toLowerCase();
    const captureAgentUrl = env.CAPTURE_AGENT_URL?.trim() || '';
    const captureAgentSecret = env.CAPTURE_AGENT_SHARED_SECRET || '';

    if (callCaptureMode && !['disabled', 'local', 'agent'].includes(callCaptureMode)) {
        errors.push('CALL_CAPTURE_MODE must be disabled, local, or agent');
    }
    const resolvedCallCaptureMode = resolveCallCaptureMode(env);
    if (resolvedCallCaptureMode === 'agent') {
        if (!captureAgentUrl) {
            errors.push('CAPTURE_AGENT_URL is required when CALL_CAPTURE_MODE=agent');
        } else {
            try {
                const parsed = new URL(captureAgentUrl);
                if (
                    !['http:', 'https:'].includes(parsed.protocol)
                    || parsed.username
                    || parsed.password
                    || parsed.pathname !== '/'
                    || parsed.search
                    || parsed.hash
                ) {
                    throw new Error('invalid origin');
                }
            } catch {
                errors.push('CAPTURE_AGENT_URL must be an HTTP(S) origin without credentials, path, query, or fragment');
            }
        }
        if (Buffer.byteLength(captureAgentSecret, 'utf8') < 32) {
            errors.push('CAPTURE_AGENT_SHARED_SECRET must contain at least 32 bytes when CALL_CAPTURE_MODE=agent');
        }
    } else if (captureAgentUrl || captureAgentSecret) {
        errors.push('CAPTURE_AGENT_URL and CAPTURE_AGENT_SHARED_SECRET require CALL_CAPTURE_MODE=agent');
    }

    if (nodeEnv === 'production') {
        if (!authIdentitySecret.trim()) {
            errors.push('AUTH_IDENTITY_SECRET is required when NODE_ENV=production');
        } else if (authIdentitySecret.trim().length < 32) {
            errors.push('AUTH_IDENTITY_SECRET must be at least 32 characters when NODE_ENV=production');
        }
        if (!env.MONGODB_URI?.trim()) {
            errors.push('MONGODB_URI is required for single-operator authentication in production');
        }
        const allowedOrigins = env.ALLOWED_ORIGINS?.split(',').map(value => value.trim()).filter(Boolean) || [];
        if (allowedOrigins.length === 0) {
            errors.push('ALLOWED_ORIGINS is required for dashboard authentication in production');
        } else if (allowedOrigins.some(origin => {
            try {
                return new URL(origin).protocol !== 'https:';
            } catch {
                return true;
            }
        })) {
            errors.push('ALLOWED_ORIGINS must contain only valid HTTPS origins in production');
        }
    }

    const initialUsername = env.INITIAL_ADMIN_USERNAME?.trim();
    if (initialUsername && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{1,62}[a-zA-Z0-9]$/.test(initialUsername)) {
        errors.push('INITIAL_ADMIN_USERNAME must satisfy the 3-64 character username policy');
    }
    const initialPassword = env.INITIAL_ADMIN_PASSWORD;
    if (initialPassword) {
        const length = Array.from(initialPassword).length;
        if (length < 15 || length > 128) {
            errors.push('INITIAL_ADMIN_PASSWORD must contain between 15 and 128 characters');
        }
    }

    const integerRanges: Array<[string, number, number]> = [
        ['AUTH_SESSION_TTL_SECONDS', 300, 604_800],
        ['AUTH_PASSWORD_VERIFY_CONCURRENCY', 1, 4],
        ['AUTH_LOGIN_RATE_WINDOW_MS', 60_000, 86_400_000],
        ['AUTH_LOGIN_RATE_MAX_PER_IP', 1, 10_000],
        ['AUTH_LOGIN_RATE_MAX_PER_USERNAME', 1, 10_000],
        ['AUTH_LOGIN_RATE_MAX_PER_USERNAME_IP', 1, 10_000],
        ['PROBE_INTERVAL_MS', 10_000, 600_000],
        ['PROBE_TIMEOUT_MS', 3_000, 60_000],
        ['PROBE_MAX_BACKOFF_MS', 10_000, 1_800_000],
        ['CAPTURE_AGENT_TIMEOUT_MS', 500, 30_000],
    ];
    for (const [name, minimum, maximum] of integerRanges) {
        const rawValue = env[name];
        if (rawValue === undefined || rawValue === '') continue;
        const value = Number(rawValue);
        if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
            errors.push(`${name} must be an integer between ${minimum} and ${maximum}`);
        }
    }

    if (!redisUrl) {
        errors.push('REDIS_URL is required for operator sessions and shared rate limits');
    }
    if (redisUrl) {
        try {
            const parsed = new URL(redisUrl);
            if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
                errors.push('REDIS_URL must use the redis:// or rediss:// protocol');
            }
        } catch {
            errors.push('REDIS_URL must be a valid Redis URL');
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

export function buildRuntimeCapabilities(
    config: RuntimeConfig,
    localCaptureAvailable = config.localCaptureEnabled,
    callCaptureAvailable = config.callCaptureMode === 'local' ? localCaptureAvailable : false,
): RuntimeCapabilities {
    const captureOperational = config.localCaptureEnabled && localCaptureAvailable;
    const callCaptureOperational = config.callCaptureMode !== 'disabled' && callCaptureAvailable;
    return {
        version: SOFTWARE_VERSION,
        mode: config.deploymentMode,
        localCapture: config.localCaptureEnabled,
        localCaptureAvailable: captureOperational,
        whatsappTracker: true,
        reports: true,
        networkMonitor: captureOperational,
        callTrafficAnalysis: callCaptureOperational,
        callCaptureMode: config.callCaptureMode,
        passiveMessageReceipts: true,
        experimentalProbes: config.experimentalProbesEnabled,
        authRequired: config.authRequired,
    };
}

export function buildCaptureUnavailablePayload(deploymentMode: string) {
    return {
        error: 'Local packet capture is disabled in this deployment',
        mode: deploymentMode,
        hint: 'Run with DEPLOYMENT_MODE=local-full and LOCAL_CAPTURE_ENABLED=true on an authorized local machine or VM.',
    };
}

export function buildCapturePrivilegeUnavailablePayload() {
    return {
        error: 'Local packet capture privileges are unavailable',
        code: 'capture_privileges_missing',
        hint: 'Start the dedicated service with CAP_NET_RAW and CAP_NET_ADMIN; do not run the application as root.',
    };
}
